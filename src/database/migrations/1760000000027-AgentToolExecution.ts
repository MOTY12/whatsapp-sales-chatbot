import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Narrow worker-only ledger and atomic functions for the pilot sales tools. */
export class AgentToolExecution1760000000027 implements MigrationInterface {
  name = 'AgentToolExecution1760000000027';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE public.ai_response_runs
        ADD CONSTRAINT uq_ai_response_business_id UNIQUE (business_id,id);
      ALTER TABLE public.merchant_lead_qualifications
        ADD COLUMN field_sources jsonb NOT NULL DEFAULT '{}'::jsonb
          CHECK (jsonb_typeof(field_sources)='object'),
        ADD COLUMN source_kind varchar(12) NOT NULL DEFAULT 'MERCHANT'
          CHECK (source_kind IN ('MERCHANT','AI')),
        ADD COLUMN source_run_id uuid,
        ADD COLUMN source_message_id uuid,
        ADD CONSTRAINT fk_lead_qualification_source_run FOREIGN KEY (business_id,source_run_id)
          REFERENCES public.ai_response_runs(business_id,id) ON DELETE RESTRICT,
        ADD CONSTRAINT fk_lead_qualification_source_message FOREIGN KEY (business_id,source_message_id)
          REFERENCES public.messages("businessId",id) ON DELETE RESTRICT,
        ADD CONSTRAINT ck_lead_qualification_source CHECK (
          (source_kind='MERCHANT' AND source_run_id IS NULL AND source_message_id IS NULL)
          OR (source_kind='AI' AND source_run_id IS NOT NULL AND source_message_id IS NOT NULL)
        );
      UPDATE public.merchant_lead_qualifications q
        SET field_sources=(SELECT COALESCE(jsonb_object_agg(k,'MERCHANT'),'{}'::jsonb)
          FROM jsonb_object_keys(q.field_values) AS k);

