import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Staged, tenant-scoped pgvector generations for published merchant knowledge. */
export class SemanticKnowledgeIndex1760000000032 implements MigrationInterface {
  name = 'SemanticKnowledgeIndex1760000000032';

  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
          WHERE t.typname='vector' AND n.nspname='public') THEN
          RAISE EXCEPTION 'pgvector must be installed in the public schema by the migration/infrastructure role';
        END IF;
      END $$;

      ALTER TABLE public.business_usage_limits ADD COLUMN monthly_embedding_tokens integer
        CHECK (monthly_embedding_tokens IS NULL OR monthly_embedding_tokens >= 0);
      ALTER TABLE public.usage_reservations DROP CONSTRAINT usage_reservations_category_check;
      ALTER TABLE public.usage_reservations ADD CONSTRAINT usage_reservations_category_check
        CHECK (category IN ('whatsapp_outbound','ai_input_tokens','ai_output_tokens','knowledge_embedding_tokens','live_embedding_tokens','playground_embedding_tokens'));

      CREATE TABLE public.knowledge_index_generations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL,
        request_key uuid NOT NULL,
        source_type varchar(16) NOT NULL CHECK (source_type IN ('FAQ','PRODUCT','DOCUMENT')),
        source_id uuid NOT NULL, source_revision_id uuid NOT NULL,
        embedding_provider varchar(24) NOT NULL CHECK (embedding_provider IN ('openai','deterministic')),
        embedding_model varchar(100) NOT NULL, embedding_dimensions integer NOT NULL CHECK (embedding_dimensions=1536),
        chunking_version varchar(40) NOT NULL, status varchar(16) NOT NULL DEFAULT 'PENDING'
          CHECK (status IN ('PENDING','INDEXING','READY','ACTIVE','FAILED','SUPERSEDED','ARCHIVED')),
        expected_chunk_count integer NOT NULL DEFAULT 0 CHECK (expected_chunk_count BETWEEN 0 AND 2000),
        indexed_chunk_count integer NOT NULL DEFAULT 0 CHECK (indexed_chunk_count BETWEEN 0 AND expected_chunk_count),
        failure_category varchar(40), created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz, activated_at timestamptz,
        UNIQUE (business_id,id), UNIQUE (business_id,request_key),
        FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_knowledge_generation_source ON public.knowledge_index_generations
        (business_id,source_type,source_id,created_at DESC,id);
      CREATE UNIQUE INDEX uq_knowledge_active_generation ON public.knowledge_index_generations
        (business_id,source_type,source_id) WHERE status='ACTIVE';

      CREATE TABLE public.knowledge_chunks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, generation_id uuid NOT NULL,
        source_type varchar(16) NOT NULL CHECK (source_type IN ('FAQ','PRODUCT','DOCUMENT')),
        source_id uuid NOT NULL, source_revision_id uuid NOT NULL, chunk_index integer NOT NULL CHECK (chunk_index>=0),
        page_number integer CHECK (page_number BETWEEN 1 AND 100), source_start_offset integer NOT NULL CHECK (source_start_offset>=0),
        source_end_offset integer NOT NULL CHECK (source_end_offset>=source_start_offset),
        title varchar(500) NOT NULL, content text NOT NULL CHECK (length(content) BETWEEN 1 AND 12000),
        checksum_sha256 char(64) NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
        token_count integer NOT NULL CHECK (token_count BETWEEN 1 AND 800),
        search_vector tsvector GENERATED ALWAYS AS (to_tsvector('pg_catalog.simple'::regconfig, title || ' ' || content)) STORED,
        embedding public.vector(1536) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (business_id,generation_id,chunk_index),
        FOREIGN KEY (business_id,generation_id) REFERENCES public.knowledge_index_generations(business_id,id) ON DELETE CASCADE,
        FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_knowledge_chunks_generation ON public.knowledge_chunks(business_id,generation_id,chunk_index);
      CREATE INDEX idx_knowledge_chunks_search ON public.knowledge_chunks USING GIN(search_vector);
      -- Start with exact cosine search. An approximate index is deliberately deferred until filtered recall is measured.

      ALTER TABLE public.knowledge_index_generations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.knowledge_index_generations FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_knowledge_generations_internal ON public.knowledge_index_generations
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
      ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.knowledge_chunks FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_knowledge_chunks_internal ON public.knowledge_chunks
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE FUNCTION public.kleva_knowledge_index_start(target_request uuid,target_type text,target_source uuid,target_provider text,target_model text,target_dimensions integer,target_chunking text)
      RETURNS TABLE(generation_id uuid,status text,source_revision_id uuid)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        revision_id uuid; existing public.knowledge_index_generations%ROWTYPE; new_id uuid:=gen_random_uuid();
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') OR target_request IS NULL OR target_type NOT IN ('FAQ','PRODUCT','DOCUMENT')
          OR target_source IS NULL OR target_provider NOT IN ('openai','deterministic') OR target_model IS NULL OR length(target_model) NOT BETWEEN 1 AND 100
          OR target_dimensions<>1536 OR target_chunking NOT IN ('sentence-cl100k-v1') THEN
          RAISE EXCEPTION 'knowledge indexing request denied' USING ERRCODE='42501'; END IF;
        IF target_type='FAQ' THEN SELECT f.published_revision_id INTO revision_id FROM public.knowledge_faqs f WHERE f.business_id=tenant_id AND f.id=target_source AND f.published_revision_id IS NOT NULL FOR SHARE;
        ELSIF target_type='PRODUCT' THEN SELECT p.published_revision_id INTO revision_id FROM public.merchant_products p WHERE p.business_id=tenant_id AND p.id=target_source AND p.published_revision_id IS NOT NULL FOR SHARE;
        ELSE SELECT d.published_revision_id INTO revision_id FROM public.knowledge_documents d WHERE d.business_id=tenant_id AND d.id=target_source AND d.status='PUBLISHED' AND d.published_revision_id IS NOT NULL FOR SHARE;
        END IF;
        IF revision_id IS NULL THEN RAISE EXCEPTION 'source is not published' USING ERRCODE='22023'; END IF;
        SELECT * INTO existing FROM public.knowledge_index_generations g WHERE g.business_id=tenant_id AND g.request_key=target_request;
        IF FOUND THEN
          IF existing.source_type<>target_type OR existing.source_id<>target_source OR existing.source_revision_id<>revision_id
            OR existing.embedding_provider<>target_provider OR existing.embedding_model<>target_model
            OR existing.embedding_dimensions<>target_dimensions OR existing.chunking_version<>target_chunking THEN
            RAISE EXCEPTION 'knowledge indexing idempotency key conflict' USING ERRCODE='22023';
          END IF;
          RETURN QUERY SELECT existing.id,existing.status::text,existing.source_revision_id; RETURN;
        END IF;
        INSERT INTO public.knowledge_index_generations(id,business_id,request_key,source_type,source_id,source_revision_id,embedding_provider,embedding_model,embedding_dimensions,chunking_version)
          VALUES(new_id,tenant_id,target_request,target_type,target_source,revision_id,target_provider,target_model,target_dimensions,target_chunking);
        INSERT INTO public.outbox_operations(id,"businessId",operation,metadata)
          VALUES(new_id,tenant_id,'knowledge.index.requested',jsonb_build_object('generationId',new_id));
        RETURN QUERY SELECT new_id,'PENDING'::text,revision_id;
      END $$;

      CREATE FUNCTION public.kleva_knowledge_source_current(target_business uuid,target_type text,target_source uuid,target_revision uuid)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        SELECT CASE target_type WHEN 'FAQ' THEN EXISTS(SELECT 1 FROM public.knowledge_faqs f JOIN public.knowledge_faq_revisions r ON r.id=f.published_revision_id AND r.business_id=f.business_id AND r.faq_id=f.id WHERE f.business_id=target_business AND f.id=target_source AND f.published_revision_id=target_revision)
          WHEN 'PRODUCT' THEN EXISTS(SELECT 1 FROM public.merchant_products p JOIN public.merchant_product_revisions r ON r.id=p.published_revision_id AND r.business_id=p.business_id AND r.product_id=p.id WHERE p.business_id=target_business AND p.id=target_source AND p.published_revision_id=target_revision)
          WHEN 'DOCUMENT' THEN EXISTS(SELECT 1 FROM public.knowledge_documents d JOIN public.knowledge_document_revisions r ON r.id=d.published_revision_id AND r.business_id=d.business_id AND r.document_id=d.id WHERE d.business_id=target_business AND d.id=target_source AND d.status='PUBLISHED' AND d.published_revision_id=target_revision)
          ELSE false END
      $$;

      CREATE FUNCTION public.kleva_knowledge_index_job_read(target_generation uuid)
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

      CREATE FUNCTION public.kleva_knowledge_chunks_save(target_generation uuid,target_chunks jsonb)
      RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE g public.knowledge_index_generations%ROWTYPE; inserted_count integer; total_count integer;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' THEN RAISE EXCEPTION 'knowledge worker role required' USING ERRCODE='42501'; END IF;
        SELECT * INTO g FROM public.knowledge_index_generations WHERE id=target_generation FOR UPDATE;
        IF NOT FOUND OR g.status NOT IN ('PENDING','INDEXING') OR NOT public.kleva_knowledge_source_current(g.business_id,g.source_type,g.source_id,g.source_revision_id) THEN RETURN 0; END IF;
        IF jsonb_typeof(target_chunks)<>'array' OR jsonb_array_length(target_chunks)>64 THEN RAISE EXCEPTION 'invalid chunk batch' USING ERRCODE='22023'; END IF;
        UPDATE public.knowledge_index_generations SET status='INDEXING' WHERE id=g.id;
        INSERT INTO public.knowledge_chunks(business_id,generation_id,source_type,source_id,source_revision_id,chunk_index,page_number,source_start_offset,source_end_offset,title,content,checksum_sha256,token_count,embedding)
        SELECT g.business_id,g.id,g.source_type,g.source_id,g.source_revision_id,(x->>'chunkIndex')::integer,NULLIF(x->>'pageNumber','')::integer,
          (x->>'startOffset')::integer,(x->>'endOffset')::integer,(x->>'title')::varchar,(x->>'content'),(x->>'checksum'),(x->>'tokenCount')::integer,(x->>'embedding')::public.vector(1536)
        FROM jsonb_array_elements(target_chunks) x
        ON CONFLICT (business_id,generation_id,chunk_index) DO NOTHING;
        GET DIAGNOSTICS inserted_count=ROW_COUNT;
        SELECT count(*)::integer INTO total_count FROM public.knowledge_chunks c WHERE c.business_id=g.business_id AND c.generation_id=g.id;
        UPDATE public.knowledge_index_generations SET indexed_chunk_count=total_count WHERE id=g.id;
        RETURN inserted_count;
      END $$;

      CREATE FUNCTION public.kleva_knowledge_index_expected(target_generation uuid,target_count integer)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE g public.knowledge_index_generations%ROWTYPE;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' THEN RAISE EXCEPTION 'knowledge worker role required' USING ERRCODE='42501'; END IF;
        SELECT * INTO g FROM public.knowledge_index_generations WHERE id=target_generation FOR UPDATE;
        IF NOT FOUND OR g.status NOT IN ('PENDING','INDEXING') OR target_count NOT BETWEEN 1 AND 2000
          OR NOT public.kleva_knowledge_source_current(g.business_id,g.source_type,g.source_id,g.source_revision_id) THEN RETURN false; END IF;
        IF g.expected_chunk_count NOT IN (0,target_count) THEN RAISE EXCEPTION 'generation chunk count changed' USING ERRCODE='22023'; END IF;
        UPDATE public.knowledge_index_generations SET status='INDEXING',expected_chunk_count=target_count WHERE id=g.id;
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_knowledge_chunk_exists(target_generation uuid,target_index integer,target_checksum text)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        SELECT session_user::text ~ '^kleva_runtime_' AND EXISTS(SELECT 1 FROM public.knowledge_chunks c
          JOIN public.knowledge_index_generations g ON g.business_id=c.business_id AND g.id=c.generation_id
          WHERE c.generation_id=target_generation AND c.chunk_index=target_index AND c.checksum_sha256=target_checksum
            AND g.status IN ('INDEXING','READY','ACTIVE') AND public.kleva_knowledge_source_current(g.business_id,g.source_type,g.source_id,g.source_revision_id))
      $$;

      CREATE FUNCTION public.kleva_knowledge_index_activate(target_generation uuid)
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

      CREATE FUNCTION public.kleva_knowledge_index_fail(target_generation uuid,target_category text)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' OR target_category !~ '^[A-Z_]{2,40}$' THEN RAISE EXCEPTION 'knowledge worker role required' USING ERRCODE='42501'; END IF;
        UPDATE public.knowledge_index_generations SET status='FAILED',failure_category=target_category,completed_at=now()
          WHERE id=target_generation AND status IN ('PENDING','INDEXING','READY');
      END $$;

      CREATE FUNCTION public.kleva_knowledge_index_status(target_source_type text,target_source uuid)
      RETURNS TABLE(generation_id uuid,status text,chunk_count integer,expected_chunks integer,indexed_at timestamptz,failure_category text,semantic_ready boolean)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') OR target_source_type NOT IN ('FAQ','PRODUCT','DOCUMENT') THEN RAISE EXCEPTION 'knowledge index status denied' USING ERRCODE='42501'; END IF;
        RETURN QUERY SELECT g.id,g.status::text,g.indexed_chunk_count,g.expected_chunk_count,g.activated_at,g.failure_category,
          g.status='ACTIVE' AND public.kleva_knowledge_source_current(g.business_id,g.source_type,g.source_id,g.source_revision_id)
          FROM public.knowledge_index_generations g WHERE g.business_id=tenant_id AND g.source_type=target_source_type AND g.source_id=target_source
          ORDER BY g.created_at DESC LIMIT 10;
      END $$;

      CREATE FUNCTION public.kleva_search_semantic(target_business uuid,target_query public.vector(1536),target_model text,target_limit integer,target_minimum real)
      RETURNS TABLE(has_published_content boolean,source_type text,source_id uuid,revision_id uuid,chunk_id uuid,generation_id uuid,title text,content text,page_number integer,
        source_start_offset integer,source_end_offset integer,relevance_score real,sku text,price numeric,currency text,availability text)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        IF session_user::text ~ '^kleva_(merchant|identity)_' OR target_business IS NULL OR target_query IS NULL OR target_model IS NULL
          OR target_limit NOT BETWEEN 1 AND 100 OR target_minimum NOT BETWEEN -1 AND 1 THEN RAISE EXCEPTION 'semantic search denied' USING ERRCODE='42501'; END IF;
        RETURN QUERY SELECT true::boolean,c.source_type::text,c.source_id,c.source_revision_id,c.id,c.generation_id,c.title::text,c.content,c.page_number,c.source_start_offset,c.source_end_offset,
          (1-(c.embedding <=> target_query))::real,
          CASE WHEN c.source_type='PRODUCT' THEN pr.sku::text ELSE NULL::text END,
          CASE WHEN c.source_type='PRODUCT' THEN pr.price ELSE NULL::numeric END,
          CASE WHEN c.source_type='PRODUCT' THEN pr.currency::text ELSE NULL::text END,
          CASE WHEN c.source_type='PRODUCT' THEN pr.availability::text ELSE NULL::text END
        FROM public.knowledge_chunks c JOIN public.knowledge_index_generations g ON g.business_id=c.business_id AND g.id=c.generation_id AND g.status='ACTIVE' AND g.embedding_model=target_model
        LEFT JOIN public.merchant_product_revisions pr ON c.source_type='PRODUCT' AND pr.business_id=c.business_id AND pr.product_id=c.source_id AND pr.id=c.source_revision_id
        WHERE c.business_id=target_business AND EXISTS(SELECT 1 FROM public.businesses b WHERE b.id=c.business_id AND b.status='active')
          AND public.kleva_knowledge_source_current(c.business_id,c.source_type,c.source_id,c.source_revision_id)
          AND (1-(c.embedding <=> target_query))>=target_minimum
        ORDER BY c.embedding <=> target_query,c.source_type,c.source_id,c.chunk_index LIMIT target_limit;
      END $$;

      CREATE FUNCTION public.kleva_knowledge_semantic_available(target_business uuid,target_model text)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        SELECT session_user::text !~ '^kleva_(merchant|identity)_' AND EXISTS(
          SELECT 1 FROM public.knowledge_index_generations g JOIN public.businesses b ON b.id=g.business_id AND b.status='active'
          WHERE g.business_id=target_business AND g.status='ACTIVE' AND g.embedding_model=target_model
            AND public.kleva_knowledge_source_current(g.business_id,g.source_type,g.source_id,g.source_revision_id))
      $$;

      REVOKE ALL ON FUNCTION public.kleva_knowledge_index_start(uuid,text,uuid,text,text,integer,text),public.kleva_knowledge_index_status(text,uuid) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_knowledge_index_job_read(uuid),public.kleva_knowledge_source_current(uuid,text,uuid,uuid),public.kleva_knowledge_chunks_save(uuid,jsonb),public.kleva_knowledge_index_expected(uuid,integer),public.kleva_knowledge_chunk_exists(uuid,integer,text),public.kleva_knowledge_index_activate(uuid),public.kleva_knowledge_index_fail(uuid,text),public.kleva_search_semantic(uuid,public.vector,text,integer,real),public.kleva_knowledge_semantic_available(uuid,text) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_merchant_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_knowledge_index_start(uuid,text,uuid,text,text,integer,text),public.kleva_knowledge_index_status(text,uuid) TO %I',role_name);
        END LOOP;
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('GRANT USAGE ON TYPE public.vector TO %I',role_name);
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_knowledge_index_job_read(uuid),public.kleva_knowledge_source_current(uuid,text,uuid,uuid),public.kleva_knowledge_chunks_save(uuid,jsonb),public.kleva_knowledge_index_expected(uuid,integer),public.kleva_knowledge_chunk_exists(uuid,integer,text),public.kleva_knowledge_index_activate(uuid),public.kleva_knowledge_index_fail(uuid,text),public.kleva_search_semantic(uuid,public.vector,text,integer,real),public.kleva_knowledge_semantic_available(uuid,text) TO %I',role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(r: QueryRunner): Promise<void> {
    await r.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM public.knowledge_index_generations) OR EXISTS (SELECT 1 FROM public.knowledge_chunks) THEN
          RAISE EXCEPTION 'Knowledge index generations exist. Preserve the semantic index schema for rollback.';
        END IF;
        IF EXISTS (SELECT 1 FROM public.usage_reservations WHERE category IN ('knowledge_embedding_tokens','live_embedding_tokens','playground_embedding_tokens')) THEN
          RAISE EXCEPTION 'Embedding usage ledger rows exist. Preserve the embedding metering schema for rollback.';
        END IF;
      END $$;
      REVOKE ALL ON FUNCTION public.kleva_knowledge_index_start(uuid,text,uuid,text,text,integer,text),public.kleva_knowledge_index_status(text,uuid),
        public.kleva_knowledge_index_job_read(uuid),public.kleva_knowledge_source_current(uuid,text,uuid,uuid),public.kleva_knowledge_chunks_save(uuid,jsonb),public.kleva_knowledge_index_expected(uuid,integer),public.kleva_knowledge_chunk_exists(uuid,integer,text),
        public.kleva_knowledge_index_activate(uuid),public.kleva_knowledge_index_fail(uuid,text),public.kleva_search_semantic(uuid,public.vector,text,integer,real),public.kleva_knowledge_semantic_available(uuid,text) FROM PUBLIC;
      DROP FUNCTION public.kleva_knowledge_index_start(uuid,text,uuid,text,text,integer,text),public.kleva_knowledge_index_status(text,uuid),
        public.kleva_knowledge_index_job_read(uuid),public.kleva_knowledge_source_current(uuid,text,uuid,uuid),public.kleva_knowledge_chunks_save(uuid,jsonb),public.kleva_knowledge_index_expected(uuid,integer),public.kleva_knowledge_chunk_exists(uuid,integer,text),
        public.kleva_knowledge_index_activate(uuid),public.kleva_knowledge_index_fail(uuid,text),public.kleva_search_semantic(uuid,public.vector,text,integer,real),public.kleva_knowledge_semantic_available(uuid,text);
      DROP TABLE public.knowledge_chunks,public.knowledge_index_generations;
      ALTER TABLE public.usage_reservations DROP CONSTRAINT usage_reservations_category_check;
      ALTER TABLE public.usage_reservations ADD CONSTRAINT usage_reservations_category_check
        CHECK (category IN ('whatsapp_outbound','ai_input_tokens','ai_output_tokens'));
      ALTER TABLE public.business_usage_limits DROP COLUMN monthly_embedding_tokens;
      -- Do not drop the shared extension; other applications may depend on it.
    `);
  }
}
