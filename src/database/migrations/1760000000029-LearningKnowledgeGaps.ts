import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Tenant-isolated, redacted knowledge-gap clusters sourced from real AI runs. */
export class LearningKnowledgeGaps1760000000029 implements MigrationInterface {
  name = 'LearningKnowledgeGaps1760000000029';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE public.knowledge_gap_clusters (
        id uuid PRIMARY KEY,
        business_id uuid NOT NULL,
        cluster_key char(64) NOT NULL CHECK (cluster_key ~ '^[0-9a-f]{64}$'),
        category varchar(32) NOT NULL CHECK (category IN
          ('MISSING_KNOWLEDGE','UNSUPPORTED_REQUEST','CLARIFICATION_FAILURE','STALE_KNOWLEDGE')),
        normalized_topic varchar(180) NOT NULL CHECK (length(normalized_topic) BETWEEN 1 AND 180),
        topic_label varchar(120) NOT NULL CHECK (length(topic_label) BETWEEN 1 AND 120),
        status varchar(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REVIEWED','DISMISSED')),
        occurrence_count integer NOT NULL DEFAULT 0 CHECK (occurrence_count >= 0),
        first_seen_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        last_reason_code varchar(40) NOT NULL CHECK (last_reason_code IN
          ('NO_MATCH','INSUFFICIENT_EVIDENCE','MODEL_ABSTAINED','INVALID_EVIDENCE_REFERENCE',
           'UNSUPPORTED_COMMERCIAL_CLAIM','UNSUPPORTED_DELIVERY_CLAIM','WEAK_EVIDENCE_OVERLAP',
           'UNSUPPORTED_PRICE_OR_CURRENCY','UNKNOWN_AVAILABILITY_CLAIM',
           'UNSUPPORTED_AVAILABILITY_CLAIM','PUBLISHED_EVIDENCE_CHANGED')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_knowledge_gap_business_key UNIQUE (business_id,cluster_key),
        CONSTRAINT uq_knowledge_gap_business_id UNIQUE (business_id,id),
        CONSTRAINT fk_knowledge_gap_business FOREIGN KEY (business_id)
          REFERENCES public.businesses(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_knowledge_gap_business_latest
        ON public.knowledge_gap_clusters(business_id,last_seen_at DESC,id DESC)
        WHERE occurrence_count > 0;

      CREATE TABLE public.knowledge_gap_occurrences (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        cluster_id uuid NOT NULL,
        source_ai_run_id uuid NOT NULL,
        origin_reference uuid NOT NULL,
        channel varchar(16) NOT NULL CHECK (channel='WHATSAPP'),
        category varchar(32) NOT NULL CHECK (category IN
          ('MISSING_KNOWLEDGE','UNSUPPORTED_REQUEST','CLARIFICATION_FAILURE','STALE_KNOWLEDGE')),
        reason_code varchar(40) NOT NULL CHECK (reason_code IN
          ('NO_MATCH','INSUFFICIENT_EVIDENCE','MODEL_ABSTAINED','INVALID_EVIDENCE_REFERENCE',
           'UNSUPPORTED_COMMERCIAL_CLAIM','UNSUPPORTED_DELIVERY_CLAIM','WEAK_EVIDENCE_OVERLAP',
           'UNSUPPORTED_PRICE_OR_CURRENCY','UNKNOWN_AVAILABILITY_CLAIM',
           'UNSUPPORTED_AVAILABILITY_CLAIM','PUBLISHED_EVIDENCE_CHANGED')),
        redacted_question varchar(280),
        occurred_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days',
        CONSTRAINT uq_knowledge_gap_run UNIQUE (business_id,source_ai_run_id),
        CONSTRAINT fk_knowledge_gap_occurrence_cluster FOREIGN KEY (business_id,cluster_id)
          REFERENCES public.knowledge_gap_clusters(business_id,id) ON DELETE CASCADE,
        CONSTRAINT fk_knowledge_gap_occurrence_run FOREIGN KEY (business_id,source_ai_run_id)
          REFERENCES public.ai_response_runs(business_id,id) ON DELETE CASCADE,
        CONSTRAINT fk_knowledge_gap_occurrence_message FOREIGN KEY (business_id,origin_reference)
          REFERENCES public.messages("businessId",id) ON DELETE CASCADE,
        CHECK (redacted_question IS NULL OR length(redacted_question) BETWEEN 4 AND 280),
        CHECK (expires_at > occurred_at)
      );
      CREATE INDEX idx_knowledge_gap_occurrence_cluster
        ON public.knowledge_gap_occurrences(business_id,cluster_id,occurred_at DESC);
      CREATE INDEX idx_knowledge_gap_occurrence_expiry
        ON public.knowledge_gap_occurrences(expires_at,id);

      CREATE FUNCTION public.kleva_learning_gap_validate_occurrence()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE run_status text; run_reason text; run_message uuid; message_direction text;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' THEN
          RAISE EXCEPTION 'learning gap capture is worker-only' USING ERRCODE='42501';
        END IF;
        SELECT a.status,a.error_category,a.inbound_message_id
          INTO run_status,run_reason,run_message
        FROM public.ai_response_runs a
        WHERE a.business_id=NEW.business_id AND a.id=NEW.source_ai_run_id;
        SELECT m.direction INTO message_direction FROM public.messages m
          WHERE m."businessId"=NEW.business_id AND m.id=NEW.origin_reference;
        IF run_status IS DISTINCT FROM 'HANDOFF_REQUIRED' OR run_reason IS DISTINCT FROM NEW.reason_code
          OR run_message IS DISTINCT FROM NEW.origin_reference OR message_direction IS DISTINCT FROM 'inbound' THEN
          RAISE EXCEPTION 'learning gap is not backed by an eligible AI outcome' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER trg_knowledge_gap_validate_occurrence
        BEFORE INSERT ON public.knowledge_gap_occurrences
        FOR EACH ROW EXECUTE FUNCTION public.kleva_learning_gap_validate_occurrence();

      ALTER TABLE public.knowledge_gap_clusters ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.knowledge_gap_clusters FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.knowledge_gap_occurrences ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.knowledge_gap_occurrences FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_knowledge_gap_clusters_internal ON public.knowledge_gap_clusters
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
      CREATE POLICY kleva_knowledge_gap_occurrences_internal ON public.knowledge_gap_occurrences
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.knowledge_gap_clusters TO %I',role_name);
          EXECUTE format('GRANT SELECT,INSERT ON public.knowledge_gap_occurrences TO %I',role_name);
        END LOOP;
      END $$;

      CREATE FUNCTION public.kleva_learning_gaps(page_size integer,status_filter text DEFAULT NULL)
      RETURNS TABLE(id uuid,category text,topic_label text,normalized_topic text,status text,
        occurrence_count integer,first_seen_at timestamptz,last_seen_at timestamptz,
        last_reason_code text,sample_question text)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor')
          OR (status_filter IS NOT NULL AND status_filter NOT IN ('OPEN','REVIEWED','DISMISSED')) THEN
          RAISE EXCEPTION 'learning gap access denied' USING ERRCODE='42501';
        END IF;
        RETURN QUERY SELECT c.id,c.category::text,c.topic_label::text,c.normalized_topic::text,
          c.status::text,c.occurrence_count,c.first_seen_at,c.last_seen_at,c.last_reason_code::text,
          (SELECT o.redacted_question FROM public.knowledge_gap_occurrences o
            WHERE o.business_id=c.business_id AND o.cluster_id=c.id AND o.expires_at>now()
              AND o.redacted_question IS NOT NULL ORDER BY o.occurred_at DESC,o.id DESC LIMIT 1)
        FROM public.knowledge_gap_clusters c
        WHERE c.business_id=tenant_id AND c.occurrence_count>0
          AND (status_filter IS NULL OR c.status=status_filter)
        ORDER BY c.last_seen_at DESC,c.id DESC LIMIT LEAST(GREATEST(page_size,1),100);
      END $$;

      CREATE FUNCTION public.kleva_learning_gap_set_status(target_id uuid,next_status text)
      RETURNS TABLE(id uuid,status text,updated_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor')
          OR next_status NOT IN ('OPEN','REVIEWED','DISMISSED') THEN
          RAISE EXCEPTION 'learning gap update denied' USING ERRCODE='42501';
        END IF;
        RETURN QUERY UPDATE public.knowledge_gap_clusters c
          SET status=next_status,updated_at=now()
          WHERE c.id=target_id AND c.business_id=tenant_id AND c.occurrence_count>0
          RETURNING c.id,c.status::text,c.updated_at;
      END $$;

      CREATE FUNCTION public.kleva_learning_gap_purge_expired()
      RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE removed integer;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' THEN
          RAISE EXCEPTION 'learning gap retention is worker-only' USING ERRCODE='42501';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended('kleva-learning-gap-retention',0));
        DELETE FROM public.knowledge_gap_occurrences WHERE expires_at<=now();
        GET DIAGNOSTICS removed=ROW_COUNT;
        UPDATE public.knowledge_gap_clusters c SET
          occurrence_count=(SELECT count(*)::integer FROM public.knowledge_gap_occurrences o
            WHERE o.business_id=c.business_id AND o.cluster_id=c.id),
          first_seen_at=COALESCE((SELECT min(o.occurred_at) FROM public.knowledge_gap_occurrences o
            WHERE o.business_id=c.business_id AND o.cluster_id=c.id),c.created_at),
          last_seen_at=COALESCE((SELECT max(o.occurred_at) FROM public.knowledge_gap_occurrences o
            WHERE o.business_id=c.business_id AND o.cluster_id=c.id),c.created_at),updated_at=now();
        RETURN removed;
      END $$;

      REVOKE ALL ON FUNCTION public.kleva_learning_gaps(integer,text),
        public.kleva_learning_gap_set_status(uuid,text),public.kleva_learning_gap_purge_expired(),
        public.kleva_learning_gap_validate_occurrence() FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_merchant_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_learning_gaps(integer,text) TO %I',role_name);
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_learning_gap_set_status(uuid,text) TO %I',role_name);
        END LOOP;
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_learning_gap_purge_expired() TO %I',role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    const [row] = (await runner.query(`
      SELECT count(*) AS occurrences FROM public.knowledge_gap_occurrences
    `)) as Array<{ occurrences: string }>;
    if (Number(row?.occurrences ?? 0) > 0) {
      throw new Error(
        'Knowledge-gap history exists; preserve the feature schema for rollback.',
      );
    }
    await runner.query(`
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_merchant_%' LOOP
          EXECUTE format('REVOKE EXECUTE ON FUNCTION public.kleva_learning_gaps(integer,text) FROM %I',role_name);
          EXECUTE format('REVOKE EXECUTE ON FUNCTION public.kleva_learning_gap_set_status(uuid,text) FROM %I',role_name);
        END LOOP;
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('REVOKE SELECT,INSERT,UPDATE ON public.knowledge_gap_clusters FROM %I',role_name);
          EXECUTE format('REVOKE SELECT,INSERT ON public.knowledge_gap_occurrences FROM %I',role_name);
          EXECUTE format('REVOKE EXECUTE ON FUNCTION public.kleva_learning_gap_purge_expired() FROM %I',role_name);
        END LOOP;
      END $$;
      DROP TRIGGER trg_knowledge_gap_validate_occurrence ON public.knowledge_gap_occurrences;
      DROP FUNCTION public.kleva_learning_gaps(integer,text);
      DROP FUNCTION public.kleva_learning_gap_set_status(uuid,text);
      DROP FUNCTION public.kleva_learning_gap_purge_expired();
      DROP FUNCTION public.kleva_learning_gap_validate_occurrence();
      DROP TABLE public.knowledge_gap_occurrences;
      DROP TABLE public.knowledge_gap_clusters;
    `);
  }
}
