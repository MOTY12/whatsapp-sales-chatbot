import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Add durable inbox controls without changing the already-applied inbox schema. */
export class SharedInboxOperations1760000000024 implements MigrationInterface {
  name = 'SharedInboxOperations1760000000024';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE public.conversation_inbox_state (
        business_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        assigned_to_account_id uuid,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (business_id, conversation_id),
        FOREIGN KEY (business_id, conversation_id)
          REFERENCES public.conversations("businessId", id) ON DELETE CASCADE,
        FOREIGN KEY (business_id, assigned_to_account_id)
          REFERENCES public.business_members("businessId", "accountId") ON DELETE SET NULL (assigned_to_account_id)
      );
      CREATE INDEX idx_conversation_inbox_state_assignee
        ON public.conversation_inbox_state(business_id, assigned_to_account_id)
        WHERE assigned_to_account_id IS NOT NULL;
      ALTER TABLE public.conversation_inbox_state ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.conversation_inbox_state FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_conversation_inbox_state_internal
        ON public.conversation_inbox_state
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE TABLE public.conversation_inbox_reads (
        business_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        account_id uuid NOT NULL,
        last_read_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (business_id, conversation_id, account_id),
        FOREIGN KEY (business_id, conversation_id)
          REFERENCES public.conversations("businessId", id) ON DELETE CASCADE,
        FOREIGN KEY (business_id, account_id)
          REFERENCES public.business_members("businessId", "accountId") ON DELETE CASCADE
      );
      ALTER TABLE public.conversation_inbox_reads ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.conversation_inbox_reads FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_conversation_inbox_reads_internal ON public.conversation_inbox_reads
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE TABLE public.conversation_internal_notes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        actor_account_id uuid NOT NULL,
        body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (business_id, conversation_id)
          REFERENCES public.conversations("businessId", id) ON DELETE CASCADE,
        FOREIGN KEY (actor_account_id) REFERENCES public.accounts(id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_conversation_internal_notes_thread
        ON public.conversation_internal_notes(business_id, conversation_id, created_at, id);
      ALTER TABLE public.conversation_internal_notes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.conversation_internal_notes FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_conversation_internal_notes_internal
        ON public.conversation_internal_notes
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE INDEX idx_conversations_inbox_status_order
        ON public.conversations("businessId", status, "updatedAt" DESC, id DESC);
      CREATE TABLE public.conversation_inbox_audit (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        actor_account_id uuid NOT NULL,
        event_kind varchar(16) NOT NULL CHECK(event_kind IN ('ASSIGNED','STATUS')),
        previous_value text,
        next_value text,
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (business_id,conversation_id)
          REFERENCES public.conversations("businessId",id) ON DELETE CASCADE,
        FOREIGN KEY (actor_account_id) REFERENCES public.accounts(id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_conversation_inbox_audit_thread
        ON public.conversation_inbox_audit(business_id,conversation_id,created_at,id);
      ALTER TABLE public.conversation_inbox_audit ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.conversation_inbox_audit FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_conversation_inbox_audit_internal ON public.conversation_inbox_audit
        USING(current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK(current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE FUNCTION public.kleva_inbox_list_filtered(
        page_size integer,
        before_time timestamp without time zone,
        before_id uuid,
        status_filter text,
        search_text text
      ) RETURNS TABLE (
        id uuid, customer_name text, customer_whatsapp_id text,
        last_activity timestamp without time zone, preview text, status text,
        control_mode text, control_version bigint, in_flight bigint,
        handoff_needed boolean, assigned_to_account_id uuid, unread_count bigint
      ) LANGUAGE plpgsql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        normalized_status text := lower(COALESCE(status_filter, 'all'));
        normalized_search text := NULLIF(btrim(search_text), '');
        actor_role text := public.kleva_current_role();
      BEGIN
        IF actor_role IS NULL OR actor_role NOT IN ('owner','agent') THEN
          RAISE EXCEPTION 'inbox access denied' USING ERRCODE = '42501';
        END IF;
        IF normalized_status NOT IN ('all','open','closed') THEN
          RAISE EXCEPTION 'invalid conversation filter' USING ERRCODE = '22023';
        END IF;
        IF normalized_search IS NOT NULL AND length(normalized_search) > 100 THEN
          RAISE EXCEPTION 'search text too long' USING ERRCODE = '22023';
        END IF;
        RETURN QUERY
        SELECT v.id, c.name::text, c."whatsappId"::text, v."updatedAt",
          (SELECT m.content FROM public.messages m WHERE m."businessId"=v."businessId"
            AND m."conversationId"=v.id ORDER BY m."createdAt" DESC,m.id DESC LIMIT 1),
          v.status::text, v.control_mode::text, v.control_version,
          (SELECT count(*) FROM public.whatsapp_outbound_messages o WHERE o.business_id=v."businessId"
            AND o.conversation_id=v.id AND o.status='SENDING'),
          EXISTS (SELECT 1 FROM public.ai_response_runs a WHERE a.business_id=v."businessId"
            AND a.conversation_id=v.id AND a.status='HANDOFF_REQUIRED'),
          s.assigned_to_account_id,
          (SELECT count(*) FROM public.messages unread WHERE unread."businessId"=v."businessId"
            AND unread."conversationId"=v.id AND unread.direction='inbound'
          AND (reads.last_read_at IS NULL OR unread."createdAt">reads.last_read_at))
        FROM public.conversations v
        JOIN public.customers c ON c.id=v."customerId" AND c."businessId"=v."businessId"
        LEFT JOIN public.conversation_inbox_state s
          ON s.business_id=v."businessId" AND s.conversation_id=v.id
        LEFT JOIN public.conversation_inbox_reads reads
          ON reads.business_id=v."businessId" AND reads.conversation_id=v.id
          AND reads.account_id=public.kleva_current_account()
        WHERE v."businessId"=tenant_id
          AND (normalized_status='all'
            OR (normalized_status='open' AND COALESCE(lower(v.status),'open') NOT IN ('closed','resolved'))
            OR (normalized_status='closed' AND lower(v.status) IN ('closed','resolved')))
          AND (before_time IS NULL OR (v."updatedAt",v.id)<(before_time,before_id))
          AND (normalized_search IS NULL
            OR strpos(lower(COALESCE(c.name,'')),lower(normalized_search)) > 0
            OR strpos(lower(COALESCE(c."whatsappId",'')),lower(normalized_search)) > 0
            OR EXISTS (SELECT 1 FROM public.messages sm WHERE sm."businessId"=v."businessId"
              AND sm."conversationId"=v.id AND strpos(lower(sm.content),lower(normalized_search)) > 0))
        ORDER BY v."updatedAt" DESC,v.id DESC
        LIMIT LEAST(GREATEST(page_size,1),101);
      END $$;

      CREATE FUNCTION public.kleva_inbox_conversation_v2(target_id uuid)
      RETURNS TABLE (
        id uuid,customer_name text,customer_whatsapp_id text,status text,control_mode text,
        control_version bigint,control_changed_at timestamptz,in_flight bigint,
        handoff_needed boolean,assigned_to_account_id uuid,unread_count bigint
      ) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
        SELECT v.id,c.name::text,c."whatsappId"::text,v.status::text,v.control_mode,
          v.control_version,v.control_changed_at,
          (SELECT count(*) FROM public.whatsapp_outbound_messages o WHERE o.business_id=v."businessId"
            AND o.conversation_id=v.id AND o.status='SENDING'),
          EXISTS(SELECT 1 FROM public.ai_response_runs a WHERE a.business_id=v."businessId"
            AND a.conversation_id=v.id AND a.status='HANDOFF_REQUIRED'),
          s.assigned_to_account_id,
          (SELECT count(*) FROM public.messages unread WHERE unread."businessId"=v."businessId"
            AND unread."conversationId"=v.id AND unread.direction='inbound'
            AND (reads.last_read_at IS NULL OR unread."createdAt">reads.last_read_at))
        FROM public.conversations v JOIN public.customers c
          ON c.id=v."customerId" AND c."businessId"=v."businessId"
        LEFT JOIN public.conversation_inbox_state s ON s.business_id=v."businessId" AND s.conversation_id=v.id
        LEFT JOIN public.conversation_inbox_reads reads
          ON reads.business_id=v."businessId" AND reads.conversation_id=v.id
          AND reads.account_id=public.kleva_current_account()
        WHERE v.id=target_id AND v."businessId"=NULLIF(current_setting('kleva.business_id',true),'')::uuid
          AND public.kleva_current_role() IN ('owner','agent')
      $$;

      CREATE FUNCTION public.kleva_inbox_members()
      RETURNS TABLE(account_id uuid, role text)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
        SELECT bm."accountId", bm.role::text FROM public.business_members bm
        WHERE bm."businessId"=NULLIF(current_setting('kleva.business_id',true),'')::uuid
          AND bm.status='active' AND bm."accountId" IS NOT NULL
          AND bm.role IN ('owner','agent')
          AND public.kleva_current_role() IN ('owner','agent')
        ORDER BY bm.role,bm."accountId"
      $$;

      CREATE FUNCTION public.kleva_inbox_assign(target_id uuid, assignee_id uuid)
      RETURNS TABLE(assigned_to_account_id uuid, changed boolean)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        old_assignee uuid; actor_role text := public.kleva_current_role();
      BEGIN
        IF actor_role IS NULL OR actor_role NOT IN ('owner','agent') THEN
          RAISE EXCEPTION 'inbox access denied' USING ERRCODE='42501';
        END IF;
        IF assignee_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.business_members bm WHERE bm."businessId"=tenant_id
            AND bm."accountId"=assignee_id AND bm.status='active' AND bm.role IN ('owner','agent')
        ) THEN RAISE EXCEPTION 'invalid inbox assignee' USING ERRCODE='22023'; END IF;
        PERFORM 1 FROM public.conversations v WHERE v.id=target_id AND v."businessId"=tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        SELECT s.assigned_to_account_id INTO old_assignee FROM public.conversation_inbox_state s
          WHERE s.business_id=tenant_id AND s.conversation_id=target_id;
        INSERT INTO public.conversation_inbox_state(business_id,conversation_id,assigned_to_account_id)
          VALUES(tenant_id,target_id,assignee_id)
        ON CONFLICT(business_id,conversation_id) DO UPDATE
          SET assigned_to_account_id=EXCLUDED.assigned_to_account_id,updated_at=now();
        IF old_assignee IS DISTINCT FROM assignee_id THEN
          INSERT INTO public.conversation_inbox_audit(business_id,conversation_id,actor_account_id,event_kind,previous_value,next_value)
            VALUES(tenant_id,target_id,public.kleva_current_account(),'ASSIGNED',old_assignee::text,assignee_id::text);
        END IF;
        RETURN QUERY SELECT assignee_id, old_assignee IS DISTINCT FROM assignee_id;
      END $$;

      CREATE FUNCTION public.kleva_inbox_mark_read(target_id uuid)
      RETURNS TABLE(last_read_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        actor_id uuid := public.kleva_current_account();
        actor_role text := public.kleva_current_role();
      BEGIN
        IF actor_role IS NULL OR actor_role NOT IN ('owner','agent') THEN
          RAISE EXCEPTION 'inbox access denied' USING ERRCODE='42501';
        END IF;
        PERFORM 1 FROM public.conversations v WHERE v.id=target_id AND v."businessId"=tenant_id;
        IF NOT FOUND THEN RETURN; END IF;
        IF actor_id IS NULL THEN RAISE EXCEPTION 'inbox access denied' USING ERRCODE='42501'; END IF;
        INSERT INTO public.conversation_inbox_reads(business_id,conversation_id,account_id,last_read_at)
          VALUES(tenant_id,target_id,actor_id,now())
        ON CONFLICT(business_id,conversation_id,account_id) DO UPDATE
          SET last_read_at=GREATEST(public.conversation_inbox_reads.last_read_at,now());
        RETURN QUERY SELECT r.last_read_at FROM public.conversation_inbox_reads r
          WHERE r.business_id=tenant_id AND r.conversation_id=target_id AND r.account_id=actor_id;
      END $$;

      CREATE FUNCTION public.kleva_inbox_notes(target_id uuid)
      RETURNS TABLE(id uuid,body text,actor_account_id uuid,created_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
        SELECT n.id,n.body,n.actor_account_id,n.created_at FROM public.conversation_internal_notes n
        WHERE n.business_id=NULLIF(current_setting('kleva.business_id',true),'')::uuid
          AND n.conversation_id=target_id AND public.kleva_current_role() IN ('owner','agent')
        ORDER BY n.created_at,n.id
      $$;

      CREATE FUNCTION public.kleva_inbox_add_note(target_id uuid,note_body text)
      RETURNS TABLE(id uuid,body text,actor_account_id uuid,created_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        actor_id uuid := public.kleva_current_account();
        actor_role text := public.kleva_current_role();
      BEGIN
        IF actor_role IS NULL OR actor_role NOT IN ('owner','agent') OR actor_id IS NULL THEN
          RAISE EXCEPTION 'inbox access denied' USING ERRCODE='42501';
        END IF;
        IF note_body IS NULL OR length(btrim(note_body)) NOT BETWEEN 1 AND 2000 THEN
          RAISE EXCEPTION 'invalid internal note' USING ERRCODE='22023';
        END IF;
        IF NOT EXISTS(SELECT 1 FROM public.conversations v WHERE v.id=target_id AND v."businessId"=tenant_id) THEN RETURN; END IF;
        RETURN QUERY INSERT INTO public.conversation_internal_notes(business_id,conversation_id,actor_account_id,body)
          VALUES(tenant_id,target_id,actor_id,btrim(note_body)) RETURNING
            conversation_internal_notes.id,conversation_internal_notes.body,
            conversation_internal_notes.actor_account_id,conversation_internal_notes.created_at;
      END $$;

      CREATE FUNCTION public.kleva_inbox_set_status(target_id uuid,next_status text)
      RETURNS TABLE(status text,updated_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        actor_role text := public.kleva_current_role(); actor_id uuid := public.kleva_current_account();
        old_mode text; next_version bigint; changed_at timestamptz;
      BEGIN
        IF actor_role IS NULL OR actor_role NOT IN ('owner','agent') OR next_status NOT IN ('open','closed') THEN
          RAISE EXCEPTION 'invalid conversation status' USING ERRCODE='22023';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended('conversation:'||tenant_id::text||':'||target_id::text,0));
        SELECT v.control_mode,v.control_version INTO old_mode,next_version FROM public.conversations v
          WHERE v.id=target_id AND v."businessId"=tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        IF lower(COALESCE((SELECT v.status FROM public.conversations v WHERE v.id=target_id AND v."businessId"=tenant_id),'open'))
             IS DISTINCT FROM next_status THEN
          INSERT INTO public.conversation_inbox_audit(business_id,conversation_id,actor_account_id,event_kind,previous_value,next_value)
            VALUES(tenant_id,target_id,actor_id,'STATUS',
              (SELECT v.status FROM public.conversations v WHERE v.id=target_id AND v."businessId"=tenant_id),next_status);
        END IF;
        IF next_status='closed' AND old_mode='AUTO' THEN
          UPDATE public.conversations v SET status=next_status,control_mode='HUMAN',
            control_version=next_version+1,takeover_actor_account_id=actor_id,
            takeover_at=now(),control_changed_at=now(),"updatedAt"=now()
          WHERE v.id=target_id AND v."businessId"=tenant_id
          RETURNING v.control_version,v."updatedAt" INTO next_version,changed_at;
          INSERT INTO public.conversation_control_audit
            (business_id,conversation_id,actor_account_id,previous_mode,next_mode,control_version)
            VALUES(tenant_id,target_id,actor_id,'AUTO','HUMAN',next_version);
        ELSE
          UPDATE public.conversations v SET status=next_status,"updatedAt"=now()
            WHERE v.id=target_id AND v."businessId"=tenant_id
            RETURNING v."updatedAt" INTO changed_at;
        END IF;
        RETURN QUERY SELECT next_status,changed_at;
      END $$;

      CREATE FUNCTION public.kleva_inbox_recipient_v2(target_id uuid)
      RETURNS TABLE(whatsapp_id text,control_mode text,status text)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
        SELECT c."whatsappId"::text,v.control_mode,COALESCE(v.status,'open')::text
        FROM public.conversations v JOIN public.customers c
          ON c.id=v."customerId" AND c."businessId"=v."businessId"
        WHERE v.id=target_id AND v."businessId"=NULLIF(current_setting('kleva.business_id',true),'')::uuid
          AND public.kleva_current_role() IN ('owner','agent')
      $$;

      CREATE OR REPLACE FUNCTION public.kleva_inbox_change_control(target_id uuid, next_mode text)
      RETURNS TABLE (id uuid, control_mode text, control_version bigint, control_changed_at timestamptz, changed boolean)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        actor_id uuid := public.kleva_current_account(); old_mode text; version_value bigint; changed_at timestamptz;
        conversation_status text;
      BEGIN
        IF public.kleva_current_role() IS NULL OR public.kleva_current_role() NOT IN ('owner','agent')
          OR next_mode IS NULL OR next_mode NOT IN ('AUTO','HUMAN') OR actor_id IS NULL THEN
          RAISE EXCEPTION 'inbox access denied' USING ERRCODE = '42501';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended('conversation:' || tenant_id::text || ':' || target_id::text, 0));
        SELECT v.control_mode, v.control_version, v.control_changed_at, lower(COALESCE(v.status,'open'))
          INTO old_mode, version_value, changed_at, conversation_status FROM public.conversations v
          WHERE v.id = target_id AND v."businessId" = tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        IF next_mode='AUTO' AND conversation_status IN ('closed','resolved') THEN
          RAISE EXCEPTION 'reopen conversation before resuming automation' USING ERRCODE='22023';
        END IF;
        IF old_mode = next_mode THEN
          RETURN QUERY SELECT target_id, old_mode, version_value, changed_at, false; RETURN;
        END IF;
        UPDATE public.conversations SET control_mode = next_mode, control_version = version_value + 1,
          takeover_actor_account_id = CASE WHEN next_mode = 'HUMAN' THEN actor_id ELSE NULL END,
          takeover_at = CASE WHEN next_mode = 'HUMAN' THEN now() ELSE NULL END,
          control_changed_at = now()
          WHERE conversations.id = target_id AND conversations."businessId" = tenant_id
          RETURNING conversations.control_version, conversations.control_changed_at INTO version_value, changed_at;
        INSERT INTO public.conversation_control_audit
          (business_id, conversation_id, actor_account_id, previous_mode, next_mode, control_version)
          VALUES (tenant_id, target_id, actor_id, old_mode, next_mode, version_value);
        RETURN QUERY SELECT target_id, next_mode, version_value, changed_at, true;
      END $$;

      CREATE FUNCTION public.kleva_reopen_inbound_conversation()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      BEGIN
        IF NEW.direction='inbound' THEN
          PERFORM pg_advisory_xact_lock(hashtextextended(
            'conversation:' || NEW."businessId"::text || ':' || NEW."conversationId"::text, 0));
          UPDATE public.conversations SET status='open',"updatedAt"=GREATEST("updatedAt",NEW."createdAt")
            WHERE id=NEW."conversationId" AND "businessId"=NEW."businessId"
              AND lower(COALESCE(status,'open')) IN ('closed','resolved');
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER trg_reopen_inbound_conversation
        AFTER INSERT ON public.messages FOR EACH ROW
        EXECUTE FUNCTION public.kleva_reopen_inbound_conversation();

      REVOKE ALL ON FUNCTION public.kleva_inbox_list_filtered(integer,timestamp,uuid,text,text),
        public.kleva_inbox_conversation_v2(uuid),
        public.kleva_inbox_members(),public.kleva_inbox_assign(uuid,uuid),public.kleva_inbox_mark_read(uuid),
        public.kleva_inbox_notes(uuid),public.kleva_inbox_add_note(uuid,text),public.kleva_inbox_set_status(uuid,text),
        public.kleva_inbox_recipient_v2(uuid),public.kleva_reopen_inbound_conversation()
        FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_merchant_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_inbox_list_filtered(integer,timestamp,uuid,text,text), public.kleva_inbox_conversation_v2(uuid), public.kleva_inbox_members(), public.kleva_inbox_assign(uuid,uuid), public.kleva_inbox_mark_read(uuid), public.kleva_inbox_notes(uuid), public.kleva_inbox_add_note(uuid,text), public.kleva_inbox_set_status(uuid,text), public.kleva_inbox_recipient_v2(uuid) TO %I', role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DO $$ BEGIN
        IF EXISTS(SELECT 1 FROM public.conversation_internal_notes)
          OR EXISTS(SELECT 1 FROM public.conversation_inbox_state)
          OR EXISTS(SELECT 1 FROM public.conversation_inbox_reads)
          OR EXISTS(SELECT 1 FROM public.conversation_inbox_audit) THEN
          RAISE EXCEPTION 'Inbox notes or read/assignment state exists; preserve this migration.';
        END IF;
      END $$;
      DROP FUNCTION public.kleva_inbox_set_status(uuid,text);
      DROP FUNCTION public.kleva_inbox_conversation_v2(uuid);
      DROP TRIGGER trg_reopen_inbound_conversation ON public.messages;
      DROP FUNCTION public.kleva_reopen_inbound_conversation();
      DROP FUNCTION public.kleva_inbox_recipient_v2(uuid);
      DROP FUNCTION public.kleva_inbox_add_note(uuid,text);
      DROP FUNCTION public.kleva_inbox_notes(uuid);
      DROP FUNCTION public.kleva_inbox_mark_read(uuid);
      DROP FUNCTION public.kleva_inbox_assign(uuid,uuid);
      DROP FUNCTION public.kleva_inbox_members();
      DROP FUNCTION public.kleva_inbox_list_filtered(integer,timestamp,uuid,text,text);
      DROP INDEX public.idx_conversations_inbox_status_order;
      DROP TABLE public.conversation_inbox_audit;
      DROP TABLE public.conversation_internal_notes;
      DROP TABLE public.conversation_inbox_reads;
      DROP TABLE public.conversation_inbox_state;

      CREATE OR REPLACE FUNCTION public.kleva_inbox_change_control(target_id uuid, next_mode text)
      RETURNS TABLE (id uuid, control_mode text, control_version bigint, control_changed_at timestamptz, changed boolean)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        actor_id uuid := public.kleva_current_account(); old_mode text; version_value bigint; changed_at timestamptz;
      BEGIN
        IF public.kleva_current_role() IS NULL OR public.kleva_current_role() NOT IN ('owner','agent')
          OR next_mode IS NULL OR next_mode NOT IN ('AUTO','HUMAN') OR actor_id IS NULL THEN
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
          control_changed_at = now()
          WHERE conversations.id = target_id AND conversations."businessId" = tenant_id
          RETURNING conversations.control_version, conversations.control_changed_at INTO version_value, changed_at;
        INSERT INTO public.conversation_control_audit
          (business_id, conversation_id, actor_account_id, previous_mode, next_mode, control_version)
          VALUES (tenant_id, target_id, actor_id, old_mode, next_mode, version_value);
        RETURN QUERY SELECT target_id, next_mode, version_value, changed_at, true;
      END $$;
    `);
  }
}
