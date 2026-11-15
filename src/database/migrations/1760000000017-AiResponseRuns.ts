import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AiResponseRuns1760000000017 implements MigrationInterface {
  name = 'AiResponseRuns1760000000017';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE public.ai_response_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        inbound_message_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        lead_id uuid,
        authorized_control_version bigint NOT NULL,
        status varchar(24) NOT NULL DEFAULT 'PENDING' CHECK (status IN
          ('PENDING','PROCESSING','GENERATED','QUEUED','COMPLETED','ABSTAINED','HANDOFF_REQUIRED','SKIPPED','FAILED')),
        evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
        reply text,
        outbound_message_id uuid,
        error_category varchar(40),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        CONSTRAINT uq_ai_response_inbound UNIQUE (business_id, inbound_message_id),
        CONSTRAINT fk_ai_response_message FOREIGN KEY (business_id, inbound_message_id)
          REFERENCES public.messages("businessId", id) ON DELETE CASCADE,
        CONSTRAINT fk_ai_response_conversation FOREIGN KEY (business_id, conversation_id)
          REFERENCES public.conversations("businessId", id) ON DELETE CASCADE,
        CONSTRAINT fk_ai_response_lead FOREIGN KEY (lead_id)
          REFERENCES public.merchant_leads(id) ON DELETE SET NULL,
        CONSTRAINT fk_ai_response_outbound FOREIGN KEY (outbound_message_id)
          REFERENCES public.whatsapp_outbound_messages(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_ai_response_handoff ON public.ai_response_runs(business_id, updated_at DESC)
        WHERE status = 'HANDOFF_REQUIRED';
      ALTER TABLE public.ai_response_runs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.ai_response_runs FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_ai_response_internal ON public.ai_response_runs
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_response_runs TO %I', role_name);
        END LOOP;
      END $$;
      DROP FUNCTION public.kleva_inbox_list(integer,timestamptz,uuid);
      DROP FUNCTION public.kleva_inbox_conversation(uuid);
      CREATE FUNCTION public.kleva_inbox_list(page_size integer, before_time timestamptz DEFAULT NULL, before_id uuid DEFAULT NULL)
      RETURNS TABLE (id uuid, customer_name text, customer_whatsapp_id text, last_activity timestamptz,
        preview text, status text, control_mode text, control_version bigint, in_flight bigint, handoff_needed boolean)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT v.id, c.name::text, c."whatsappId"::text, v."updatedAt",
          (SELECT m.content FROM public.messages m WHERE m."businessId" = v."businessId"
            AND m."conversationId" = v.id ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1),
          v.status::text, v.control_mode, v.control_version,
          (SELECT count(*) FROM public.whatsapp_outbound_messages o WHERE o.business_id = v."businessId"
            AND o.conversation_id = v.id AND o.status = 'SENDING'),
          EXISTS (SELECT 1 FROM public.ai_response_runs a WHERE a.business_id = v."businessId"
            AND a.conversation_id = v.id AND a.status = 'HANDOFF_REQUIRED')
        FROM public.conversations v JOIN public.customers c
          ON c.id = v."customerId" AND c."businessId" = v."businessId"
        WHERE v."businessId" = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND public.kleva_current_role() IN ('owner','agent')
          AND (before_time IS NULL OR (v."updatedAt", v.id) < (before_time, before_id))
        ORDER BY v."updatedAt" DESC, v.id DESC LIMIT LEAST(GREATEST(page_size, 1), 100)
      $$;
      CREATE FUNCTION public.kleva_inbox_conversation(target_id uuid)
      RETURNS TABLE (id uuid, customer_name text, customer_whatsapp_id text, status text,
        control_mode text, control_version bigint, control_changed_at timestamptz, in_flight bigint, handoff_needed boolean)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT v.id, c.name::text, c."whatsappId"::text, v.status::text, v.control_mode,
          v.control_version, v.control_changed_at,
          (SELECT count(*) FROM public.whatsapp_outbound_messages o WHERE o.business_id = v."businessId"
            AND o.conversation_id = v.id AND o.status = 'SENDING'),
          EXISTS (SELECT 1 FROM public.ai_response_runs a WHERE a.business_id = v."businessId"
            AND a.conversation_id = v.id AND a.status = 'HANDOFF_REQUIRED')
        FROM public.conversations v JOIN public.customers c
          ON c.id = v."customerId" AND c."businessId" = v."businessId"
        WHERE v.id = target_id AND v."businessId" = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND public.kleva_current_role() IN ('owner','agent')
      $$;
      REVOKE ALL ON FUNCTION public.kleva_inbox_list(integer,timestamptz,uuid) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_inbox_conversation(uuid) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_merchant_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_inbox_list(integer,timestamptz,uuid) TO %I', role_name);
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_inbox_conversation(uuid) TO %I', role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM public.ai_response_runs) THEN
          RAISE EXCEPTION 'AI response history exists; preserve the schema for rollback.';
        END IF;
      END $$;
      DROP FUNCTION public.kleva_inbox_list(integer,timestamptz,uuid);
      DROP FUNCTION public.kleva_inbox_conversation(uuid);
      DROP TABLE public.ai_response_runs;
      CREATE FUNCTION public.kleva_inbox_list(page_size integer, before_time timestamptz DEFAULT NULL, before_id uuid DEFAULT NULL)
      RETURNS TABLE (id uuid, customer_name text, customer_whatsapp_id text, last_activity timestamptz,
        preview text, status text, control_mode text, control_version bigint, in_flight bigint)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT v.id, c.name::text, c."whatsappId"::text, v."updatedAt",
          (SELECT m.content FROM public.messages m WHERE m."businessId" = v."businessId" AND m."conversationId" = v.id
            ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1), v.status::text, v.control_mode, v.control_version,
          (SELECT count(*) FROM public.whatsapp_outbound_messages o WHERE o.business_id = v."businessId"
            AND o.conversation_id = v.id AND o.status = 'SENDING')
        FROM public.conversations v JOIN public.customers c ON c.id = v."customerId" AND c."businessId" = v."businessId"
        WHERE v."businessId" = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND public.kleva_current_role() IN ('owner','agent')
          AND (before_time IS NULL OR (v."updatedAt", v.id) < (before_time, before_id))
        ORDER BY v."updatedAt" DESC, v.id DESC LIMIT LEAST(GREATEST(page_size, 1), 100)
      $$;
      CREATE FUNCTION public.kleva_inbox_conversation(target_id uuid)
      RETURNS TABLE (id uuid, customer_name text, customer_whatsapp_id text, status text,
        control_mode text, control_version bigint, control_changed_at timestamptz, in_flight bigint)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT v.id, c.name::text, c."whatsappId"::text, v.status::text, v.control_mode, v.control_version,
          v.control_changed_at, (SELECT count(*) FROM public.whatsapp_outbound_messages o WHERE o.business_id = v."businessId"
            AND o.conversation_id = v.id AND o.status = 'SENDING')
        FROM public.conversations v JOIN public.customers c ON c.id = v."customerId" AND c."businessId" = v."businessId"
        WHERE v.id = target_id AND v."businessId" = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND public.kleva_current_role() IN ('owner','agent')
      $$;
      REVOKE ALL ON FUNCTION public.kleva_inbox_list(integer,timestamptz,uuid),
        public.kleva_inbox_conversation(uuid) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_merchant_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_inbox_list(integer,timestamptz,uuid) TO %I', role_name);
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_inbox_conversation(uuid) TO %I', role_name);
        END LOOP;
      END $$;
    `);
  }
}
