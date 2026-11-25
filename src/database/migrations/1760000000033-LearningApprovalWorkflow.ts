import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Merchant-approved learning suggestions and private staged FAQ indexing. */
export class LearningApprovalWorkflow1760000000033 implements MigrationInterface {
  name = 'LearningApprovalWorkflow1760000000033';

  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE public.learning_suggestions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        gap_cluster_id uuid NOT NULL,
        create_key uuid NOT NULL,
        create_fingerprint char(64) NOT NULL,
        status varchar(24) NOT NULL DEFAULT 'DRAFT'
          CHECK (status IN ('DRAFT','PENDING_REVIEW','APPROVED','INDEXING','PUBLISHED','INDEXING_FAILED','PUBLICATION_CONFLICT','DISMISSED','SUPERSEDED')),
        origin varchar(16) NOT NULL CHECK (origin IN ('MANUAL','AI_ASSISTED')),
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        proposed_question varchar(500) NOT NULL CHECK (length(btrim(proposed_question)) BETWEEN 1 AND 500),
        proposed_answer varchar(5000) NOT NULL DEFAULT '' CHECK (length(btrim(proposed_answer)) <= 5000),
        supporting_sources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(supporting_sources)='array' AND jsonb_array_length(supporting_sources)<=10),
        target_faq_id uuid,
        expected_target_revision_id uuid,
        created_by uuid NOT NULL,
        updated_by uuid NOT NULL,
        approved_by uuid,
        approved_at timestamptz,
        approved_version integer,
        approval_key uuid,
        approved_faq_id uuid,
        approved_revision_id uuid,
        generation_id uuid,
        evaluation_status varchar(24) NOT NULL DEFAULT 'NOT_STARTED'
          CHECK (evaluation_status IN ('NOT_STARTED','PENDING','COMPLETED','FAILED')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_learning_suggestion_business_id UNIQUE (business_id,id),
        CONSTRAINT uq_learning_suggestion_create_key UNIQUE (business_id,create_key),
        CONSTRAINT fk_learning_suggestion_gap FOREIGN KEY (business_id,gap_cluster_id)
          REFERENCES public.knowledge_gap_clusters(business_id,id) ON DELETE RESTRICT,
        CONSTRAINT fk_learning_suggestion_business FOREIGN KEY (business_id)
          REFERENCES public.businesses(id) ON DELETE RESTRICT,
        CONSTRAINT fk_learning_suggestion_target_faq FOREIGN KEY (business_id,target_faq_id)
          REFERENCES public.knowledge_faqs(business_id,id) ON DELETE RESTRICT,
        CONSTRAINT fk_learning_suggestion_target_revision FOREIGN KEY (expected_target_revision_id,business_id,target_faq_id)
          REFERENCES public.knowledge_faq_revisions(id,business_id,faq_id) ON DELETE RESTRICT,
        CONSTRAINT fk_learning_suggestion_approved_faq FOREIGN KEY (business_id,approved_faq_id)
          REFERENCES public.knowledge_faqs(business_id,id) ON DELETE RESTRICT,
        CONSTRAINT fk_learning_suggestion_approved_revision FOREIGN KEY (approved_revision_id,business_id,approved_faq_id)
          REFERENCES public.knowledge_faq_revisions(id,business_id,faq_id) ON DELETE RESTRICT,
        CONSTRAINT fk_learning_suggestion_created_by FOREIGN KEY (created_by)
          REFERENCES public.accounts(id) ON DELETE RESTRICT,
        CONSTRAINT fk_learning_suggestion_updated_by FOREIGN KEY (updated_by)
          REFERENCES public.accounts(id) ON DELETE RESTRICT,
        CONSTRAINT fk_learning_suggestion_approved_by FOREIGN KEY (approved_by)
          REFERENCES public.accounts(id) ON DELETE RESTRICT,
        CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
        CHECK ((approved_revision_id IS NULL) = (approved_faq_id IS NULL))
      );
      CREATE UNIQUE INDEX uq_learning_suggestion_active_gap
        ON public.learning_suggestions(business_id,gap_cluster_id)
        WHERE status NOT IN ('PUBLISHED','DISMISSED','SUPERSEDED','PUBLICATION_CONFLICT');
      CREATE INDEX idx_learning_suggestion_business_status
        ON public.learning_suggestions(business_id,status,updated_at DESC,id DESC);

      CREATE TABLE public.learning_suggestion_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        suggestion_id uuid NOT NULL,
        version integer NOT NULL CHECK (version > 0),
        proposed_question varchar(500) NOT NULL,
        proposed_answer varchar(5000) NOT NULL,
        origin varchar(16) NOT NULL CHECK (origin IN ('MANUAL','AI_ASSISTED')),
        supporting_sources jsonb NOT NULL CHECK (jsonb_typeof(supporting_sources)='array' AND jsonb_array_length(supporting_sources)<=10),
        target_faq_id uuid,
        expected_target_revision_id uuid,
        created_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_learning_suggestion_version UNIQUE (business_id,suggestion_id,version),
        CONSTRAINT uq_learning_suggestion_version_scope UNIQUE (id,business_id,suggestion_id),
        FOREIGN KEY (business_id,suggestion_id) REFERENCES public.learning_suggestions(business_id,id) ON DELETE RESTRICT,
        FOREIGN KEY (business_id,target_faq_id) REFERENCES public.knowledge_faqs(business_id,id) ON DELETE RESTRICT,
        FOREIGN KEY (expected_target_revision_id,business_id,target_faq_id)
          REFERENCES public.knowledge_faq_revisions(id,business_id,faq_id) ON DELETE RESTRICT,
        FOREIGN KEY (created_by) REFERENCES public.accounts(id) ON DELETE RESTRICT
      );
      CREATE TABLE public.learning_suggestion_decisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        suggestion_id uuid NOT NULL,
        suggestion_version integer NOT NULL,
        from_status varchar(24),
        to_status varchar(24) NOT NULL,
        actor_account_id uuid,
        reason_code varchar(40),
        generation_id uuid,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (business_id,suggestion_id, suggestion_version)
          REFERENCES public.learning_suggestion_versions(business_id,suggestion_id,version) ON DELETE RESTRICT,
        FOREIGN KEY (actor_account_id) REFERENCES public.accounts(id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_learning_suggestion_decisions
        ON public.learning_suggestion_decisions(business_id,suggestion_id,occurred_at,id);

      ALTER TABLE public.knowledge_index_generations
        ADD COLUMN learning_suggestion_id uuid,
        ADD COLUMN learning_suggestion_version integer,
        ADD CONSTRAINT fk_knowledge_generation_learning_suggestion
          FOREIGN KEY (business_id,learning_suggestion_id)
          REFERENCES public.learning_suggestions(business_id,id) ON DELETE RESTRICT,
        ADD CONSTRAINT ck_knowledge_generation_learning_pair
          CHECK ((learning_suggestion_id IS NULL) = (learning_suggestion_version IS NULL));
      ALTER TABLE public.learning_suggestions
        ADD CONSTRAINT fk_learning_suggestion_generation
          FOREIGN KEY (business_id,generation_id)
          REFERENCES public.knowledge_index_generations(business_id,id)
          DEFERRABLE INITIALLY DEFERRED;

      CREATE TABLE public.learning_evaluation_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        suggestion_id uuid NOT NULL,
        suggestion_version integer NOT NULL,
        approved_revision_id uuid NOT NULL,
        approved_faq_id uuid NOT NULL,
        previous_revision_id uuid,
        status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED')),
        failure_category varchar(40),
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        UNIQUE (business_id,id),
        UNIQUE (business_id,suggestion_id,approved_revision_id),
        FOREIGN KEY (business_id,suggestion_id,suggestion_version)
          REFERENCES public.learning_suggestion_versions(business_id,suggestion_id,version) ON DELETE RESTRICT,
        FOREIGN KEY (approved_revision_id,business_id,approved_faq_id)
          REFERENCES public.knowledge_faq_revisions(id,business_id,faq_id) ON DELETE RESTRICT,
        FOREIGN KEY (previous_revision_id,business_id,approved_faq_id)
          REFERENCES public.knowledge_faq_revisions(id,business_id,faq_id) ON DELETE RESTRICT
      );
      CREATE TABLE public.learning_evaluation_results (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        run_id uuid NOT NULL,
        case_id varchar(40) NOT NULL,
        question varchar(500) NOT NULL,
        before_outcome varchar(32) NOT NULL,
        after_outcome varchar(32),
        expected_source_id uuid NOT NULL,
        before_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
        after_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
        grounded boolean,
        citations_valid boolean,
        model_configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
        failure_category varchar(40),
        evaluated_at timestamptz,
        UNIQUE (business_id,run_id,case_id),
        FOREIGN KEY (business_id,run_id) REFERENCES public.learning_evaluation_runs(business_id,id) ON DELETE RESTRICT,
        FOREIGN KEY (business_id,expected_source_id) REFERENCES public.knowledge_faqs(business_id,id) ON DELETE RESTRICT
      );

      CREATE FUNCTION public.kleva_learning_suggestion_immutable()
      RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
      BEGIN RAISE EXCEPTION 'learning suggestion history is immutable' USING ERRCODE='55000'; END $$;
      CREATE TRIGGER trg_learning_suggestion_version_immutable
        BEFORE UPDATE OR DELETE ON public.learning_suggestion_versions
        FOR EACH ROW EXECUTE FUNCTION public.kleva_learning_suggestion_immutable();
      CREATE TRIGGER trg_learning_suggestion_decision_immutable
        BEFORE UPDATE OR DELETE ON public.learning_suggestion_decisions
        FOR EACH ROW EXECUTE FUNCTION public.kleva_learning_suggestion_immutable();

      DO $$ DECLARE table_name text; BEGIN
        FOREACH table_name IN ARRAY ARRAY['learning_suggestions','learning_suggestion_versions','learning_suggestion_decisions','learning_evaluation_runs','learning_evaluation_results'] LOOP
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
          EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);
          EXECUTE format('CREATE POLICY %I ON public.%I USING (current_user::text !~ ''^kleva_(merchant|identity)_'') WITH CHECK (current_user::text !~ ''^kleva_(merchant|identity)_'')',table_name||'_internal',table_name);
        END LOOP;
      END $$;

      CREATE FUNCTION public.kleva_learning_suggestions_list(target_status text DEFAULT NULL)
      RETURNS TABLE(id uuid,gap_cluster_id uuid,status text,origin text,version integer,proposed_question text,proposed_answer text,
        supporting_sources jsonb,target_faq_id uuid,expected_target_revision_id uuid,approved_faq_id uuid,approved_revision_id uuid,
        generation_id uuid,evaluation_status text,created_at timestamptz,updated_at timestamptz)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') OR (target_status IS NOT NULL AND target_status NOT IN ('DRAFT','PENDING_REVIEW','APPROVED','INDEXING','PUBLISHED','INDEXING_FAILED','PUBLICATION_CONFLICT','DISMISSED','SUPERSEDED')) THEN
          RAISE EXCEPTION 'learning suggestion access denied' USING ERRCODE='42501'; END IF;
        RETURN QUERY SELECT s.id,s.gap_cluster_id,s.status::text,s.origin::text,s.version,s.proposed_question::text,s.proposed_answer::text,
          s.supporting_sources,s.target_faq_id,s.expected_target_revision_id,s.approved_faq_id,s.approved_revision_id,s.generation_id,s.evaluation_status::text,s.created_at,s.updated_at
          FROM public.learning_suggestions s WHERE s.business_id=tenant_id AND (target_status IS NULL OR s.status=target_status)
          ORDER BY s.updated_at DESC,s.id DESC LIMIT 100;
      END $$;

      CREATE FUNCTION public.kleva_learning_suggestion_detail(target_id uuid)
      RETURNS TABLE(id uuid,gap_cluster_id uuid,status text,origin text,version integer,proposed_question text,proposed_answer text,
        supporting_sources jsonb,target_faq_id uuid,expected_target_revision_id uuid,approved_faq_id uuid,approved_revision_id uuid,
        generation_id uuid,evaluation_status text,created_at timestamptz,updated_at timestamptz)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') THEN RAISE EXCEPTION 'learning suggestion access denied' USING ERRCODE='42501'; END IF;
        RETURN QUERY SELECT * FROM public.kleva_learning_suggestions_list(NULL) s WHERE s.id=target_id AND s.id IN
          (SELECT x.id FROM public.learning_suggestions x WHERE x.business_id=tenant_id);
      END $$;

      CREATE FUNCTION public.kleva_learning_suggestion_create(request_key uuid,gap_id uuid,question text,answer text,target_faq uuid,target_revision uuid,source_refs jsonb,source_origin text)
      RETURNS TABLE(id uuid,status text,version integer)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; actor_id uuid:=public.kleva_current_account(); new_id uuid:=gen_random_uuid(); gap_reason text;
        fingerprint text:=md5(jsonb_build_array(btrim(question),btrim(answer),target_faq,target_revision,COALESCE(source_refs,'[]'::jsonb),source_origin)::text);
        prior public.learning_suggestions%ROWTYPE;
      BEGIN
        IF tenant_id IS NULL OR actor_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') THEN RAISE EXCEPTION 'learning suggestion access denied' USING ERRCODE='42501'; END IF;
        IF request_key IS NULL OR question IS NULL OR answer IS NULL OR source_origin NOT IN ('MANUAL','AI_ASSISTED') OR length(btrim(question)) NOT BETWEEN 1 AND 500 OR length(btrim(answer))>5000
          OR question ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}' OR answer ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}'
          OR question ~* '(password|passcode|one[- ]time code|otp|pin|cvv|cvc|card number|bank details|api key|access token|secret key)'
          OR answer ~* '(password|passcode|one[- ]time code|otp|pin|cvv|cvc|card number|bank details|api key|access token|secret key)'
          OR COALESCE(jsonb_typeof(source_refs),'array')<>'array' OR jsonb_array_length(COALESCE(source_refs,'[]'::jsonb))>10 THEN
          RAISE EXCEPTION 'invalid learning suggestion content' USING ERRCODE='22023'; END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended('learning-suggestion:'||tenant_id::text||':'||request_key::text,0));
        SELECT * INTO prior FROM public.learning_suggestions WHERE business_id=tenant_id AND create_key=request_key FOR UPDATE;
        IF FOUND THEN
          IF prior.create_fingerprint<>fingerprint THEN RAISE EXCEPTION 'learning suggestion idempotency conflict' USING ERRCODE='23505'; END IF;
          RETURN QUERY SELECT prior.id,prior.status::text,prior.version; RETURN;
        END IF;
        SELECT last_reason_code INTO gap_reason FROM public.knowledge_gap_clusters c WHERE c.business_id=tenant_id AND c.id=gap_id AND c.status<>'DISMISSED';
        IF gap_reason IS NULL THEN
          RAISE EXCEPTION 'knowledge gap not found' USING ERRCODE='P0002'; END IF;
        IF gap_reason IN ('UNSUPPORTED_PRICE_OR_CURRENCY','UNKNOWN_AVAILABILITY_CLAIM','UNSUPPORTED_AVAILABILITY_CLAIM') THEN
          RAISE EXCEPTION 'manage this fact through the product catalog' USING ERRCODE='22023'; END IF;
        IF target_faq IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.knowledge_faqs f WHERE f.business_id=tenant_id AND f.id=target_faq
          AND f.published_revision_id=target_revision AND f.draft_revision_id=f.published_revision_id) THEN
          RAISE EXCEPTION 'target FAQ changed' USING ERRCODE='40001'; END IF;
        INSERT INTO public.learning_suggestions(id,business_id,gap_cluster_id,create_key,create_fingerprint,origin,proposed_question,proposed_answer,supporting_sources,target_faq_id,expected_target_revision_id,created_by,updated_by)
          VALUES(new_id,tenant_id,gap_id,request_key,fingerprint,source_origin,btrim(question),btrim(answer),COALESCE(source_refs,'[]'::jsonb),target_faq,target_revision,actor_id,actor_id);
        INSERT INTO public.learning_suggestion_versions(business_id,suggestion_id,version,proposed_question,proposed_answer,origin,supporting_sources,target_faq_id,expected_target_revision_id,created_by)
          VALUES(tenant_id,new_id,1,btrim(question),btrim(answer),source_origin,COALESCE(source_refs,'[]'::jsonb),target_faq,target_revision,actor_id);
        INSERT INTO public.learning_suggestion_decisions(business_id,suggestion_id,suggestion_version,to_status,actor_account_id)
          VALUES(tenant_id,new_id,1,'DRAFT',actor_id);
        RETURN QUERY SELECT new_id,'DRAFT'::text,1;
      END $$;

      CREATE FUNCTION public.kleva_learning_suggestion_edit(target_id uuid,expected_version integer,question text,answer text,target_faq uuid,target_revision uuid)
      RETURNS TABLE(id uuid,status text,version integer)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; actor_id uuid:=public.kleva_current_account(); s public.learning_suggestions%ROWTYPE; next_version integer;
      BEGIN
        IF tenant_id IS NULL OR actor_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') THEN RAISE EXCEPTION 'learning suggestion access denied' USING ERRCODE='42501'; END IF;
        IF question IS NULL OR answer IS NULL OR length(btrim(question)) NOT BETWEEN 1 AND 500 OR length(btrim(answer))>5000
          OR question ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}' OR answer ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}'
          OR question ~* '(password|passcode|one[- ]time code|otp|pin|cvv|cvc|card number|bank details|api key|access token|secret key)'
          OR answer ~* '(password|passcode|one[- ]time code|otp|pin|cvv|cvc|card number|bank details|api key|access token|secret key)' THEN RAISE EXCEPTION 'invalid learning suggestion content' USING ERRCODE='22023'; END IF;
        SELECT ls.* INTO s FROM public.learning_suggestions ls WHERE ls.business_id=tenant_id AND ls.id=target_id FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        IF s.version<>expected_version OR s.status NOT IN ('DRAFT','PENDING_REVIEW') THEN RAISE EXCEPTION 'learning suggestion version conflict' USING ERRCODE='40001'; END IF;
        IF target_faq IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.knowledge_faqs f WHERE f.business_id=tenant_id AND f.id=target_faq
          AND f.published_revision_id=target_revision AND f.draft_revision_id=f.published_revision_id) THEN RAISE EXCEPTION 'target FAQ changed' USING ERRCODE='40001'; END IF;
        next_version:=s.version+1;
        UPDATE public.learning_suggestions SET version=next_version,proposed_question=btrim(question),proposed_answer=btrim(answer),target_faq_id=target_faq,
          expected_target_revision_id=target_revision,updated_by=actor_id,updated_at=now() WHERE business_id=tenant_id AND id=target_id;
        INSERT INTO public.learning_suggestion_versions(business_id,suggestion_id,version,proposed_question,proposed_answer,origin,supporting_sources,target_faq_id,expected_target_revision_id,created_by)
          VALUES(tenant_id,target_id,next_version,btrim(question),btrim(answer),s.origin,s.supporting_sources,target_faq,target_revision,actor_id);
        INSERT INTO public.learning_suggestion_decisions(business_id,suggestion_id,suggestion_version,from_status,to_status,actor_account_id)
          VALUES(tenant_id,target_id,next_version,s.status,s.status,actor_id);
        RETURN QUERY SELECT target_id,s.status::text,next_version;
      END $$;

      CREATE FUNCTION public.kleva_learning_suggestion_submit(target_id uuid,expected_version integer)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; actor_id uuid:=public.kleva_current_account(); s public.learning_suggestions%ROWTYPE;
      BEGIN
        IF tenant_id IS NULL OR actor_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') THEN RAISE EXCEPTION 'learning suggestion access denied' USING ERRCODE='42501'; END IF;
        SELECT ls.* INTO s FROM public.learning_suggestions ls WHERE ls.business_id=tenant_id AND ls.id=target_id FOR UPDATE;
        IF NOT FOUND THEN RETURN NULL; END IF;
        IF s.version<>expected_version OR s.status NOT IN ('DRAFT','PENDING_REVIEW') OR length(btrim(s.proposed_answer))=0 THEN RAISE EXCEPTION 'learning suggestion is not ready for review' USING ERRCODE='40001'; END IF;
        IF s.status='PENDING_REVIEW' THEN RETURN true; END IF;
        UPDATE public.learning_suggestions SET status='PENDING_REVIEW',updated_by=actor_id,updated_at=now() WHERE id=target_id AND business_id=tenant_id;
        INSERT INTO public.learning_suggestion_decisions(business_id,suggestion_id,suggestion_version,from_status,to_status,actor_account_id)
          VALUES(tenant_id,target_id,s.version,s.status,'PENDING_REVIEW',actor_id);
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_learning_suggestion_approve(target_id uuid,expected_version integer,request_key uuid,target_provider text,target_model text,target_dimensions integer,target_chunking text)
      RETURNS TABLE(id uuid,status text,version integer,approved_faq_id uuid,approved_revision_id uuid,generation_id uuid)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; actor_id uuid:=public.kleva_current_account(); s public.learning_suggestions%ROWTYPE;
        v_faq_id uuid; v_revision_id uuid; v_revision_number integer; gen_id uuid:=gen_random_uuid(); from_state text;
      BEGIN
        IF tenant_id IS NULL OR actor_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') OR request_key IS NULL
          OR target_provider NOT IN ('openai','deterministic') OR target_model IS NULL OR length(target_model) NOT BETWEEN 1 AND 100
          OR target_dimensions<>1536 OR target_chunking<>'sentence-cl100k-v1' THEN RAISE EXCEPTION 'learning approval denied' USING ERRCODE='42501'; END IF;
        SELECT ls.* INTO s FROM public.learning_suggestions ls WHERE ls.business_id=tenant_id AND ls.id=target_id FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        IF s.status IN ('INDEXING','PUBLISHED') AND s.approved_revision_id IS NOT NULL THEN
          RETURN QUERY SELECT s.id,s.status::text,s.approved_version,s.approved_faq_id,s.approved_revision_id,s.generation_id; RETURN;
        END IF;
        IF s.status<>'PENDING_REVIEW' OR s.version<>expected_version OR length(btrim(s.proposed_answer))=0 THEN RAISE EXCEPTION 'learning suggestion changed before approval' USING ERRCODE='40001'; END IF;
        from_state:=s.status;
        IF s.target_faq_id IS NULL THEN
          v_faq_id:=gen_random_uuid();
          INSERT INTO public.knowledge_faqs(id,business_id,creation_key,creation_fingerprint,created_by,updated_by)
            VALUES(v_faq_id,tenant_id,request_key,md5(jsonb_build_array(s.proposed_question,s.proposed_answer)::text),actor_id,actor_id);
          v_revision_number:=1;
        ELSE
          v_faq_id:=s.target_faq_id;
          PERFORM 1 FROM public.knowledge_faqs f WHERE f.business_id=tenant_id AND f.id=v_faq_id
            AND f.published_revision_id IS NOT DISTINCT FROM s.expected_target_revision_id
            AND f.draft_revision_id IS NOT DISTINCT FROM f.published_revision_id FOR UPDATE;
          IF NOT FOUND THEN RAISE EXCEPTION 'target FAQ changed before approval' USING ERRCODE='40001'; END IF;
          SELECT COALESCE(max(r.revision),0)+1 INTO v_revision_number FROM public.knowledge_faq_revisions r WHERE r.business_id=tenant_id AND r.faq_id=v_faq_id;
        END IF;
        INSERT INTO public.knowledge_faq_revisions(business_id,faq_id,revision,question,answer,created_by)
          VALUES(tenant_id,v_faq_id,v_revision_number,s.proposed_question,s.proposed_answer,actor_id) RETURNING knowledge_faq_revisions.id INTO v_revision_id;
        UPDATE public.knowledge_faqs SET draft_revision_id=v_revision_id,updated_by=actor_id,updated_at=now()
          WHERE knowledge_faqs.business_id=tenant_id AND knowledge_faqs.id=v_faq_id;
        INSERT INTO public.knowledge_faq_events(business_id,faq_id,revision_id,event_type,actor_account_id)
          VALUES(tenant_id,v_faq_id,v_revision_id,CASE WHEN v_revision_number=1 THEN 'CREATED' ELSE 'EDITED' END,actor_id);
        INSERT INTO public.knowledge_index_generations(id,business_id,request_key,source_type,source_id,source_revision_id,
          embedding_provider,embedding_model,embedding_dimensions,chunking_version,learning_suggestion_id,learning_suggestion_version)
          VALUES(gen_id,tenant_id,request_key,'FAQ',v_faq_id,v_revision_id,target_provider,target_model,target_dimensions,target_chunking,target_id,expected_version);
        INSERT INTO public.outbox_operations(id,"businessId",operation,metadata)
          VALUES(gen_id,tenant_id,'knowledge.index.requested',jsonb_build_object('generationId',gen_id,'suggestionId',target_id));
        UPDATE public.learning_suggestions SET status='INDEXING',approved_by=actor_id,approved_at=now(),approved_version=expected_version,
          approval_key=request_key,approved_faq_id=v_faq_id,approved_revision_id=v_revision_id,generation_id=gen_id,updated_by=actor_id,updated_at=now()
          WHERE learning_suggestions.business_id=tenant_id AND learning_suggestions.id=target_id;
        INSERT INTO public.learning_suggestion_decisions(business_id,suggestion_id,suggestion_version,from_status,to_status,actor_account_id,generation_id)
          VALUES(tenant_id,target_id,expected_version,from_state,'INDEXING',actor_id,gen_id);
        RETURN QUERY SELECT target_id,'INDEXING'::text,expected_version,v_faq_id,v_revision_id,gen_id;
      END $$;

      CREATE FUNCTION public.kleva_learning_suggestion_dismiss(target_id uuid,reason text DEFAULT NULL)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; actor_id uuid:=public.kleva_current_account(); s public.learning_suggestions%ROWTYPE;
      BEGIN
        IF tenant_id IS NULL OR actor_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') OR (reason IS NOT NULL AND reason !~ '^[A-Z_]{2,40}$') THEN RAISE EXCEPTION 'learning suggestion update denied' USING ERRCODE='42501'; END IF;
        SELECT ls.* INTO s FROM public.learning_suggestions ls WHERE ls.business_id=tenant_id AND ls.id=target_id FOR UPDATE;
        IF NOT FOUND THEN RETURN NULL; END IF;
        IF s.status IN ('PUBLISHED','SUPERSEDED') THEN RAISE EXCEPTION 'published suggestion is immutable' USING ERRCODE='40001'; END IF;
        IF s.status='DISMISSED' THEN RETURN true; END IF;
        UPDATE public.learning_suggestions SET status='DISMISSED',updated_by=actor_id,updated_at=now() WHERE business_id=tenant_id AND id=target_id;
        IF s.generation_id IS NOT NULL THEN UPDATE public.knowledge_index_generations SET status='FAILED',failure_category='SUGGESTION_WITHDRAWN',completed_at=now()
          WHERE business_id=tenant_id AND id=s.generation_id AND status IN ('PENDING','INDEXING'); END IF;
        INSERT INTO public.learning_suggestion_decisions(business_id,suggestion_id,suggestion_version,from_status,to_status,actor_account_id,reason_code,generation_id)
          VALUES(tenant_id,target_id,s.version,s.status,'DISMISSED',actor_id,reason,s.generation_id);
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_learning_suggestion_retry(target_id uuid,expected_version integer,request_key uuid,target_provider text,target_model text,target_dimensions integer,target_chunking text)
      RETURNS TABLE(id uuid,status text,version integer,generation_id uuid)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; actor_id uuid:=public.kleva_current_account(); s public.learning_suggestions%ROWTYPE; gen_id uuid:=gen_random_uuid();
      BEGIN
        IF tenant_id IS NULL OR actor_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') OR request_key IS NULL
          OR target_provider NOT IN ('openai','deterministic') OR target_model IS NULL OR length(target_model) NOT BETWEEN 1 AND 100
          OR target_dimensions<>1536 OR target_chunking<>'sentence-cl100k-v1' THEN RAISE EXCEPTION 'learning retry denied' USING ERRCODE='42501'; END IF;
        SELECT ls.* INTO s FROM public.learning_suggestions ls WHERE ls.business_id=tenant_id AND ls.id=target_id FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        IF s.status='INDEXING' AND s.generation_id IS NOT NULL THEN RETURN QUERY SELECT s.id,s.status::text,s.approved_version,s.generation_id; RETURN; END IF;
        IF s.status<>'INDEXING_FAILED' OR s.version<>expected_version OR s.approved_revision_id IS NULL OR s.approved_faq_id IS NULL THEN
          RAISE EXCEPTION 'learning retry version conflict' USING ERRCODE='40001'; END IF;
        IF NOT EXISTS(SELECT 1 FROM public.knowledge_faqs f WHERE f.business_id=tenant_id AND f.id=s.approved_faq_id
          AND f.draft_revision_id=s.approved_revision_id AND f.published_revision_id IS NOT DISTINCT FROM s.expected_target_revision_id) THEN
          UPDATE public.learning_suggestions SET status='PUBLICATION_CONFLICT',updated_at=now() WHERE learning_suggestions.business_id=tenant_id AND learning_suggestions.id=target_id;
          RAISE EXCEPTION 'target FAQ changed before retry' USING ERRCODE='40001'; END IF;
        INSERT INTO public.knowledge_index_generations(id,business_id,request_key,source_type,source_id,source_revision_id,
          embedding_provider,embedding_model,embedding_dimensions,chunking_version,learning_suggestion_id,learning_suggestion_version)
          VALUES(gen_id,tenant_id,request_key,'FAQ',s.approved_faq_id,s.approved_revision_id,target_provider,target_model,target_dimensions,target_chunking,target_id,s.approved_version);
        INSERT INTO public.outbox_operations(id,"businessId",operation,metadata)
          VALUES(gen_id,tenant_id,'knowledge.index.requested',jsonb_build_object('generationId',gen_id,'suggestionId',target_id));
        UPDATE public.learning_suggestions SET status='INDEXING',generation_id=gen_id,updated_by=actor_id,updated_at=now()
          WHERE learning_suggestions.business_id=tenant_id AND learning_suggestions.id=target_id;
        INSERT INTO public.learning_suggestion_decisions(business_id,suggestion_id,suggestion_version,from_status,to_status,actor_account_id,generation_id)
          VALUES(tenant_id,target_id,s.approved_version,'INDEXING_FAILED','INDEXING',actor_id,gen_id);
        RETURN QUERY SELECT target_id,'INDEXING'::text,s.approved_version,gen_id;
      END $$;

      CREATE FUNCTION public.kleva_learning_evaluation_job_read(target_run uuid)
      RETURNS TABLE(run_id uuid,business_id uuid,expected_source_id uuid,question text,previous_revision_id uuid,previous_content text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' THEN RAISE EXCEPTION 'learning evaluator role required' USING ERRCODE='42501'; END IF;
        UPDATE public.learning_evaluation_runs r SET status='RUNNING'
          WHERE r.id=target_run AND r.status IN ('PENDING','RUNNING');
        RETURN QUERY SELECT r.id,r.business_id,r.approved_faq_id,v.proposed_question::text,r.previous_revision_id,
          COALESCE(prev.question||E'\n'||prev.answer,'')::text
          FROM public.learning_evaluation_runs r
          JOIN public.learning_suggestion_versions v ON v.business_id=r.business_id AND v.suggestion_id=r.suggestion_id AND v.version=r.suggestion_version
          LEFT JOIN public.knowledge_faq_revisions prev ON prev.id=r.previous_revision_id AND prev.business_id=r.business_id AND prev.faq_id=r.approved_faq_id
          WHERE r.id=target_run AND r.status='RUNNING';
      END $$;

      CREATE FUNCTION public.kleva_learning_evaluation_save(target_run uuid,target_results jsonb,target_failure text DEFAULT NULL)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE run_row public.learning_evaluation_runs%ROWTYPE; result_item jsonb;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' THEN RAISE EXCEPTION 'learning evaluator role required' USING ERRCODE='42501'; END IF;
        SELECT * INTO run_row FROM public.learning_evaluation_runs WHERE id=target_run FOR UPDATE;
        IF NOT FOUND OR run_row.status NOT IN ('RUNNING','PENDING') THEN RETURN false; END IF;
        IF target_failure IS NOT NULL AND target_failure !~ '^[A-Z_]{2,40}$' THEN RAISE EXCEPTION 'invalid evaluation category' USING ERRCODE='22023'; END IF;
        IF target_failure IS NULL THEN
          IF jsonb_typeof(target_results)<>'array' OR jsonb_array_length(target_results)>20 THEN RAISE EXCEPTION 'invalid evaluation results' USING ERRCODE='22023'; END IF;
          FOR result_item IN SELECT value FROM jsonb_array_elements(target_results) LOOP
            INSERT INTO public.learning_evaluation_results(business_id,run_id,case_id,question,before_outcome,after_outcome,expected_source_id,before_evidence,after_evidence,grounded,citations_valid,model_configuration,failure_category,evaluated_at)
            VALUES(run_row.business_id,run_row.id,result_item->>'caseId',left(result_item->>'question',500),result_item->>'beforeOutcome',result_item->>'afterOutcome',run_row.approved_faq_id,
              COALESCE(result_item->'beforeEvidence','[]'::jsonb),COALESCE(result_item->'afterEvidence','[]'::jsonb),NULL,NULL,'{}'::jsonb,NULL,now())
            ON CONFLICT (business_id,run_id,case_id) DO NOTHING;
          END LOOP;
          UPDATE public.learning_evaluation_runs SET status='COMPLETED',completed_at=now(),failure_category=NULL WHERE id=run_row.id;
          UPDATE public.learning_suggestions SET evaluation_status='COMPLETED' WHERE business_id=run_row.business_id AND id=run_row.suggestion_id;
        ELSE
          UPDATE public.learning_evaluation_runs SET status='FAILED',completed_at=now(),failure_category=target_failure WHERE id=run_row.id;
          UPDATE public.learning_suggestions SET evaluation_status='FAILED' WHERE business_id=run_row.business_id AND id=run_row.suggestion_id;
        END IF;
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_learning_evaluation_list(target_suggestion uuid)
      RETURNS TABLE(id uuid,approved_revision_id uuid,previous_revision_id uuid,status text,failure_category text,created_at timestamptz,completed_at timestamptz,results jsonb)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') THEN RAISE EXCEPTION 'learning evaluation access denied' USING ERRCODE='42501'; END IF;
        RETURN QUERY SELECT r.id,r.approved_revision_id,r.previous_revision_id,r.status::text,r.failure_category,r.created_at,r.completed_at,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('caseId',e.case_id,'question',e.question,'beforeOutcome',e.before_outcome,'afterOutcome',e.after_outcome,
            'expectedSourceId',e.expected_source_id,'beforeEvidence',e.before_evidence,'afterEvidence',e.after_evidence,'grounded',e.grounded,'citationsValid',e.citations_valid,'failureCategory',e.failure_category))
            FROM public.learning_evaluation_results e WHERE e.business_id=r.business_id AND e.run_id=r.id),'[]'::jsonb)
          FROM public.learning_evaluation_runs r WHERE r.business_id=tenant_id AND r.suggestion_id=target_suggestion ORDER BY r.created_at DESC;
      END $$;

      CREATE OR REPLACE FUNCTION public.kleva_knowledge_source_current(target_business uuid,target_type text,target_source uuid,target_revision uuid)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        SELECT CASE target_type
          WHEN 'FAQ' THEN EXISTS(SELECT 1 FROM public.knowledge_faqs f JOIN public.knowledge_faq_revisions r ON r.id=f.published_revision_id AND r.business_id=f.business_id AND r.faq_id=f.id
            WHERE f.business_id=target_business AND f.id=target_source AND f.published_revision_id=target_revision)
            OR EXISTS(SELECT 1 FROM public.knowledge_index_generations g JOIN public.learning_suggestions s ON s.business_id=g.business_id AND s.id=g.learning_suggestion_id
              JOIN public.knowledge_faqs f ON f.business_id=g.business_id AND f.id=g.source_id
              WHERE g.business_id=target_business AND g.source_type='FAQ' AND g.source_id=target_source AND g.source_revision_id=target_revision
                AND g.status IN ('PENDING','INDEXING') AND s.status='INDEXING' AND s.approved_revision_id=target_revision
                AND s.approved_faq_id=target_source AND s.approved_version=g.learning_suggestion_version
                AND f.draft_revision_id=target_revision AND f.published_revision_id IS NOT DISTINCT FROM s.expected_target_revision_id)
          WHEN 'PRODUCT' THEN EXISTS(SELECT 1 FROM public.merchant_products p JOIN public.merchant_product_revisions r ON r.id=p.published_revision_id AND r.business_id=p.business_id AND r.product_id=p.id WHERE p.business_id=target_business AND p.id=target_source AND p.published_revision_id=target_revision)
          WHEN 'DOCUMENT' THEN EXISTS(SELECT 1 FROM public.knowledge_documents d JOIN public.knowledge_document_revisions r ON r.id=d.published_revision_id AND r.business_id=d.business_id AND r.document_id=d.id WHERE d.business_id=target_business AND d.id=target_source AND d.status='PUBLISHED' AND d.published_revision_id=target_revision)
          ELSE false END
      $$;

      CREATE OR REPLACE FUNCTION public.kleva_knowledge_index_job_read(target_generation uuid)
      RETURNS TABLE(generation_id uuid,business_id uuid,source_type text,source_id uuid,source_revision_id uuid,provider text,model text,dimensions integer,
        title text,content text,page_number integer,source_offset integer)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE g public.knowledge_index_generations%ROWTYPE; s public.learning_suggestions%ROWTYPE;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' THEN RAISE EXCEPTION 'knowledge worker role required' USING ERRCODE='42501'; END IF;
        SELECT * INTO g FROM public.knowledge_index_generations WHERE id=target_generation;
        IF NOT FOUND OR g.status NOT IN ('PENDING','INDEXING') THEN RETURN; END IF;
        IF NOT public.kleva_knowledge_source_current(g.business_id,g.source_type,g.source_id,g.source_revision_id) THEN
          IF g.learning_suggestion_id IS NOT NULL THEN
            SELECT * INTO s FROM public.learning_suggestions WHERE business_id=g.business_id AND learning_suggestions.id=g.learning_suggestion_id FOR UPDATE;
            IF FOUND AND s.status='INDEXING' THEN
              UPDATE public.learning_suggestions SET status='PUBLICATION_CONFLICT',updated_at=now()
                WHERE learning_suggestions.business_id=g.business_id AND learning_suggestions.id=s.id;
              INSERT INTO public.learning_suggestion_decisions(business_id,suggestion_id,suggestion_version,from_status,to_status,reason_code,generation_id)
                VALUES(g.business_id,s.id,g.learning_suggestion_version,'INDEXING','PUBLICATION_CONFLICT','SOURCE_CHANGED',g.id);
            END IF;
          END IF;
          UPDATE public.knowledge_index_generations SET status='FAILED',failure_category='SOURCE_CHANGED',completed_at=now() WHERE id=g.id;
          RETURN;
        END IF;
        RETURN QUERY SELECT * FROM (
          SELECT g.id AS generation_id,g.business_id,g.source_type::text AS source_type,g.source_id,g.source_revision_id,g.embedding_provider::text AS provider,g.embedding_model::text AS model,g.embedding_dimensions AS dimensions,
            r.question::text AS title,(r.question||E'\n\n'||r.answer)::text AS content,NULL::integer AS page_number,0 AS source_offset FROM public.knowledge_faq_revisions r
            WHERE g.source_type='FAQ' AND r.business_id=g.business_id AND r.faq_id=g.source_id AND r.id=g.source_revision_id
          UNION ALL
          SELECT g.id,g.business_id,g.source_type::text,g.source_id,g.source_revision_id,g.embedding_provider::text,g.embedding_model::text,g.embedding_dimensions,
            r.name::text,(r.name||E'\n'||COALESCE(r.sku,'')||E'\n'||r.description)::text,NULL::integer,0 FROM public.merchant_product_revisions r
            WHERE g.source_type='PRODUCT' AND r.business_id=g.business_id AND r.product_id=g.source_id AND r.id=g.source_revision_id
          UNION ALL
          SELECT g.id,g.business_id,g.source_type::text,g.source_id,g.source_revision_id,g.embedding_provider::text,g.embedding_model::text,g.embedding_dimensions,
            d.title::text,p.content,p.page_number,0 FROM public.knowledge_document_pages p JOIN public.knowledge_documents d ON d.business_id=p.business_id AND d.id=p.document_id
            WHERE g.source_type='DOCUMENT' AND p.business_id=g.business_id AND p.revision_id=g.source_revision_id AND p.document_id=g.source_id
        ) source_rows ORDER BY source_rows.page_number NULLS FIRST;
      END $$;

      CREATE OR REPLACE FUNCTION public.kleva_knowledge_index_activate(target_generation uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE g public.knowledge_index_generations%ROWTYPE; s public.learning_suggestions%ROWTYPE; f public.knowledge_faqs%ROWTYPE;
        total_count integer; prior_revision uuid; actor_id uuid; evaluation_id uuid;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' THEN RAISE EXCEPTION 'knowledge worker role required' USING ERRCODE='42501'; END IF;
        SELECT * INTO g FROM public.knowledge_index_generations WHERE id=target_generation FOR UPDATE;
        IF NOT FOUND THEN RETURN false; END IF;
        IF g.status='ACTIVE' THEN RETURN public.kleva_knowledge_source_current(g.business_id,g.source_type,g.source_id,g.source_revision_id); END IF;
        IF g.status NOT IN ('INDEXING','READY') OR g.expected_chunk_count=0 OR NOT public.kleva_knowledge_source_current(g.business_id,g.source_type,g.source_id,g.source_revision_id) THEN RETURN false; END IF;
        SELECT count(*)::integer INTO total_count FROM public.knowledge_chunks c WHERE c.business_id=g.business_id AND c.generation_id=g.id;
        IF total_count=0 OR total_count<>g.indexed_chunk_count OR total_count<>g.expected_chunk_count OR total_count>2000 THEN RAISE EXCEPTION 'index generation is incomplete' USING ERRCODE='22023'; END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended(g.business_id::text||':'||g.source_type||':'||g.source_id::text,0));
        IF g.learning_suggestion_id IS NOT NULL THEN
          SELECT * INTO s FROM public.learning_suggestions WHERE business_id=g.business_id AND id=g.learning_suggestion_id FOR UPDATE;
          SELECT * INTO f FROM public.knowledge_faqs WHERE business_id=g.business_id AND id=g.source_id FOR UPDATE;
          IF NOT FOUND OR s.status<>'INDEXING' OR s.approved_revision_id<>g.source_revision_id OR s.approved_version<>g.learning_suggestion_version
            OR f.draft_revision_id<>g.source_revision_id OR f.published_revision_id IS DISTINCT FROM s.expected_target_revision_id THEN
            UPDATE public.learning_suggestions SET status='PUBLICATION_CONFLICT',updated_at=now() WHERE business_id=g.business_id AND id=g.learning_suggestion_id AND status='INDEXING';
            UPDATE public.knowledge_index_generations SET status='FAILED',failure_category='PUBLICATION_CONFLICT',completed_at=now() WHERE id=g.id;
            INSERT INTO public.learning_suggestion_decisions(business_id,suggestion_id,suggestion_version,from_status,to_status,reason_code,generation_id)
              VALUES(g.business_id,g.learning_suggestion_id,g.learning_suggestion_version,'INDEXING','PUBLICATION_CONFLICT','TARGET_REVISION_CHANGED',g.id);
            RETURN false;
          END IF;
          prior_revision:=f.published_revision_id;
          actor_id:=s.approved_by;
          UPDATE public.knowledge_faqs SET published_revision_id=g.source_revision_id,published_at=now(),updated_by=actor_id,updated_at=now()
            WHERE business_id=g.business_id AND id=g.source_id AND draft_revision_id=g.source_revision_id
              AND published_revision_id IS NOT DISTINCT FROM s.expected_target_revision_id;
          IF NOT FOUND THEN
            UPDATE public.learning_suggestions SET status='PUBLICATION_CONFLICT',updated_at=now() WHERE business_id=g.business_id AND id=s.id;
            UPDATE public.knowledge_index_generations SET status='FAILED',failure_category='PUBLICATION_CONFLICT',completed_at=now() WHERE id=g.id;
            RETURN false;
          END IF;
          INSERT INTO public.knowledge_faq_events(business_id,faq_id,revision_id,event_type,actor_account_id)
            VALUES(g.business_id,g.source_id,g.source_revision_id,'PUBLISHED',actor_id);
          UPDATE public.learning_suggestions SET status='PUBLISHED',evaluation_status='PENDING',updated_at=now()
            WHERE business_id=g.business_id AND id=s.id;
          UPDATE public.knowledge_index_generations SET status='SUPERSEDED'
            WHERE business_id=g.business_id AND source_type='FAQ' AND source_id=g.source_id AND status='ACTIVE' AND id<>g.id;
          INSERT INTO public.learning_evaluation_runs(business_id,suggestion_id,suggestion_version,approved_revision_id,approved_faq_id,previous_revision_id)
            VALUES(g.business_id,s.id,s.approved_version,g.source_revision_id,g.source_id,prior_revision)
            ON CONFLICT (business_id,suggestion_id,approved_revision_id) DO NOTHING
            RETURNING id INTO evaluation_id;
          IF evaluation_id IS NULL THEN
            SELECT id INTO evaluation_id FROM public.learning_evaluation_runs
              WHERE business_id=g.business_id AND suggestion_id=s.id AND approved_revision_id=g.source_revision_id;
          END IF;
          INSERT INTO public.outbox_operations(id,"businessId",operation,metadata)
            VALUES(evaluation_id,g.business_id,'knowledge.learning.evaluate',jsonb_build_object('suggestionId',s.id,'evaluationRunId',evaluation_id))
            ON CONFLICT (id) DO NOTHING;
          UPDATE public.learning_suggestions SET generation_id=g.id WHERE business_id=g.business_id AND id=s.id;
        END IF;
        UPDATE public.knowledge_index_generations SET status='ACTIVE',expected_chunk_count=total_count,indexed_chunk_count=total_count,
          completed_at=COALESCE(completed_at,now()),activated_at=now(),failure_category=NULL WHERE id=g.id;
        RETURN true;
      END $$;

      CREATE OR REPLACE FUNCTION public.kleva_knowledge_index_fail(target_generation uuid,target_category text)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE suggestion_id uuid; tenant_id uuid; suggestion_version integer;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' OR target_category !~ '^[A-Z_]{2,40}$' THEN RAISE EXCEPTION 'knowledge worker role required' USING ERRCODE='42501'; END IF;
        UPDATE public.knowledge_index_generations SET status='FAILED',failure_category=target_category,completed_at=now()
          WHERE id=target_generation AND status IN ('PENDING','INDEXING','READY')
          RETURNING business_id,learning_suggestion_id,learning_suggestion_version INTO tenant_id,suggestion_id,suggestion_version;
        IF suggestion_id IS NOT NULL THEN
          UPDATE public.learning_suggestions SET status='INDEXING_FAILED',updated_at=now()
            WHERE business_id=tenant_id AND id=suggestion_id AND status='INDEXING' AND approved_version=suggestion_version;
          INSERT INTO public.learning_suggestion_decisions(business_id,suggestion_id,suggestion_version,from_status,to_status,reason_code,generation_id)
            VALUES(tenant_id,suggestion_id,suggestion_version,'INDEXING','INDEXING_FAILED',target_category,target_generation);
        END IF;
      END $$;

      REVOKE ALL ON FUNCTION public.kleva_learning_suggestion_immutable(),public.kleva_learning_suggestions_list(text),public.kleva_learning_suggestion_detail(uuid),
        public.kleva_learning_suggestion_create(uuid,uuid,text,text,uuid,uuid,jsonb,text),public.kleva_learning_suggestion_edit(uuid,integer,text,text,uuid,uuid),
        public.kleva_learning_suggestion_submit(uuid,integer),public.kleva_learning_suggestion_approve(uuid,integer,uuid,text,text,integer,text),public.kleva_learning_suggestion_dismiss(uuid,text),
        public.kleva_learning_suggestion_retry(uuid,integer,uuid,text,text,integer,text),public.kleva_learning_evaluation_job_read(uuid),public.kleva_learning_evaluation_save(uuid,jsonb,text),public.kleva_learning_evaluation_list(uuid) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_merchant_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_learning_suggestions_list(text),public.kleva_learning_suggestion_detail(uuid),public.kleva_learning_suggestion_create(uuid,uuid,text,text,uuid,uuid,jsonb,text),public.kleva_learning_suggestion_edit(uuid,integer,text,text,uuid,uuid),public.kleva_learning_suggestion_submit(uuid,integer),public.kleva_learning_suggestion_approve(uuid,integer,uuid,text,text,integer,text),public.kleva_learning_suggestion_dismiss(uuid,text),public.kleva_learning_suggestion_retry(uuid,integer,uuid,text,text,integer,text),public.kleva_learning_evaluation_list(uuid) TO %I',role_name);
        END LOOP;
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_knowledge_source_current(uuid,text,uuid,uuid),public.kleva_knowledge_index_activate(uuid),public.kleva_knowledge_index_fail(uuid,text),public.kleva_learning_evaluation_job_read(uuid),public.kleva_learning_evaluation_save(uuid,jsonb,text) TO %I',role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(r: QueryRunner): Promise<void> {
    await r.query(`
      DO $$ BEGIN
        IF EXISTS(SELECT 1 FROM public.learning_suggestions) OR EXISTS(SELECT 1 FROM public.learning_suggestion_versions)
          OR EXISTS(SELECT 1 FROM public.learning_suggestion_decisions) OR EXISTS(SELECT 1 FROM public.learning_evaluation_runs)
          OR EXISTS(SELECT 1 FROM public.learning_evaluation_results) THEN
          RAISE EXCEPTION 'Learning approval history exists; preserve the schema for rollback.';
        END IF;
      END $$;
      CREATE OR REPLACE FUNCTION public.kleva_knowledge_source_current(target_business uuid,target_type text,target_source uuid,target_revision uuid)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        SELECT CASE target_type
          WHEN 'FAQ' THEN EXISTS(SELECT 1 FROM public.knowledge_faqs f JOIN public.knowledge_faq_revisions r ON r.id=f.published_revision_id AND r.business_id=f.business_id AND r.faq_id=f.id WHERE f.business_id=target_business AND f.id=target_source AND f.published_revision_id=target_revision)
          WHEN 'PRODUCT' THEN EXISTS(SELECT 1 FROM public.merchant_products p JOIN public.merchant_product_revisions r ON r.id=p.published_revision_id AND r.business_id=p.business_id AND r.product_id=p.id WHERE p.business_id=target_business AND p.id=target_source AND p.published_revision_id=target_revision)
          WHEN 'DOCUMENT' THEN EXISTS(SELECT 1 FROM public.knowledge_documents d JOIN public.knowledge_document_revisions r ON r.id=d.published_revision_id AND r.business_id=d.business_id AND r.document_id=d.id WHERE d.business_id=target_business AND d.id=target_source AND d.status='PUBLISHED' AND d.published_revision_id=target_revision)
          ELSE false END
      $$;
      CREATE OR REPLACE FUNCTION public.kleva_knowledge_index_job_read(target_generation uuid)
      RETURNS TABLE(generation_id uuid,business_id uuid,source_type text,source_id uuid,source_revision_id uuid,provider text,model text,dimensions integer,
        title text,content text,page_number integer,source_offset integer)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE g public.knowledge_index_generations%ROWTYPE;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' THEN RAISE EXCEPTION 'knowledge worker role required' USING ERRCODE='42501'; END IF;
        SELECT * INTO g FROM public.knowledge_index_generations WHERE id=target_generation;
        IF NOT FOUND OR g.status NOT IN ('PENDING','INDEXING') OR NOT public.kleva_knowledge_source_current(g.business_id,g.source_type,g.source_id,g.source_revision_id) THEN RETURN; END IF;
        RETURN QUERY SELECT * FROM (
          SELECT g.id AS generation_id,g.business_id,g.source_type::text AS source_type,g.source_id,g.source_revision_id,g.embedding_provider::text AS provider,g.embedding_model::text AS model,g.embedding_dimensions AS dimensions,
            r.question::text AS title,(r.question||E'\n\n'||r.answer)::text AS content,NULL::integer AS page_number,0 AS source_offset FROM public.knowledge_faq_revisions r
            WHERE g.source_type='FAQ' AND r.business_id=g.business_id AND r.faq_id=g.source_id AND r.id=g.source_revision_id
          UNION ALL
          SELECT g.id,g.business_id,g.source_type::text,g.source_id,g.source_revision_id,g.embedding_provider::text,g.embedding_model::text,g.embedding_dimensions,
            r.name::text,(r.name||E'\n'||COALESCE(r.sku,'')||E'\n'||r.description)::text,NULL::integer,0 FROM public.merchant_product_revisions r
            WHERE g.source_type='PRODUCT' AND r.business_id=g.business_id AND r.product_id=g.source_id AND r.id=g.source_revision_id
          UNION ALL
          SELECT g.id,g.business_id,g.source_type::text,g.source_id,g.source_revision_id,g.embedding_provider::text,g.embedding_model::text,g.embedding_dimensions,
            d.title::text,p.content,p.page_number,0 FROM public.knowledge_document_pages p JOIN public.knowledge_documents d ON d.business_id=p.business_id AND d.id=p.document_id
            WHERE g.source_type='DOCUMENT' AND p.business_id=g.business_id AND p.revision_id=g.source_revision_id AND p.document_id=g.source_id
        ) source_rows ORDER BY source_rows.page_number NULLS FIRST;
      END $$;
      CREATE OR REPLACE FUNCTION public.kleva_knowledge_index_activate(target_generation uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE g public.knowledge_index_generations%ROWTYPE; total_count integer;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' THEN RAISE EXCEPTION 'knowledge worker role required' USING ERRCODE='42501'; END IF;
        SELECT * INTO g FROM public.knowledge_index_generations WHERE id=target_generation FOR UPDATE;
        IF NOT FOUND OR g.status NOT IN ('INDEXING','READY','ACTIVE') OR g.expected_chunk_count=0 OR NOT public.kleva_knowledge_source_current(g.business_id,g.source_type,g.source_id,g.source_revision_id) THEN RETURN false; END IF;
        SELECT count(*)::integer INTO total_count FROM public.knowledge_chunks c WHERE c.business_id=g.business_id AND c.generation_id=g.id;
        IF total_count=0 OR total_count<>g.indexed_chunk_count OR total_count<>g.expected_chunk_count OR total_count>2000 THEN RAISE EXCEPTION 'index generation is incomplete' USING ERRCODE='22023'; END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended(g.business_id::text||':'||g.source_type||':'||g.source_id::text,0));
        UPDATE public.knowledge_index_generations SET status='SUPERSEDED' WHERE business_id=g.business_id AND source_type=g.source_type AND source_id=g.source_id AND status='ACTIVE' AND id<>g.id;
        UPDATE public.knowledge_index_generations SET status='ACTIVE',expected_chunk_count=total_count,indexed_chunk_count=total_count,completed_at=COALESCE(completed_at,now()),activated_at=now(),failure_category=NULL WHERE id=g.id;
        RETURN true;
      END $$;
      CREATE OR REPLACE FUNCTION public.kleva_knowledge_index_fail(target_generation uuid,target_category text)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' OR target_category !~ '^[A-Z_]{2,40}$' THEN RAISE EXCEPTION 'knowledge worker role required' USING ERRCODE='42501'; END IF;
        UPDATE public.knowledge_index_generations SET status='FAILED',failure_category=target_category,completed_at=now()
          WHERE id=target_generation AND status IN ('PENDING','INDEXING','READY');
      END $$;
      DROP FUNCTION public.kleva_learning_suggestion_dismiss(uuid,text);
      DROP FUNCTION public.kleva_learning_suggestion_retry(uuid,integer,uuid,text,text,integer,text);
      DROP FUNCTION public.kleva_learning_suggestion_approve(uuid,integer,uuid,text,text,integer,text);
      DROP FUNCTION public.kleva_learning_suggestion_submit(uuid,integer);
      DROP FUNCTION public.kleva_learning_suggestion_edit(uuid,integer,text,text,uuid,uuid);
      DROP FUNCTION public.kleva_learning_suggestion_create(uuid,uuid,text,text,uuid,uuid,jsonb,text);
      DROP FUNCTION public.kleva_learning_suggestion_detail(uuid);
      DROP FUNCTION public.kleva_learning_suggestions_list(text);
      DROP FUNCTION public.kleva_learning_evaluation_list(uuid);
      DROP FUNCTION public.kleva_learning_evaluation_save(uuid,jsonb,text);
      DROP FUNCTION public.kleva_learning_evaluation_job_read(uuid);
      DROP TRIGGER trg_learning_suggestion_decision_immutable ON public.learning_suggestion_decisions;
      DROP TRIGGER trg_learning_suggestion_version_immutable ON public.learning_suggestion_versions;
      DROP FUNCTION public.kleva_learning_suggestion_immutable();
      DROP TABLE public.learning_evaluation_results,public.learning_evaluation_runs,public.learning_suggestion_decisions,public.learning_suggestion_versions;
      ALTER TABLE public.learning_suggestions DROP CONSTRAINT fk_learning_suggestion_generation;
      ALTER TABLE public.knowledge_index_generations DROP CONSTRAINT fk_knowledge_generation_learning_suggestion,
        DROP CONSTRAINT ck_knowledge_generation_learning_pair,DROP COLUMN learning_suggestion_id,DROP COLUMN learning_suggestion_version;
      DROP TABLE public.learning_suggestions;
    `);
  }
}
