import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Versioned merchant assistant preferences and synthetic playground limits. */
export class MerchantAiPlayground1760000000025 implements MigrationInterface {
  name = 'MerchantAiPlayground1760000000025';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE public.assistant_configurations (
        business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
        version integer NOT NULL CHECK (version > 0),
        assistant_name varchar(80) NOT NULL,
        greeting varchar(300) NOT NULL,
        tone text NOT NULL CHECK (tone IN ('PROFESSIONAL','FRIENDLY','CASUAL')),
        language text NOT NULL CHECK (language IN ('ENGLISH','NIGERIAN_PIDGIN')),
        response_length text NOT NULL CHECK (response_length IN ('SHORT','BALANCED','DETAILED')),
        handoff_behavior text NOT NULL CHECK (handoff_behavior IN ('OFFER_HUMAN','PRIORITIZE_HUMAN')),
        fallback_response varchar(500) NOT NULL,
        updated_by uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE public.assistant_configurations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.assistant_configurations FORCE ROW LEVEL SECURITY;
      CREATE POLICY assistant_configurations_internal ON public.assistant_configurations
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE TABLE public.assistant_configuration_audit (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
        account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
        revision integer NOT NULL CHECK (revision > 0),
        changed_fields text[] NOT NULL CHECK (cardinality(changed_fields) > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (business_id, revision)
      );
      CREATE INDEX idx_assistant_configuration_audit_business
        ON public.assistant_configuration_audit(business_id, created_at DESC);
      ALTER TABLE public.assistant_configuration_audit ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.assistant_configuration_audit FORCE ROW LEVEL SECURITY;
      CREATE POLICY assistant_configuration_audit_internal ON public.assistant_configuration_audit
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE TABLE public.ai_playground_rate_limits (
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
        account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
        window_start timestamptz NOT NULL,
        request_count integer NOT NULL CHECK (request_count BETWEEN 1 AND 20),
        PRIMARY KEY (business_id, account_id, window_start)
      );
      ALTER TABLE public.ai_playground_rate_limits ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.ai_playground_rate_limits FORCE ROW LEVEL SECURITY;
      CREATE POLICY ai_playground_rate_limits_internal ON public.ai_playground_rate_limits
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE TABLE public.ai_playground_usage (
        request_id uuid PRIMARY KEY,
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
        account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
        outcome text NOT NULL CHECK (outcome IN ('PENDING','ANSWERED','CLARIFICATION','HANDOFF','INSUFFICIENT_EVIDENCE','PROVIDER_FAILURE')),
        input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens BETWEEN 0 AND 3600),
        output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens BETWEEN 0 AND 300),
        duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms BETWEEN 0 AND 30000),
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz
      );
      CREATE INDEX idx_ai_playground_usage_retention ON public.ai_playground_usage(created_at);
      ALTER TABLE public.ai_playground_usage ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.ai_playground_usage FORCE ROW LEVEL SECURITY;
      CREATE POLICY ai_playground_usage_internal ON public.ai_playground_usage
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE FUNCTION public.kleva_assistant_config_read()
      RETURNS TABLE(business_id uuid, version integer, assistant_name text, greeting text,
        tone text, language text, response_length text, handoff_behavior text,
        fallback_response text, updated_at timestamptz)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id',true),'')::uuid;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') THEN
          RAISE EXCEPTION 'assistant configuration access denied' USING ERRCODE='42501';
        END IF;
        RETURN QUERY SELECT tenant_id, COALESCE(c.version,0), COALESCE(c.assistant_name,'Kleva Assistant')::text,
          COALESCE(c.greeting,'Hello! How can I help you today?')::text,
          COALESCE(c.tone,'FRIENDLY')::text, COALESCE(c.language,'ENGLISH')::text,
          COALESCE(c.response_length,'BALANCED')::text, COALESCE(c.handoff_behavior,'OFFER_HUMAN')::text,
          COALESCE(c.fallback_response,'I don’t have enough published information to answer confidently. A team member can help.')::text,
          c.updated_at
        FROM (SELECT 1) seed LEFT JOIN public.assistant_configurations c ON c.business_id=tenant_id;
      END $$;

      CREATE FUNCTION public.kleva_assistant_config_save(expected_version integer, config jsonb)
      RETURNS TABLE(business_id uuid, version integer, assistant_name text, greeting text,
        tone text, language text, response_length text, handoff_behavior text,
        fallback_response text, updated_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        actor_id uuid := public.kleva_current_account(); old_row public.assistant_configurations%ROWTYPE;
        next_version integer; fields text[];
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') THEN
          RAISE EXCEPTION 'assistant configuration access denied' USING ERRCODE='42501';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended(tenant_id::text || ':assistant-config',0));
        IF actor_id IS NULL OR expected_version IS NULL OR expected_version < 0 OR
          config IS NULL OR jsonb_typeof(config) <> 'object' OR
          (SELECT count(*) FROM jsonb_object_keys(config)) <> 8 OR
          NOT (config ?& ARRAY['assistantName','greeting','tone','language','responseLength','handoffBehavior','fallbackResponse','revision']) OR
          jsonb_typeof(config->'revision') <> 'number' OR
          (config->>'revision')::integer <> expected_version OR
          jsonb_typeof(config->'assistantName') <> 'string' OR
          jsonb_typeof(config->'greeting') <> 'string' OR
          jsonb_typeof(config->'tone') <> 'string' OR
          jsonb_typeof(config->'language') <> 'string' OR
          jsonb_typeof(config->'responseLength') <> 'string' OR
          jsonb_typeof(config->'handoffBehavior') <> 'string' OR
          jsonb_typeof(config->'fallbackResponse') <> 'string' OR
          length(btrim(config->>'assistantName')) NOT BETWEEN 1 AND 80 OR
          length(btrim(config->>'greeting')) NOT BETWEEN 1 AND 300 OR
          length(btrim(config->>'fallbackResponse')) NOT BETWEEN 1 AND 500 OR
          config->>'tone' NOT IN ('PROFESSIONAL','FRIENDLY','CASUAL') OR
          config->>'language' NOT IN ('ENGLISH','NIGERIAN_PIDGIN') OR
          config->>'responseLength' NOT IN ('SHORT','BALANCED','DETAILED') OR
          config->>'handoffBehavior' NOT IN ('OFFER_HUMAN','PRIORITIZE_HUMAN') THEN
          RAISE EXCEPTION 'invalid assistant configuration' USING ERRCODE='22023';
        END IF;

        SELECT * INTO old_row FROM public.assistant_configurations c
          WHERE c.business_id=tenant_id FOR UPDATE;
        IF NOT FOUND THEN
          IF expected_version <> 0 THEN
            RAISE EXCEPTION 'assistant configuration changed' USING ERRCODE='40001';
          END IF;
          next_version := 1;
          INSERT INTO public.assistant_configurations(business_id,version,assistant_name,greeting,tone,language,
            response_length,handoff_behavior,fallback_response,updated_by,updated_at)
          VALUES(tenant_id,next_version,btrim(config->>'assistantName'),btrim(config->>'greeting'),config->>'tone',
            config->>'language',config->>'responseLength',config->>'handoffBehavior',btrim(config->>'fallbackResponse'),actor_id,now());
          fields := ARRAY['assistantName','greeting','tone','language','responseLength','handoffBehavior','fallbackResponse'];
        ELSE
          IF old_row.version <> expected_version THEN
            RAISE EXCEPTION 'assistant configuration changed' USING ERRCODE='40001';
          END IF;
          next_version := old_row.version + 1;
          fields := array_remove(ARRAY[
            CASE WHEN old_row.assistant_name IS DISTINCT FROM btrim(config->>'assistantName') THEN 'assistantName' END,
            CASE WHEN old_row.greeting IS DISTINCT FROM btrim(config->>'greeting') THEN 'greeting' END,
            CASE WHEN old_row.tone IS DISTINCT FROM config->>'tone' THEN 'tone' END,
            CASE WHEN old_row.language IS DISTINCT FROM config->>'language' THEN 'language' END,
            CASE WHEN old_row.response_length IS DISTINCT FROM config->>'responseLength' THEN 'responseLength' END,
            CASE WHEN old_row.handoff_behavior IS DISTINCT FROM config->>'handoffBehavior' THEN 'handoffBehavior' END,
            CASE WHEN old_row.fallback_response IS DISTINCT FROM btrim(config->>'fallbackResponse') THEN 'fallbackResponse' END
          ],NULL);
          IF cardinality(fields)=0 THEN fields := ARRAY['settingsConfirmed']; END IF;
          UPDATE public.assistant_configurations SET version=next_version, assistant_name=btrim(config->>'assistantName'),
            greeting=btrim(config->>'greeting'), tone=config->>'tone', language=config->>'language',
            response_length=config->>'responseLength', handoff_behavior=config->>'handoffBehavior',
            fallback_response=btrim(config->>'fallbackResponse'), updated_by=actor_id, updated_at=now()
            WHERE business_id=tenant_id;
        END IF;
        INSERT INTO public.assistant_configuration_audit(business_id,account_id,revision,changed_fields)
          VALUES(tenant_id,actor_id,next_version,fields);
        RETURN QUERY SELECT * FROM public.kleva_assistant_config_read();
      END $$;

      CREATE FUNCTION public.kleva_ai_playground_admit(request_id uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        actor_id uuid := public.kleva_current_account(); bucket timestamptz := date_trunc('hour',now());
        current_count integer;
      BEGIN
        IF tenant_id IS NULL OR actor_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') THEN
          RAISE EXCEPTION 'assistant playground access denied' USING ERRCODE='42501';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended(tenant_id::text || ':' || actor_id::text || ':' || bucket::text,0));
        DELETE FROM public.ai_playground_rate_limits WHERE window_start < now()-interval '2 days';
        DELETE FROM public.ai_playground_usage WHERE created_at < now()-interval '90 days';
        SELECT request_count INTO current_count FROM public.ai_playground_rate_limits
          WHERE business_id=tenant_id AND account_id=actor_id AND window_start=bucket FOR UPDATE;
        IF COALESCE(current_count,0) >= 20 THEN RETURN false; END IF;
        IF current_count IS NULL THEN
          INSERT INTO public.ai_playground_rate_limits(business_id,account_id,window_start,request_count)
            VALUES(tenant_id,actor_id,bucket,1);
        ELSE
          UPDATE public.ai_playground_rate_limits SET request_count=request_count+1
            WHERE business_id=tenant_id AND account_id=actor_id AND window_start=bucket;
        END IF;
        INSERT INTO public.ai_playground_usage(request_id,business_id,account_id,outcome)
          VALUES(request_id,tenant_id,actor_id,'PENDING');
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_ai_playground_finish(target_request_id uuid, target_outcome text,
        target_input_tokens integer, target_output_tokens integer, target_duration_ms integer)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        actor_id uuid := public.kleva_current_account();
      BEGIN
        IF tenant_id IS NULL OR actor_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') THEN
          RAISE EXCEPTION 'assistant playground access denied' USING ERRCODE='42501';
        END IF;
        IF target_outcome NOT IN ('ANSWERED','CLARIFICATION','HANDOFF','INSUFFICIENT_EVIDENCE','PROVIDER_FAILURE') OR
          target_input_tokens NOT BETWEEN 0 AND 3600 OR target_output_tokens NOT BETWEEN 0 AND 300 OR
          target_duration_ms NOT BETWEEN 0 AND 30000 THEN
          RAISE EXCEPTION 'invalid playground result' USING ERRCODE='22023';
        END IF;
        UPDATE public.ai_playground_usage SET outcome=target_outcome, input_tokens=target_input_tokens,
          output_tokens=target_output_tokens, duration_ms=target_duration_ms, completed_at=now()
          WHERE request_id=target_request_id AND business_id=tenant_id AND account_id=actor_id AND outcome='PENDING';
        RETURN FOUND;
      END $$;

      CREATE FUNCTION public.kleva_assistant_config_for_runtime(target_business_id uuid)
      RETURNS TABLE(assistant_name text, greeting text, tone text, language text,
        response_length text, handoff_behavior text, fallback_response text, version integer)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' THEN
          RAISE EXCEPTION 'assistant runtime access denied' USING ERRCODE='42501';
        END IF;
        RETURN QUERY SELECT COALESCE(c.assistant_name,'Kleva Assistant')::text,
          COALESCE(c.greeting,'Hello! How can I help you today?')::text,
          COALESCE(c.tone,'FRIENDLY')::text, COALESCE(c.language,'ENGLISH')::text,
          COALESCE(c.response_length,'BALANCED')::text, COALESCE(c.handoff_behavior,'OFFER_HUMAN')::text,
          COALESCE(c.fallback_response,'I don’t have enough published information to answer confidently. A team member can help.')::text,
          COALESCE(c.version,0)
        FROM (SELECT 1) seed LEFT JOIN public.assistant_configurations c ON c.business_id=target_business_id;
      END $$;

      REVOKE ALL ON public.assistant_configurations, public.assistant_configuration_audit, public.ai_playground_rate_limits FROM PUBLIC;
      REVOKE ALL ON public.ai_playground_usage FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_assistant_config_read(), public.kleva_assistant_config_save(integer,jsonb),
        public.kleva_ai_playground_admit(uuid), public.kleva_ai_playground_finish(uuid,text,integer,integer,integer),
        public.kleva_assistant_config_for_runtime(uuid) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_assistant_config_for_runtime(uuid) TO %I', role_name);
          EXECUTE format('GRANT SELECT ON public.assistant_configurations TO %I', role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    const rows = (await runner.query(`
      SELECT (SELECT count(*) FROM public.assistant_configurations) +
        (SELECT count(*) FROM public.assistant_configuration_audit) +
        (SELECT count(*) FROM public.ai_playground_usage) AS count
    `)) as { count: string }[];
    const row = rows[0];
    if (Number(row?.count ?? 0) > 0)
      throw new Error(
        'Refusing to drop merchant assistant configuration or audit history.',
      );
    await runner.query(`
      DROP FUNCTION public.kleva_assistant_config_for_runtime(uuid);
      DROP FUNCTION public.kleva_ai_playground_finish(uuid,text,integer,integer,integer);
      DROP FUNCTION public.kleva_ai_playground_admit(uuid);
      DROP FUNCTION public.kleva_assistant_config_save(integer,jsonb);
      DROP FUNCTION public.kleva_assistant_config_read();
      DROP TABLE public.ai_playground_rate_limits;
      DROP TABLE public.ai_playground_usage;
      DROP TABLE public.assistant_configuration_audit;
      DROP TABLE public.assistant_configurations;
    `);
  }
}
