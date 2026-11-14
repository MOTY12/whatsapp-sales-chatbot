import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MerchantInbox1760000000012 implements MigrationInterface {
  name = 'MerchantInbox1760000000012';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE public.conversations
        ADD COLUMN control_mode varchar(8) NOT NULL DEFAULT 'AUTO'
          CHECK (control_mode IN ('AUTO','HUMAN')),
        ADD COLUMN control_version bigint NOT NULL DEFAULT 1 CHECK (control_version > 0),
        ADD COLUMN takeover_actor_account_id uuid,
        ADD COLUMN takeover_at timestamptz,
        ADD COLUMN control_changed_at timestamptz NOT NULL DEFAULT now(),
        ADD CONSTRAINT "FK_conversation_takeover_actor" FOREIGN KEY (takeover_actor_account_id)
          REFERENCES public.accounts(id) ON DELETE SET NULL;
      CREATE INDEX "IDX_conversations_inbox_order"
        ON public.conversations("businessId", "updatedAt" DESC, id DESC);
      ALTER TABLE public.whatsapp_response_intents
        ADD COLUMN authorized_control_version bigint NOT NULL DEFAULT 1;
      ALTER TABLE public.whatsapp_response_intents DROP CONSTRAINT whatsapp_response_intents_status_check,
        ADD CONSTRAINT whatsapp_response_intents_status_check CHECK
          (status IN ('PENDING','GENERATING','GENERATED','QUEUED','COMPLETED','FAILED','UNCERTAIN','SUPPRESSED'));
      ALTER TABLE public.whatsapp_outbound_messages
        ADD COLUMN authorization_kind varchar(8) NOT NULL DEFAULT 'SYSTEM'
          CHECK (authorization_kind IN ('AI','HUMAN','SYSTEM')),
        ADD COLUMN control_version bigint,
        DROP CONSTRAINT whatsapp_outbound_messages_status_check,
        ADD CONSTRAINT whatsapp_outbound_messages_status_check CHECK
          (status IN ('RESERVED','SENDING','ACCEPTED','DELIVERED','READ','FAILED','UNCERTAIN','SUPPRESSED'));
      CREATE TABLE public.conversation_control_audit (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        actor_account_id uuid NOT NULL,
        previous_mode varchar(8) NOT NULL CHECK (previous_mode IN ('AUTO','HUMAN')),
        next_mode varchar(8) NOT NULL CHECK (next_mode IN ('AUTO','HUMAN')),
        control_version bigint NOT NULL,
        changed_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (business_id, conversation_id)
          REFERENCES public.conversations("businessId", id) ON DELETE RESTRICT,
        FOREIGN KEY (actor_account_id) REFERENCES public.accounts(id) ON DELETE RESTRICT,
        UNIQUE (conversation_id, control_version)
      );
      CREATE INDEX "IDX_conversation_control_audit_tenant"
        ON public.conversation_control_audit(business_id, conversation_id, changed_at DESC);
      ALTER TABLE public.conversation_control_audit ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.conversation_control_audit FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_conversation_control_audit_internal ON public.conversation_control_audit
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE FUNCTION public.kleva_inbox_list(page_size integer, before_time timestamptz DEFAULT NULL, before_id uuid DEFAULT NULL)
      RETURNS TABLE (id uuid, customer_name text, customer_whatsapp_id text, last_activity timestamptz,
        preview text, status text, control_mode text, control_version bigint, in_flight bigint)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT v.id, c.name::text, c."whatsappId"::text, v."updatedAt",
          (SELECT m.content FROM public.messages m WHERE m."businessId" = v."businessId"
            AND m."conversationId" = v.id ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1),
          v.status::text, v.control_mode, v.control_version,
          (SELECT count(*) FROM public.whatsapp_outbound_messages o WHERE o.business_id = v."businessId"
            AND o.conversation_id = v.id AND o.status = 'SENDING')
        FROM public.conversations v JOIN public.customers c
          ON c.id = v."customerId" AND c."businessId" = v."businessId"
        WHERE v."businessId" = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND public.kleva_current_role() IN ('owner','agent')
          AND (before_time IS NULL OR (v."updatedAt", v.id) < (before_time, before_id))
        ORDER BY v."updatedAt" DESC, v.id DESC LIMIT LEAST(GREATEST(page_size, 1), 100)
      $$;

      CREATE FUNCTION public.kleva_inbox_messages(target_id uuid, page_size integer, before_time timestamptz DEFAULT NULL, before_id uuid DEFAULT NULL)
      RETURNS TABLE (id uuid, direction text, content text, status text, provider_message_id text,
        created_at timestamptz, authorization_kind text, error_classification text)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT m.id, m.direction::text, m.content, COALESCE(o.status, m.status)::text,
          m."whatsappMessageId"::text, m."createdAt", o.authorization_kind, o.last_error
        FROM public.messages m JOIN public.conversations v ON v.id = m."conversationId"
          AND v."businessId" = m."businessId"
        LEFT JOIN public.whatsapp_outbound_messages o ON o.message_id = m.id AND o.business_id = m."businessId"
        WHERE v.id = target_id AND v."businessId" = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND public.kleva_current_role() IN ('owner','agent')
          AND (before_time IS NULL OR (m."createdAt", m.id) < (before_time, before_id))
        ORDER BY m."createdAt" DESC, m.id DESC LIMIT LEAST(GREATEST(page_size, 1), 100)
      $$;

      CREATE FUNCTION public.kleva_inbox_conversation(target_id uuid)
      RETURNS TABLE (id uuid, customer_name text, customer_whatsapp_id text, status text,
        control_mode text, control_version bigint, control_changed_at timestamptz, in_flight bigint)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT v.id, c.name::text, c."whatsappId"::text, v.status::text, v.control_mode,
          v.control_version, v.control_changed_at,
          (SELECT count(*) FROM public.whatsapp_outbound_messages o WHERE o.business_id = v."businessId"
            AND o.conversation_id = v.id AND o.status = 'SENDING')
        FROM public.conversations v JOIN public.customers c
          ON c.id = v."customerId" AND c."businessId" = v."businessId"
        WHERE v.id = target_id AND v."businessId" = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND public.kleva_current_role() IN ('owner','agent')
      $$;

      CREATE FUNCTION public.kleva_inbox_change_control(target_id uuid, next_mode text)
      RETURNS TABLE (id uuid, control_mode text, control_version bigint, control_changed_at timestamptz, changed boolean)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        actor_id uuid := public.kleva_current_account(); old_mode text; version_value bigint; changed_at timestamptz;
      BEGIN
        IF public.kleva_current_role() NOT IN ('owner','agent') OR next_mode NOT IN ('AUTO','HUMAN') THEN
          RAISE EXCEPTION 'inbox access denied' USING ERRCODE = '42501';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended('conversation:' || tenant_id::text || ':' || target_id::text, 0));
        SELECT v.control_mode, v.control_version, v.control_changed_at
          INTO old_mode, version_value, changed_at FROM public.conversations v
          WHERE v.id = target_id AND v."businessId" = tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        IF old_mode = next_mode THEN
          RETURN QUERY SELECT target_id, old_mode, version_value, changed_at, false; RETURN;
        END IF;
        UPDATE public.conversations SET control_mode = next_mode, control_version = version_value + 1,
          takeover_actor_account_id = CASE WHEN next_mode = 'HUMAN' THEN actor_id ELSE NULL END,
          takeover_at = CASE WHEN next_mode = 'HUMAN' THEN now() ELSE NULL END,
          control_changed_at = now(), "updatedAt" = now()
          WHERE conversations.id = target_id AND conversations."businessId" = tenant_id
          RETURNING conversations.control_version, conversations.control_changed_at INTO version_value, changed_at;
        INSERT INTO public.conversation_control_audit
          (business_id, conversation_id, actor_account_id, previous_mode, next_mode, control_version)
          VALUES (tenant_id, target_id, actor_id, old_mode, next_mode, version_value);
        RETURN QUERY SELECT target_id, next_mode, version_value, changed_at, true;
      END $$;

      CREATE FUNCTION public.kleva_inbox_recipient(target_id uuid)
      RETURNS TABLE (whatsapp_id text, control_mode text)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT c."whatsappId"::text, v.control_mode FROM public.conversations v JOIN public.customers c
          ON c.id = v."customerId" AND c."businessId" = v."businessId"
        WHERE v.id = target_id AND v."businessId" = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND public.kleva_current_role() IN ('owner','agent')
      $$;
      REVOKE ALL ON FUNCTION public.kleva_inbox_list(integer,timestamptz,uuid),
        public.kleva_inbox_messages(uuid,integer,timestamptz,uuid), public.kleva_inbox_conversation(uuid),
        public.kleva_inbox_change_control(uuid,text), public.kleva_inbox_recipient(uuid) FROM PUBLIC;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM public.conversation_control_audit) THEN
          RAISE EXCEPTION 'Conversation control audit exists; preserve the schema for rollback.';
        END IF;
      END $$;
      DROP FUNCTION public.kleva_inbox_recipient(uuid);
      DROP FUNCTION public.kleva_inbox_change_control(uuid,text);
      DROP FUNCTION public.kleva_inbox_conversation(uuid);
      DROP FUNCTION public.kleva_inbox_messages(uuid,integer,timestamptz,uuid);
      DROP FUNCTION public.kleva_inbox_list(integer,timestamptz,uuid);
      DROP TABLE public.conversation_control_audit;
      DROP INDEX public."IDX_conversations_inbox_order";
      ALTER TABLE public.whatsapp_outbound_messages DROP COLUMN control_version, DROP COLUMN authorization_kind;
      ALTER TABLE public.whatsapp_outbound_messages DROP CONSTRAINT whatsapp_outbound_messages_status_check,
        ADD CONSTRAINT whatsapp_outbound_messages_status_check CHECK
          (status IN ('RESERVED','SENDING','ACCEPTED','DELIVERED','READ','FAILED','UNCERTAIN'));
      ALTER TABLE public.whatsapp_response_intents DROP CONSTRAINT whatsapp_response_intents_status_check,
        ADD CONSTRAINT whatsapp_response_intents_status_check CHECK
          (status IN ('PENDING','GENERATING','GENERATED','QUEUED','COMPLETED','FAILED','UNCERTAIN')),
        DROP COLUMN authorized_control_version;
      ALTER TABLE public.conversations DROP CONSTRAINT "FK_conversation_takeover_actor",
        DROP COLUMN control_changed_at, DROP COLUMN takeover_at, DROP COLUMN takeover_actor_account_id,
        DROP COLUMN control_version, DROP COLUMN control_mode;
    `);
  }
}
