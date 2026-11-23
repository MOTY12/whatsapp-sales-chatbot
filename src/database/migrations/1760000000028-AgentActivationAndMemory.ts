import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Durable extractive conversation memory and backend-enforced AI readiness. */
export class AgentActivationAndMemory1760000000028 implements MigrationInterface {
  name = 'AgentActivationAndMemory1760000000028';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE public.conversation_summaries (
        business_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        summary varchar(900) NOT NULL CHECK (length(summary) BETWEEN 1 AND 900),
        covered_through_created_at timestamptz NOT NULL,
        covered_through_message_id uuid NOT NULL,
        revision integer NOT NULL CHECK (revision > 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (business_id,conversation_id),
        CONSTRAINT fk_conversation_summaries_business_conversation
          FOREIGN KEY (business_id,conversation_id)
          REFERENCES public.conversations("businessId",id) ON DELETE CASCADE,
        CONSTRAINT fk_conversation_summaries_watermark_message
          FOREIGN KEY (business_id,covered_through_message_id)
          REFERENCES public.messages("businessId",id) ON DELETE RESTRICT
      );
      ALTER TABLE public.conversation_summaries ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.conversation_summaries FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_conversation_summaries_internal ON public.conversation_summaries
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.conversation_summaries TO %I',role_name);
        END LOOP;
      END $$;

      CREATE FUNCTION public.kleva_agent_tool_fence()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE current_run_status text;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' THEN
          RAISE EXCEPTION 'agent tool access denied' USING ERRCODE='42501';
        END IF;
        IF (TG_OP='INSERT' AND NEW.status<>'STARTED') OR
          (TG_OP='UPDATE' AND NEW.status<>'COMPLETED') THEN
          RETURN NEW;
        END IF;
        IF TG_OP='UPDATE' AND NEW.status='COMPLETED' AND OLD.status='STARTED'
          AND NEW.tool_name='request_human_handoff'
          AND EXISTS (SELECT 1 FROM public.agent_tool_handoff_events h WHERE h.execution_id=NEW.id
            AND h.business_id=NEW.business_id AND h.ai_run_id=NEW.ai_run_id) THEN
          RETURN NEW;
        END IF;
        SELECT a.status INTO current_run_status
        FROM public.ai_response_runs a
        JOIN public.conversations c ON c.id=a.conversation_id AND c."businessId"=a.business_id
        JOIN public.messages current_message ON current_message.id=a.inbound_message_id
          AND current_message."businessId"=a.business_id AND current_message."conversationId"=a.conversation_id
        WHERE a.id=NEW.ai_run_id AND a.business_id=NEW.business_id
          AND a.conversation_id=NEW.conversation_id
          AND c.control_mode='AUTO' AND c.control_version=a.authorized_control_version
          AND a.status IN ('PENDING','PROCESSING','GENERATED')
          AND NOT EXISTS (SELECT 1 FROM public.messages newer
            WHERE newer."businessId"=a.business_id AND newer."conversationId"=a.conversation_id
              AND newer.direction='inbound'
              AND (newer."createdAt",newer.id)>(current_message."createdAt",current_message.id))
        FOR UPDATE OF c;
        IF current_run_status IS NULL THEN
          RAISE EXCEPTION 'agent tool run is stale' USING ERRCODE='40001';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER trg_agent_tool_fence
        BEFORE INSERT OR UPDATE OF status ON public.agent_tool_executions
        FOR EACH ROW EXECUTE FUNCTION public.kleva_agent_tool_fence();

      CREATE FUNCTION public.kleva_pilot_readiness()
      RETURNS TABLE(business_active boolean,connection_id uuid,whatsapp_verified boolean,
        published_knowledge boolean,assistant_configured boolean,pilot_approved boolean,
        approval_matches_connection boolean,human_takeover_count bigint)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        actor_role text := public.kleva_current_role();
      BEGIN
        IF tenant_id IS NULL OR actor_role NOT IN ('owner','editor','agent') THEN
          RAISE EXCEPTION 'pilot status access denied' USING ERRCODE='42501';
        END IF;
        RETURN QUERY
        WITH connection AS (
          SELECT c.id,c.status,c."verifiedAt" FROM public.channel_connections c
          WHERE c."businessId"=tenant_id AND c.provider='whatsapp'
          ORDER BY c."updatedAt" DESC LIMIT 1
        ), enrollment AS (
          SELECT e.status,e.connection_id FROM public.business_pilot_enrollments e
          WHERE e.business_id=tenant_id AND e.status IN ('PENDING_REVIEW','ACTIVE')
          ORDER BY e.created_at DESC LIMIT 1
        )
        SELECT b.status='active',c.id,
          COALESCE(c.status='active' AND c."verifiedAt" IS NOT NULL,false),
          EXISTS (SELECT 1 FROM public.knowledge_faqs f WHERE f.business_id=tenant_id AND f.published_revision_id IS NOT NULL)
            OR EXISTS (SELECT 1 FROM public.merchant_products p WHERE p.business_id=tenant_id AND p.published_revision_id IS NOT NULL),
          EXISTS (SELECT 1 FROM public.assistant_configurations ac WHERE ac.business_id=tenant_id),
          COALESCE(e.status='ACTIVE',false),
          COALESCE(e.status='ACTIVE' AND e.connection_id=c.id,false),
          (SELECT count(*) FROM public.conversations v WHERE v."businessId"=tenant_id
            AND v.control_mode='HUMAN' AND lower(COALESCE(v.status,'open')) NOT IN ('closed','resolved'))
        FROM public.businesses b CROSS JOIN (SELECT 1) seed
        LEFT JOIN connection c ON true LEFT JOIN enrollment e ON true
        WHERE b.id=tenant_id;
      END $$;

      DROP FUNCTION public.kleva_pilot_activate(uuid,text);
      CREATE FUNCTION public.kleva_pilot_activate(target_enrollment uuid,evidence_reference text,
        default_ai_input integer,default_ai_output integer,default_whatsapp integer,default_request_tokens integer)
      RETURNS TABLE(enrollment_id uuid,business_id uuid,connection_id uuid,
        status varchar,activated_at timestamptz,activated_by text,activation_reference text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      BEGIN
        IF session_user !~ '^kleva_pilot_operator_[a-z0-9_]{1,40}$' THEN
          RAISE EXCEPTION 'pilot operator role required' USING ERRCODE='42501';
        END IF;
        IF evidence_reference IS NULL OR evidence_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{5,199}$' THEN
          RAISE EXCEPTION 'valid approval evidence reference required' USING ERRCODE='22023';
        END IF;
        IF default_ai_input<1 OR default_ai_output<1 OR default_whatsapp<1 OR default_request_tokens<1 THEN
          RAISE EXCEPTION 'positive usage limits are required' USING ERRCODE='22023';
        END IF;
        RETURN QUERY
        UPDATE public.business_pilot_enrollments e
          SET status='ACTIVE',activated_at=now(),activated_by=session_user,
              activation_reference=evidence_reference,updated_at=now()
          FROM public.businesses b,public.channel_connections c
          WHERE e.id=target_enrollment AND e.status='PENDING_REVIEW'
            AND b.id=e.business_id AND b.status='active'
            AND c.id=e.connection_id AND c."businessId"=e.business_id
            AND c.provider='whatsapp' AND c.status='active' AND c."verifiedAt" IS NOT NULL
            AND (EXISTS (SELECT 1 FROM public.knowledge_faqs f WHERE f.business_id=e.business_id AND f.published_revision_id IS NOT NULL)
              OR EXISTS (SELECT 1 FROM public.merchant_products p WHERE p.business_id=e.business_id AND p.published_revision_id IS NOT NULL))
            AND EXISTS (SELECT 1 FROM public.assistant_configurations ac WHERE ac.business_id=e.business_id)
            AND COALESCE((SELECT l.monthly_ai_input_tokens FROM public.business_usage_limits l
                WHERE l.business_id=e.business_id),default_ai_input) > COALESCE((
                SELECT sum(u.reserved_amount-u.released_amount) FROM public.usage_reservations u
                WHERE u.business_id=e.business_id AND u.category='ai_input_tokens'
                  AND u.period_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date),0)
            AND COALESCE((SELECT l.monthly_ai_output_tokens FROM public.business_usage_limits l
                WHERE l.business_id=e.business_id),default_ai_output) > COALESCE((
                SELECT sum(u.reserved_amount-u.released_amount) FROM public.usage_reservations u
                WHERE u.business_id=e.business_id AND u.category='ai_output_tokens'
                  AND u.period_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date),0)
            AND COALESCE((SELECT l.monthly_whatsapp_messages FROM public.business_usage_limits l
                WHERE l.business_id=e.business_id),default_whatsapp) > COALESCE((
                SELECT sum(u.reserved_amount-u.released_amount) FROM public.usage_reservations u
                WHERE u.business_id=e.business_id AND u.category='whatsapp_outbound'
                  AND u.period_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date),0)
            AND COALESCE((SELECT l.ai_tokens_per_request FROM public.business_usage_limits l
                WHERE l.business_id=e.business_id),default_request_tokens)>0
          RETURNING e.id,e.business_id,e.connection_id,e.status,e.activated_at,e.activated_by,e.activation_reference;
      END $$;

      REVOKE ALL ON FUNCTION public.kleva_pilot_readiness() FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_pilot_activate(uuid,text,integer,integer,integer,integer) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_merchant_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_pilot_readiness() TO %I',role_name);
        END LOOP;
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname ~ '^kleva_pilot_operator_[a-z0-9_]{1,40}$' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_pilot_activate(uuid,text,integer,integer,integer,integer) TO %I',role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    const [row] = (await runner.query(
      'SELECT count(*)::bigint AS count FROM public.conversation_summaries',
    )) as { count: string }[];
    if (Number(row?.count ?? 0) > 0)
      throw new Error('Conversation memory exists; preserve the migration.');
    await runner.query(`
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_merchant_%' LOOP
          EXECUTE format('REVOKE EXECUTE ON FUNCTION public.kleva_pilot_readiness() FROM %I',role_name);
        END LOOP;
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('REVOKE SELECT,INSERT,UPDATE ON public.conversation_summaries FROM %I',role_name);
        END LOOP;
      END $$;
      DROP FUNCTION public.kleva_pilot_readiness();
      DROP FUNCTION public.kleva_pilot_activate(uuid,text,integer,integer,integer,integer);
      DROP TRIGGER trg_agent_tool_fence ON public.agent_tool_executions;
      DROP FUNCTION public.kleva_agent_tool_fence();
      DROP TABLE public.conversation_summaries;
      CREATE FUNCTION public.kleva_pilot_activate(target_enrollment uuid,evidence_reference text)
      RETURNS TABLE(enrollment_id uuid,business_id uuid,connection_id uuid,
        status varchar,activated_at timestamptz,activated_by text,activation_reference text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      BEGIN
        IF session_user !~ '^kleva_pilot_operator_[a-z0-9_]{1,40}$' THEN
          RAISE EXCEPTION 'pilot operator role required' USING ERRCODE='42501';
        END IF;
        IF evidence_reference IS NULL OR evidence_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{5,199}$' THEN
          RAISE EXCEPTION 'valid approval evidence reference required' USING ERRCODE='22023';
        END IF;
        RETURN QUERY UPDATE public.business_pilot_enrollments e
          SET status='ACTIVE',activated_at=now(),activated_by=session_user,
              activation_reference=evidence_reference,updated_at=now()
          FROM public.businesses b,public.channel_connections c
          WHERE e.id=target_enrollment AND e.status='PENDING_REVIEW' AND b.id=e.business_id AND b.status='active'
            AND c.id=e.connection_id AND c."businessId"=e.business_id AND c.provider='whatsapp'
            AND c.status='active' AND c."verifiedAt" IS NOT NULL
          RETURNING e.id,e.business_id,e.connection_id,e.status,e.activated_at,e.activated_by,e.activation_reference;
      END $$;
      REVOKE ALL ON FUNCTION public.kleva_pilot_activate(uuid,text) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname ~ '^kleva_pilot_operator_[a-z0-9_]{1,40}$' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_pilot_activate(uuid,text) TO %I',role_name);
        END LOOP;
      END $$;
    `);
  }
}