      CREATE TABLE public.agent_tool_executions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        ai_run_id uuid NOT NULL,
        tool_name varchar(48) NOT NULL,
        tool_version integer NOT NULL CHECK (tool_version > 0),
        idempotency_key uuid NOT NULL,
        arguments_sha256 char(64) NOT NULL CHECK (arguments_sha256 ~ '^[0-9a-f]{64}$'),
        status varchar(12) NOT NULL DEFAULT 'STARTED'
          CHECK (status IN ('STARTED','COMPLETED','FAILED')),
        result_classification varchar(32),
        safe_result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_result)='object'),
        started_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        duration_ms integer CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 10000),
        UNIQUE (business_id,idempotency_key),
        UNIQUE (business_id,id),
        FOREIGN KEY (business_id,conversation_id)
          REFERENCES public.conversations("businessId",id) ON DELETE CASCADE,
        FOREIGN KEY (business_id,ai_run_id)
          REFERENCES public.ai_response_runs(business_id,id) ON DELETE CASCADE,
        CHECK ((status='STARTED' AND completed_at IS NULL) OR
          (status IN ('COMPLETED','FAILED') AND completed_at IS NOT NULL))
      );
      CREATE INDEX idx_agent_tool_execution_thread
        ON public.agent_tool_executions(business_id,conversation_id,started_at DESC);
      ALTER TABLE public.agent_tool_executions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.agent_tool_executions FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_agent_tool_execution_internal ON public.agent_tool_executions
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE TABLE public.agent_tool_handoff_events (
        execution_id uuid PRIMARY KEY,
        business_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        ai_run_id uuid NOT NULL,
        reason_code varchar(32) NOT NULL CHECK (reason_code IN
          ('CUSTOMER_REQUEST','UNSUPPORTED_REQUEST','POLICY_APPROVAL')),
        previous_control_version bigint NOT NULL,
        new_control_version bigint NOT NULL CHECK (new_control_version > previous_control_version),
        occurred_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (business_id,execution_id)
          REFERENCES public.agent_tool_executions(business_id,id) ON DELETE CASCADE,
        FOREIGN KEY (business_id,conversation_id)
          REFERENCES public.conversations("businessId",id) ON DELETE CASCADE,
        FOREIGN KEY (business_id,ai_run_id)
          REFERENCES public.ai_response_runs(business_id,id) ON DELETE CASCADE
      );
      ALTER TABLE public.agent_tool_handoff_events ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.agent_tool_handoff_events FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_agent_tool_handoff_internal ON public.agent_tool_handoff_events
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE FUNCTION public.kleva_agent_tool_begin(target_business uuid,target_conversation uuid,
        target_run uuid,target_tool text,target_version integer,target_key uuid,target_hash text)
      RETURNS TABLE(execution_id uuid,status text,safe_result jsonb)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE existing public.agent_tool_executions%ROWTYPE; run_status text;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' OR target_tool NOT IN
          ('search_published_offers','record_lead_qualification','request_human_handoff')
          OR target_version<>1 OR target_key IS NULL OR target_hash !~ '^[0-9a-f]{64}$' THEN
          RAISE EXCEPTION 'agent tool access denied' USING ERRCODE='42501';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended(target_business::text||':'||target_key::text,0));
        SELECT e.* INTO existing FROM public.agent_tool_executions e
          WHERE e.business_id=target_business AND e.idempotency_key=target_key FOR UPDATE;
        IF FOUND THEN
          IF existing.ai_run_id<>target_run OR existing.conversation_id<>target_conversation
            OR existing.tool_name<>target_tool OR existing.tool_version<>target_version
            OR existing.arguments_sha256<>target_hash THEN
            RAISE EXCEPTION 'agent tool idempotency conflict' USING ERRCODE='23505';
          END IF;
          RETURN QUERY SELECT existing.id,existing.status::text,existing.safe_result; RETURN;
        END IF;
        SELECT a.status INTO run_status FROM public.ai_response_runs a
          JOIN public.conversations c ON c.id=a.conversation_id AND c."businessId"=a.business_id
          JOIN public.businesses b ON b.id=a.business_id
          WHERE a.id=target_run AND a.business_id=target_business AND a.conversation_id=target_conversation
            AND b.status='active' AND c.control_mode='AUTO'
            AND c.control_version=a.authorized_control_version
            AND a.status IN ('PENDING','PROCESSING','GENERATED') FOR UPDATE OF a,c;
        IF run_status IS NULL THEN RAISE EXCEPTION 'agent run is stale' USING ERRCODE='40001'; END IF;
        INSERT INTO public.agent_tool_executions(business_id,conversation_id,ai_run_id,
          tool_name,tool_version,idempotency_key,arguments_sha256)
          VALUES(target_business,target_conversation,target_run,target_tool,target_version,target_key,target_hash)
          RETURNING id INTO execution_id;
        status:='STARTED'; safe_result:='{}'::jsonb; RETURN NEXT;
      END $$;

      CREATE FUNCTION public.kleva_agent_tool_finish(target_execution uuid,target_status text,
        target_classification text,target_result jsonb,target_duration integer)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' OR target_status NOT IN ('COMPLETED','FAILED')
          OR target_classification NOT IN ('SUCCESS','NO_MATCH','NEEDS_INPUT','CONSENT_REQUIRED','CONFLICT','UNAVAILABLE','REJECTED')
          OR jsonb_typeof(target_result)<>'object' OR octet_length(target_result::text)>8000
          OR target_duration NOT BETWEEN 0 AND 10000 THEN
          RAISE EXCEPTION 'agent tool result is invalid' USING ERRCODE='22023';
        END IF;
        UPDATE public.agent_tool_executions SET status=target_status,result_classification=target_classification,
          safe_result=target_result,completed_at=now(),duration_ms=target_duration
          WHERE id=target_execution AND status='STARTED';
        RETURN FOUND;
      END $$;

      CREATE FUNCTION public.kleva_agent_tool_qualification_context(target_run uuid)
      RETURNS TABLE(lead_id uuid,lead_status text,lead_version bigint,policy_version integer,
        policy_fields jsonb,current_values jsonb,source_fields jsonb)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid; target_lead uuid;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' THEN RAISE EXCEPTION 'agent tool access denied' USING ERRCODE='42501'; END IF;
        SELECT a.business_id,a.lead_id INTO tenant_id,target_lead FROM public.ai_response_runs a
          JOIN public.conversations c ON c.id=a.conversation_id AND c."businessId"=a.business_id
          WHERE a.id=target_run AND a.lead_id IS NOT NULL AND a.status IN ('PENDING','PROCESSING','GENERATED')
            AND c.control_mode='AUTO' AND c.control_version=a.authorized_control_version;
        IF tenant_id IS NULL THEN RETURN; END IF;
        RETURN QUERY SELECT l.id,l.status::text,l.version,p.version,p.fields,
          COALESCE(q.field_values,'{}'::jsonb),COALESCE(q.field_sources,'{}'::jsonb)
          FROM public.merchant_leads l
          CROSS JOIN LATERAL (SELECT p.version,p.fields FROM public.sales_qualification_policies p
            WHERE p.business_id=tenant_id ORDER BY p.version DESC LIMIT 1) p
          LEFT JOIN LATERAL (SELECT q.field_values,q.field_sources FROM public.merchant_lead_qualifications q
            WHERE q.business_id=tenant_id AND q.lead_id=target_lead ORDER BY q.revision DESC LIMIT 1) q ON true
          WHERE l.id=target_lead AND l.business_id=tenant_id;
      END $$;

      CREATE FUNCTION public.kleva_agent_tool_qualification_save(target_execution uuid,target_policy integer,
        expected_lead_version bigint,new_values jsonb)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE e public.agent_tool_executions%ROWTYPE; a public.ai_response_runs%ROWTYPE;
        l public.merchant_leads%ROWTYPE; policy_row public.sales_qualification_policies%ROWTYPE;
        old_values jsonb:='{}'::jsonb; old_sources jsonb:='{}'::jsonb; merged jsonb:='{}'::jsonb;
        merged_sources jsonb:='{}'::jsonb; stored_ids jsonb:='[]'::jsonb; conflict_ids jsonb:='[]'::jsonb;
        missing_ids jsonb:='[]'::jsonb; consent_ids jsonb:='[]'::jsonb; item record; raw jsonb; source_kind text;
        revision_no integer; output jsonb; new_lead_version bigint;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' OR jsonb_typeof(new_values)<>'object' THEN
          RAISE EXCEPTION 'agent tool access denied' USING ERRCODE='42501';
        END IF;
        SELECT * INTO e FROM public.agent_tool_executions WHERE id=target_execution AND tool_name='record_lead_qualification' FOR UPDATE;
        IF NOT FOUND OR e.status<>'STARTED' THEN RAISE EXCEPTION 'agent tool intent is unavailable' USING ERRCODE='40001'; END IF;
        SELECT * INTO a FROM public.ai_response_runs WHERE id=e.ai_run_id AND business_id=e.business_id AND conversation_id=e.conversation_id FOR UPDATE;
        IF NOT FOUND OR a.lead_id IS NULL THEN RAISE EXCEPTION 'agent lead is unavailable' USING ERRCODE='42501'; END IF;
        SELECT * INTO l FROM public.merchant_leads WHERE id=a.lead_id AND business_id=e.business_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'agent lead is unavailable' USING ERRCODE='42501'; END IF;
        SELECT policy.* INTO policy_row FROM public.sales_qualification_policies policy
          WHERE policy.business_id=e.business_id AND policy.version=target_policy;
        IF NOT FOUND OR target_policy<>(SELECT max(version) FROM public.sales_qualification_policies WHERE business_id=e.business_id) THEN
          RAISE EXCEPTION 'sales policy changed' USING ERRCODE='40001';
        END IF;
        PERFORM 1 FROM public.conversations c WHERE c.id=e.conversation_id AND c."businessId"=e.business_id
          AND c.control_mode='AUTO' AND c.control_version=a.authorized_control_version FOR UPDATE;
        IF NOT FOUND OR l.version<>expected_lead_version OR l.status IN ('WON','LOST') THEN
          RAISE EXCEPTION 'agent qualification is stale' USING ERRCODE='40001';
        END IF;
        SELECT q.field_values,q.field_sources INTO old_values,old_sources FROM public.merchant_lead_qualifications q
          WHERE q.business_id=e.business_id AND q.lead_id=a.lead_id ORDER BY q.revision DESC LIMIT 1;
        old_values:=COALESCE(old_values,'{}'::jsonb); old_sources:=COALESCE(old_sources,'{}'::jsonb);
        FOR item IN SELECT value FROM jsonb_array_elements(policy_row.fields) LOOP
          IF COALESCE((item.value->>'consentRequired')::boolean,false) AND new_values ? (item.value->>'id') THEN
            consent_ids:=consent_ids || jsonb_build_array(item.value->>'id');
          END IF;
        END LOOP;
        FOR item IN SELECT key,value FROM jsonb_each(new_values) LOOP
          SELECT value INTO raw FROM jsonb_array_elements(policy_row.fields)
            WHERE value->>'id'=item.key LIMIT 1;
          IF raw IS NULL THEN
            RAISE EXCEPTION 'agent qualification field is not permitted' USING ERRCODE='22023';
          END IF;
          IF COALESCE((raw->>'consentRequired')::boolean,false) THEN CONTINUE; END IF;
          IF old_values ? item.key THEN
            conflict_ids:=conflict_ids || jsonb_build_array(item.key);
          ELSE
            stored_ids:=stored_ids || jsonb_build_array(item.key);
            merged:=merged || jsonb_build_object(item.key,item.value);
            merged_sources:=merged_sources || jsonb_build_object(item.key,'AI:'||a.inbound_message_id::text);
          END IF;
        END LOOP;
        merged:=old_values || merged; merged_sources:=old_sources || merged_sources;
        FOR item IN SELECT value FROM jsonb_array_elements(policy_row.fields) LOOP
          IF COALESCE((item.value->>'required')::boolean,false) AND
             (NOT (merged ? (item.value->>'id')) OR merged->(item.value->>'id') IN ('null'::jsonb,'""'::jsonb)) THEN
            missing_ids:=missing_ids || jsonb_build_array(item.value->>'id');
          END IF;
        END LOOP;
        IF jsonb_array_length(stored_ids)>0 THEN
          SELECT COALESCE(max(q.revision),0)+1 INTO revision_no FROM public.merchant_lead_qualifications q
            WHERE q.business_id=e.business_id AND q.lead_id=a.lead_id;
          INSERT INTO public.merchant_lead_qualifications(business_id,lead_id,revision,policy_version,
            field_values,field_sources,consent_evidence,qualification_status,source_kind,source_run_id,source_message_id)
          VALUES(e.business_id,a.lead_id,revision_no,target_policy,merged,merged_sources,'{}'::jsonb,'IN_PROGRESS','AI',a.id,a.inbound_message_id);
          UPDATE public.merchant_leads SET version=version+1,updated_at=now()
            WHERE id=a.lead_id AND business_id=e.business_id RETURNING version INTO new_lead_version;
          l.version:=new_lead_version;
        END IF;
        output:=jsonb_build_object('classification',CASE WHEN jsonb_array_length(consent_ids)>0 THEN 'CONSENT_REQUIRED'
          WHEN jsonb_array_length(missing_ids)>0 THEN 'NEEDS_INPUT' WHEN jsonb_array_length(conflict_ids)>0 THEN 'CONFLICT' ELSE 'SUCCESS' END,
          'storedFieldIds',stored_ids,'missingFieldIds',missing_ids,'consentRequiredFieldIds',consent_ids,
          'merchantValueConflictFieldIds',conflict_ids,'leadVersion',l.version);
        UPDATE public.agent_tool_executions SET status='COMPLETED',result_classification=output->>'classification',
          safe_result=output,completed_at=now(),duration_ms=0 WHERE id=e.id AND status='STARTED';
        RETURN output;
      END $$;

      CREATE FUNCTION public.kleva_agent_tool_handoff(target_execution uuid,target_reason text)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE e public.agent_tool_executions%ROWTYPE; a public.ai_response_runs%ROWTYPE;
        old_mode text; old_version bigint; changed_version bigint; output jsonb;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' OR target_reason NOT IN ('CUSTOMER_REQUEST','UNSUPPORTED_REQUEST','POLICY_APPROVAL') THEN
          RAISE EXCEPTION 'agent tool access denied' USING ERRCODE='42501';
        END IF;
        SELECT * INTO e FROM public.agent_tool_executions WHERE id=target_execution AND tool_name='request_human_handoff' FOR UPDATE;
        IF NOT FOUND OR e.status<>'STARTED' THEN RAISE EXCEPTION 'agent tool intent is unavailable' USING ERRCODE='40001'; END IF;
        SELECT * INTO a FROM public.ai_response_runs WHERE id=e.ai_run_id AND business_id=e.business_id AND conversation_id=e.conversation_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'agent run is unavailable' USING ERRCODE='42501'; END IF;
        SELECT c.control_mode,c.control_version INTO old_mode,old_version FROM public.conversations c
          WHERE c.id=e.conversation_id AND c."businessId"=e.business_id FOR UPDATE;
        IF NOT FOUND OR a.authorized_control_version<>old_version OR a.status NOT IN ('PENDING','PROCESSING','GENERATED') THEN
          RAISE EXCEPTION 'agent handoff is stale' USING ERRCODE='40001';
        END IF;
        IF old_mode='AUTO' THEN
          changed_version:=old_version+1;
          UPDATE public.conversations SET control_mode='HUMAN',control_version=changed_version,
            takeover_actor_account_id=NULL,takeover_at=now(),control_changed_at=now()
            WHERE id=e.conversation_id AND "businessId"=e.business_id;
          INSERT INTO public.agent_tool_handoff_events(execution_id,business_id,conversation_id,ai_run_id,
            reason_code,previous_control_version,new_control_version)
          VALUES(e.id,e.business_id,e.conversation_id,a.id,target_reason,old_version,changed_version);
          UPDATE public.ai_response_runs SET status='HANDOFF_REQUIRED',error_category='AGENT_TOOL_HANDOFF',
            completed_at=now(),updated_at=now() WHERE id=a.id AND business_id=e.business_id;
          output:=jsonb_build_object('classification','HANDOFF','reasonCode',target_reason,'controlVersion',changed_version);
        ELSE
          output:=jsonb_build_object('classification','ALREADY_HUMAN','reasonCode',target_reason,'controlVersion',old_version);
        END IF;
        UPDATE public.agent_tool_executions SET status='COMPLETED',result_classification=output->>'classification',
          safe_result=output,completed_at=now(),duration_ms=0 WHERE id=e.id AND status='STARTED';
        RETURN output;
      END $$;

      REVOKE ALL ON public.agent_tool_executions,public.agent_tool_handoff_events FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_agent_tool_begin(uuid,uuid,uuid,text,integer,uuid,text),
        public.kleva_agent_tool_finish(uuid,text,text,jsonb,integer),public.kleva_agent_tool_qualification_context(uuid),
        public.kleva_agent_tool_qualification_save(uuid,integer,bigint,jsonb),public.kleva_agent_tool_handoff(uuid,text) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_agent_tool_begin(uuid,uuid,uuid,text,integer,uuid,text), public.kleva_agent_tool_finish(uuid,text,text,jsonb,integer), public.kleva_agent_tool_qualification_context(uuid), public.kleva_agent_tool_qualification_save(uuid,integer,bigint,jsonb), public.kleva_agent_tool_handoff(uuid,text) TO %I',role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    const rows = (await runner.query(
      `SELECT count(*) AS count FROM public.agent_tool_executions`,
    )) as { count: string }[];
    if (Number(rows[0]?.count ?? 0) > 0)
      throw new Error(
        'Agent tool execution history exists; preserve the migration.',
      );
    await runner.query(`
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('REVOKE EXECUTE ON FUNCTION public.kleva_agent_tool_begin(uuid,uuid,uuid,text,integer,uuid,text), public.kleva_agent_tool_finish(uuid,text,text,jsonb,integer), public.kleva_agent_tool_qualification_context(uuid), public.kleva_agent_tool_qualification_save(uuid,integer,bigint,jsonb), public.kleva_agent_tool_handoff(uuid,text) FROM %I',role_name);
        END LOOP;
      END $$;
      DROP FUNCTION public.kleva_agent_tool_handoff(uuid,text);
      DROP FUNCTION public.kleva_agent_tool_qualification_save(uuid,integer,bigint,jsonb);
      DROP FUNCTION public.kleva_agent_tool_qualification_context(uuid);
      DROP FUNCTION public.kleva_agent_tool_finish(uuid,text,text,jsonb,integer);
      DROP FUNCTION public.kleva_agent_tool_begin(uuid,uuid,uuid,text,integer,uuid,text);
      DROP TABLE public.agent_tool_handoff_events;
      DROP TABLE public.agent_tool_executions;
      ALTER TABLE public.merchant_lead_qualifications
        DROP CONSTRAINT fk_lead_qualification_source_message,
        DROP CONSTRAINT fk_lead_qualification_source_run,
        DROP CONSTRAINT ck_lead_qualification_source,
        DROP COLUMN source_message_id,DROP COLUMN source_run_id,DROP COLUMN source_kind,DROP COLUMN field_sources;
      ALTER TABLE public.ai_response_runs DROP CONSTRAINT uq_ai_response_business_id;
    `);
  }
}
