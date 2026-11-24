import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Private, version-pinned PDF source uploads and reviewable extracted pages. */
export class KnowledgeDocumentUploads1760000000031 implements MigrationInterface {
  name = 'KnowledgeDocumentUploads1760000000031';

  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE public.knowledge_documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL,
        title varchar(160) NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
        status varchar(16) NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING','DRAFT','PUBLISHED','FAILED','EXPIRED')),
        draft_revision_id uuid, published_revision_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (business_id,id),
        FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_knowledge_documents_business ON public.knowledge_documents(business_id,created_at DESC,id);
      CREATE TABLE public.knowledge_document_revisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, document_id uuid NOT NULL,
        revision integer NOT NULL CHECK (revision>0), status varchar(16) NOT NULL DEFAULT 'UPLOADING'
          CHECK (status IN ('UPLOADING','QUEUED','PROCESSING','DRAFT','PUBLISHED','FAILED','EXPIRED')),
        object_key varchar(500) NOT NULL UNIQUE, object_version_id varchar(1024),
        checksum_sha256 char(64) NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
        size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
        page_count integer CHECK (page_count BETWEEN 1 AND 100), error_code varchar(40),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (business_id,id), UNIQUE (business_id,document_id,revision),
        FOREIGN KEY (business_id,document_id) REFERENCES public.knowledge_documents(business_id,id) ON DELETE CASCADE,
        CHECK (object_version_id IS NULL OR length(object_version_id) BETWEEN 1 AND 1024)
      );
      ALTER TABLE public.knowledge_documents ADD CONSTRAINT fk_knowledge_documents_draft_revision
        FOREIGN KEY (business_id,draft_revision_id) REFERENCES public.knowledge_document_revisions(business_id,id);
      ALTER TABLE public.knowledge_documents ADD CONSTRAINT fk_knowledge_documents_published_revision
        FOREIGN KEY (business_id,published_revision_id) REFERENCES public.knowledge_document_revisions(business_id,id);
      CREATE TABLE public.knowledge_document_upload_intents (
        id uuid PRIMARY KEY, business_id uuid NOT NULL, document_id uuid NOT NULL, revision_id uuid NOT NULL,
        idempotency_key uuid NOT NULL, expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, expired_at timestamptz,
        UNIQUE (business_id,idempotency_key), UNIQUE (business_id,revision_id),
        FOREIGN KEY (business_id,document_id) REFERENCES public.knowledge_documents(business_id,id) ON DELETE CASCADE,
        FOREIGN KEY (business_id,revision_id) REFERENCES public.knowledge_document_revisions(business_id,id) ON DELETE CASCADE,
        CHECK (expires_at>created_at)
      );
      CREATE INDEX idx_knowledge_upload_expiry ON public.knowledge_document_upload_intents(expires_at,id) WHERE completed_at IS NULL;
      CREATE TABLE public.knowledge_document_pages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, document_id uuid NOT NULL,
        revision_id uuid NOT NULL, page_number integer NOT NULL CHECK (page_number BETWEEN 1 AND 100),
        content text NOT NULL CHECK (length(content) BETWEEN 1 AND 50000),
        search_vector tsvector GENERATED ALWAYS AS (to_tsvector('pg_catalog.simple'::regconfig,content)) STORED,
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (business_id,revision_id,page_number),
        FOREIGN KEY (business_id,document_id) REFERENCES public.knowledge_documents(business_id,id) ON DELETE CASCADE,
        FOREIGN KEY (business_id,revision_id) REFERENCES public.knowledge_document_revisions(business_id,id) ON DELETE CASCADE
      );
      CREATE INDEX idx_knowledge_document_pages_search ON public.knowledge_document_pages USING GIN(search_vector);
      CREATE INDEX idx_knowledge_document_pages_revision ON public.knowledge_document_pages(business_id,revision_id,page_number);

      CREATE OR REPLACE FUNCTION public.kleva_pilot_readiness()
      RETURNS TABLE(business_active boolean,connection_id uuid,whatsapp_verified boolean,published_knowledge boolean,
        assistant_configured boolean,pilot_approved boolean,approval_matches_connection boolean,human_takeover_count bigint)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor','agent') THEN RAISE EXCEPTION 'pilot status access denied' USING ERRCODE='42501'; END IF;
        RETURN QUERY WITH connection AS (
          SELECT c.id,c.status,c."verifiedAt" FROM public.channel_connections c WHERE c."businessId"=tenant_id AND c.provider='whatsapp' ORDER BY c."updatedAt" DESC LIMIT 1
        ), enrollment AS (
          SELECT e.status,e.connection_id FROM public.business_pilot_enrollments e WHERE e.business_id=tenant_id AND e.status IN ('PENDING_REVIEW','ACTIVE') ORDER BY e.created_at DESC LIMIT 1
        ) SELECT b.status='active',c.id,COALESCE(c.status='active' AND c."verifiedAt" IS NOT NULL,false),
          EXISTS(SELECT 1 FROM public.knowledge_faqs f WHERE f.business_id=tenant_id AND f.published_revision_id IS NOT NULL)
          OR EXISTS(SELECT 1 FROM public.merchant_products p WHERE p.business_id=tenant_id AND p.published_revision_id IS NOT NULL)
          OR EXISTS(SELECT 1 FROM public.knowledge_documents d WHERE d.business_id=tenant_id AND d.published_revision_id IS NOT NULL),
          EXISTS(SELECT 1 FROM public.assistant_configurations ac WHERE ac.business_id=tenant_id),COALESCE(e.status='ACTIVE',false),
          COALESCE(e.status='ACTIVE' AND e.connection_id=c.id,false),
          (SELECT count(*) FROM public.conversations v WHERE v."businessId"=tenant_id AND v.control_mode='HUMAN' AND lower(COALESCE(v.status,'open')) NOT IN ('closed','resolved'))
        FROM public.businesses b CROSS JOIN (SELECT 1) seed LEFT JOIN connection c ON true LEFT JOIN enrollment e ON true WHERE b.id=tenant_id;
      END $$;

      CREATE OR REPLACE FUNCTION public.kleva_pilot_activate(target_enrollment uuid,evidence_reference text,
        default_ai_input integer,default_ai_output integer,default_whatsapp integer,default_request_tokens integer)
      RETURNS TABLE(enrollment_id uuid,business_id uuid,connection_id uuid,status varchar,activated_at timestamptz,activated_by text,activation_reference text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      BEGIN
        IF session_user !~ '^kleva_pilot_operator_[a-z0-9_]{1,40}$' THEN RAISE EXCEPTION 'pilot operator role required' USING ERRCODE='42501'; END IF;
        IF evidence_reference IS NULL OR evidence_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{5,199}$' THEN RAISE EXCEPTION 'valid approval evidence reference required' USING ERRCODE='22023'; END IF;
        IF default_ai_input<1 OR default_ai_output<1 OR default_whatsapp<1 OR default_request_tokens<1 THEN RAISE EXCEPTION 'positive usage limits are required' USING ERRCODE='22023'; END IF;
        RETURN QUERY UPDATE public.business_pilot_enrollments e SET status='ACTIVE',activated_at=now(),activated_by=session_user,activation_reference=evidence_reference,updated_at=now()
          FROM public.businesses b,public.channel_connections c WHERE e.id=target_enrollment AND e.status='PENDING_REVIEW'
            AND b.id=e.business_id AND b.status='active' AND c.id=e.connection_id AND c."businessId"=e.business_id
            AND c.provider='whatsapp' AND c.status='active' AND c."verifiedAt" IS NOT NULL
            AND (EXISTS(SELECT 1 FROM public.knowledge_faqs f WHERE f.business_id=e.business_id AND f.published_revision_id IS NOT NULL)
              OR EXISTS(SELECT 1 FROM public.merchant_products p WHERE p.business_id=e.business_id AND p.published_revision_id IS NOT NULL)
              OR EXISTS(SELECT 1 FROM public.knowledge_documents d WHERE d.business_id=e.business_id AND d.published_revision_id IS NOT NULL))
            AND EXISTS(SELECT 1 FROM public.assistant_configurations ac WHERE ac.business_id=e.business_id)
            AND COALESCE((SELECT l.monthly_ai_input_tokens FROM public.business_usage_limits l WHERE l.business_id=e.business_id),default_ai_input)>COALESCE((SELECT sum(u.reserved_amount-u.released_amount) FROM public.usage_reservations u WHERE u.business_id=e.business_id AND u.category='ai_input_tokens' AND u.period_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date),0)
            AND COALESCE((SELECT l.monthly_ai_output_tokens FROM public.business_usage_limits l WHERE l.business_id=e.business_id),default_ai_output)>COALESCE((SELECT sum(u.reserved_amount-u.released_amount) FROM public.usage_reservations u WHERE u.business_id=e.business_id AND u.category='ai_output_tokens' AND u.period_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date),0)
            AND COALESCE((SELECT l.monthly_whatsapp_messages FROM public.business_usage_limits l WHERE l.business_id=e.business_id),default_whatsapp)>COALESCE((SELECT sum(u.reserved_amount-u.released_amount) FROM public.usage_reservations u WHERE u.business_id=e.business_id AND u.category='whatsapp_outbound' AND u.period_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date),0)
            AND COALESCE((SELECT l.ai_tokens_per_request FROM public.business_usage_limits l WHERE l.business_id=e.business_id),default_request_tokens)>0
          RETURNING e.id,e.business_id,e.connection_id,e.status,e.activated_at,e.activated_by,e.activation_reference;
      END $$;

      CREATE OR REPLACE FUNCTION public.kleva_website_widget_update(target_id uuid,new_name text,new_enabled boolean,new_ai_enabled boolean,new_configuration jsonb)
      RETURNS TABLE(id uuid,enabled boolean,ai_enabled boolean,updated_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; widget_row public.website_widgets%ROWTYPE;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner') OR length(btrim(new_name)) NOT BETWEEN 1 AND 80 OR jsonb_typeof(new_configuration)<>'object' THEN RAISE EXCEPTION 'website widget update denied' USING ERRCODE='42501'; END IF;
        SELECT * INTO widget_row FROM public.website_widgets w WHERE w.id=target_id AND w.business_id=tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        IF new_enabled AND NOT EXISTS(SELECT 1 FROM public.website_widget_domains d WHERE d.business_id=tenant_id AND d.widget_id=target_id) THEN RAISE EXCEPTION 'add an authorized domain before enabling the widget' USING ERRCODE='22023'; END IF;
        IF new_ai_enabled AND (NOT new_enabled OR NOT EXISTS(SELECT 1 FROM public.businesses b WHERE b.id=tenant_id AND b.status='active')
          OR NOT EXISTS(SELECT 1 FROM public.assistant_configurations a WHERE a.business_id=tenant_id)
          OR NOT (EXISTS(SELECT 1 FROM public.knowledge_faqs f WHERE f.business_id=tenant_id AND f.published_revision_id IS NOT NULL)
            OR EXISTS(SELECT 1 FROM public.merchant_products p WHERE p.business_id=tenant_id AND p.published_revision_id IS NOT NULL)
            OR EXISTS(SELECT 1 FROM public.knowledge_documents d WHERE d.business_id=tenant_id AND d.published_revision_id IS NOT NULL))) THEN
          RAISE EXCEPTION 'website AI prerequisites are incomplete' USING ERRCODE='22023'; END IF;
        UPDATE public.website_widgets SET name=btrim(new_name),enabled=new_enabled,ai_enabled=new_ai_enabled,configuration=new_configuration,updated_at=now()
          WHERE id=target_id AND business_id=tenant_id RETURNING website_widgets.enabled,website_widgets.ai_enabled,website_widgets.updated_at INTO new_enabled,new_ai_enabled,updated_at;
        UPDATE public.channel_connections c SET status=CASE WHEN new_enabled THEN 'active' ELSE 'inactive' END,"displayName"=btrim(new_name),"updatedAt"=now()
          WHERE c.id=widget_row.channel_connection_id AND c."businessId"=tenant_id;
        RETURN QUERY SELECT target_id,new_enabled,new_ai_enabled,updated_at;
      END $$;

      ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.knowledge_documents FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.knowledge_document_revisions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.knowledge_document_revisions FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.knowledge_document_upload_intents ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.knowledge_document_upload_intents FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.knowledge_document_pages ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.knowledge_document_pages FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_knowledge_documents_internal ON public.knowledge_documents
        USING (current_user::text !~ '^kleva_(merchant|identity)_') WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
      CREATE POLICY kleva_knowledge_document_revisions_internal ON public.knowledge_document_revisions
        USING (current_user::text !~ '^kleva_(merchant|identity)_') WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
      CREATE POLICY kleva_knowledge_upload_intents_internal ON public.knowledge_document_upload_intents
        USING (current_user::text !~ '^kleva_(merchant|identity)_') WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
      CREATE POLICY kleva_knowledge_document_pages_internal ON public.knowledge_document_pages
        USING (current_user::text !~ '^kleva_(merchant|identity)_') WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE FUNCTION public.kleva_knowledge_document_create(target_key uuid,target_revision uuid,target_title text,target_object_key text,target_size integer,target_checksum text)
      RETURNS TABLE(document_id uuid,revision_id uuid,expires_at timestamptz,title text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        existing public.knowledge_document_upload_intents%ROWTYPE; doc uuid:=gen_random_uuid(); rev uuid:=target_revision; expiry timestamptz:=now()+interval '15 minutes';
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') OR target_key IS NULL OR target_revision IS NULL
          OR target_title IS NULL OR length(btrim(target_title)) NOT BETWEEN 1 AND 160 OR target_size IS NULL OR target_size NOT BETWEEN 1 AND 10485760
          OR target_checksum IS NULL OR target_checksum !~ '^[0-9a-f]{64}$' OR target_object_key IS DISTINCT FROM ('private/knowledge/'||tenant_id::text||'/'||target_revision::text||'.pdf') THEN
          RAISE EXCEPTION 'knowledge document create denied' USING ERRCODE='42501';
        END IF;
        SELECT * INTO existing FROM public.knowledge_document_upload_intents i WHERE i.business_id=tenant_id AND i.idempotency_key=target_key;
        IF FOUND THEN
          IF existing.expires_at<=now() THEN RAISE EXCEPTION 'upload intent expired' USING ERRCODE='22023'; END IF;
          IF NOT EXISTS (SELECT 1 FROM public.knowledge_document_revisions x JOIN public.knowledge_documents d
            ON d.business_id=x.business_id AND d.id=x.document_id
            WHERE x.business_id=tenant_id AND x.id=existing.revision_id AND d.title=btrim(target_title)
              AND x.size_bytes=target_size AND x.checksum_sha256=target_checksum) THEN
            RAISE EXCEPTION 'idempotency key is bound to another upload' USING ERRCODE='23505';
          END IF;
          RETURN QUERY SELECT existing.document_id,existing.revision_id,existing.expires_at,d.title::text FROM public.knowledge_documents d
            WHERE d.business_id=tenant_id AND d.id=existing.document_id;
          RETURN;
        END IF;
        INSERT INTO public.knowledge_documents(id,business_id,title) VALUES(doc,tenant_id,btrim(target_title));
        INSERT INTO public.knowledge_document_revisions(id,business_id,document_id,revision,object_key,checksum_sha256,size_bytes)
          VALUES(rev,tenant_id,doc,1,target_object_key,target_checksum,target_size);
        INSERT INTO public.knowledge_document_upload_intents(id,business_id,document_id,revision_id,idempotency_key,expires_at)
          VALUES(rev,tenant_id,doc,rev,target_key,expiry);
        UPDATE public.knowledge_documents SET draft_revision_id=rev WHERE id=doc AND business_id=tenant_id;
        RETURN QUERY SELECT doc,rev,expiry,btrim(target_title);
      END $$;

      CREATE FUNCTION public.kleva_knowledge_document_complete(target_revision uuid,target_version text)
      RETURNS TABLE(document_id uuid,revision_id uuid,status text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; i public.knowledge_document_upload_intents%ROWTYPE; r public.knowledge_document_revisions%ROWTYPE;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') OR target_version IS NULL OR length(target_version) NOT BETWEEN 1 AND 1024 THEN
          RAISE EXCEPTION 'knowledge document completion denied' USING ERRCODE='42501';
        END IF;
        SELECT * INTO i FROM public.knowledge_document_upload_intents WHERE business_id=tenant_id AND revision_id=target_revision FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        SELECT * INTO r FROM public.knowledge_document_revisions WHERE business_id=tenant_id AND id=target_revision FOR UPDATE;
        IF r.status IN ('QUEUED','PROCESSING','DRAFT','PUBLISHED') THEN
          IF r.object_version_id IS DISTINCT FROM target_version THEN RAISE EXCEPTION 'upload version mismatch' USING ERRCODE='22023'; END IF;
          RETURN QUERY SELECT r.document_id,r.id,r.status::text; RETURN;
        END IF;
        IF i.completed_at IS NOT NULL OR i.expired_at IS NOT NULL OR i.expires_at<=now() OR r.status<>'UPLOADING' THEN
          RAISE EXCEPTION 'upload intent expired or completed' USING ERRCODE='22023';
        END IF;
        UPDATE public.knowledge_document_revisions SET status='QUEUED',object_version_id=target_version,updated_at=now() WHERE id=r.id AND business_id=tenant_id;
        UPDATE public.knowledge_document_upload_intents SET completed_at=now() WHERE id=i.id;
        INSERT INTO public.outbox_operations(id,"businessId",operation,metadata)
          VALUES(r.id,tenant_id,'knowledge.document.extract',jsonb_build_object('documentRevisionId',r.id)) ON CONFLICT(id) DO NOTHING;
        IF NOT EXISTS(SELECT 1 FROM public.outbox_operations o WHERE o.id=r.id AND o."businessId"=tenant_id
          AND o.operation='knowledge.document.extract' AND o.metadata=jsonb_build_object('documentRevisionId',r.id)) THEN
          RAISE EXCEPTION 'document outbox intent conflicts with an existing operation' USING ERRCODE='23505';
        END IF;
        RETURN QUERY SELECT r.document_id,r.id,'QUEUED'::text;
      END $$;

      CREATE FUNCTION public.kleva_knowledge_document_upload_info(target_revision uuid)
      RETURNS TABLE(object_key text,checksum_sha256 text,size_bytes integer,expires_at timestamptz,status text)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') THEN RAISE EXCEPTION 'knowledge upload access denied' USING ERRCODE='42501'; END IF;
        RETURN QUERY SELECT r.object_key::text,r.checksum_sha256::text,r.size_bytes,i.expires_at,r.status::text
          FROM public.knowledge_document_revisions r JOIN public.knowledge_document_upload_intents i
            ON i.business_id=r.business_id AND i.revision_id=r.id
          WHERE r.business_id=tenant_id AND r.id=target_revision;
      END $$;

      CREATE FUNCTION public.kleva_knowledge_document_list()
      RETURNS TABLE(id uuid,title text,status text,revision_id uuid,revision_status text,page_count integer,size_bytes integer,preview text,created_at timestamptz,updated_at timestamptz)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') THEN RAISE EXCEPTION 'knowledge document access denied' USING ERRCODE='42501'; END IF;
        RETURN QUERY SELECT d.id,d.title::text,d.status::text,r.id,r.status::text,r.page_count,r.size_bytes,
          (SELECT left(p.content,600) FROM public.knowledge_document_pages p WHERE p.business_id=d.business_id AND p.revision_id=r.id ORDER BY p.page_number LIMIT 1),d.created_at,d.updated_at
          FROM public.knowledge_documents d LEFT JOIN public.knowledge_document_revisions r ON r.id=COALESCE(d.draft_revision_id,d.published_revision_id) AND r.business_id=d.business_id
          WHERE d.business_id=tenant_id ORDER BY d.created_at DESC,d.id DESC LIMIT 100;
      END $$;

      CREATE FUNCTION public.kleva_knowledge_document_publish(target_document uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; rev uuid;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') THEN RAISE EXCEPTION 'knowledge document publish denied' USING ERRCODE='42501'; END IF;
        SELECT draft_revision_id INTO rev FROM public.knowledge_documents WHERE business_id=tenant_id AND id=target_document FOR UPDATE;
        IF NOT FOUND OR rev IS NULL THEN RETURN false; END IF;
        IF NOT EXISTS(SELECT 1 FROM public.knowledge_document_revisions WHERE business_id=tenant_id AND id=rev AND status='DRAFT' AND page_count>0) THEN
          RAISE EXCEPTION 'document is not ready for publication' USING ERRCODE='22023';
        END IF;
        UPDATE public.knowledge_document_revisions SET status='PUBLISHED',updated_at=now() WHERE id=rev AND business_id=tenant_id;
        UPDATE public.knowledge_documents SET status='PUBLISHED',published_revision_id=rev,updated_at=now() WHERE id=target_document AND business_id=tenant_id;
        RETURN true;
      END $$;
      CREATE FUNCTION public.kleva_knowledge_document_unpublish(target_document uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor') THEN RAISE EXCEPTION 'knowledge document publish denied' USING ERRCODE='42501'; END IF;
        UPDATE public.knowledge_documents SET published_revision_id=NULL,status=CASE WHEN draft_revision_id IS NULL THEN 'FAILED' ELSE 'DRAFT' END,updated_at=now()
          WHERE business_id=tenant_id AND id=target_document AND published_revision_id IS NOT NULL;
        UPDATE public.knowledge_document_revisions SET status='DRAFT',updated_at=now() WHERE business_id=tenant_id
          AND id=(SELECT draft_revision_id FROM public.knowledge_documents WHERE business_id=tenant_id AND id=target_document)
          AND status='PUBLISHED';
        RETURN FOUND;
      END $$;

      CREATE FUNCTION public.kleva_knowledge_document_job_read(target_revision uuid)
      RETURNS TABLE(business_id uuid,document_id uuid,revision_id uuid,object_key text,object_version_id text,checksum_sha256 text,size_bytes integer,title text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE r public.knowledge_document_revisions%ROWTYPE;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' THEN RAISE EXCEPTION 'document job access denied' USING ERRCODE='42501'; END IF;
        UPDATE public.knowledge_document_revisions x SET status='PROCESSING',updated_at=now()
          WHERE x.id=target_revision AND x.status='QUEUED' RETURNING x.* INTO r;
        IF NOT FOUND THEN SELECT * INTO r FROM public.knowledge_document_revisions x WHERE x.id=target_revision AND x.status='PROCESSING' FOR UPDATE; END IF;
        IF NOT FOUND THEN RETURN; END IF;
        RETURN QUERY SELECT r.business_id,r.document_id,r.id,r.object_key::text,r.object_version_id::text,r.checksum_sha256::text,r.size_bytes,d.title::text
          FROM public.knowledge_documents d WHERE d.business_id=r.business_id AND d.id=r.document_id;
      END $$;
      CREATE FUNCTION public.kleva_knowledge_uploads_claim_expired(page_size integer)
      RETURNS TABLE(revision_id uuid,object_key text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' OR page_size NOT BETWEEN 1 AND 100 THEN
          RAISE EXCEPTION 'document cleanup denied' USING ERRCODE='42501';
        END IF;
        RETURN QUERY WITH due AS (
          SELECT i.id,i.revision_id,i.business_id FROM public.knowledge_document_upload_intents i
          WHERE i.completed_at IS NULL AND i.expires_at<=now()
          ORDER BY i.expires_at,i.id LIMIT page_size FOR UPDATE SKIP LOCKED
        ), expired AS (
          UPDATE public.knowledge_document_upload_intents i SET expired_at=COALESCE(i.expired_at,now())
          FROM due WHERE i.id=due.id RETURNING i.business_id,i.revision_id
        ), revisions AS (
          UPDATE public.knowledge_document_revisions r SET status=CASE WHEN r.status='UPLOADING' THEN 'EXPIRED' ELSE r.status END,updated_at=now()
          FROM expired e WHERE r.business_id=e.business_id AND r.id=e.revision_id
          RETURNING r.business_id,r.document_id,r.id,r.object_key
        )
        UPDATE public.knowledge_documents d SET status='EXPIRED',updated_at=now()
          FROM revisions r WHERE d.business_id=r.business_id AND d.id=r.document_id
        RETURNING r.id,r.object_key;
      END $$;
      CREATE FUNCTION public.kleva_knowledge_document_pages_save(target_revision uuid,page_texts text[])
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE r public.knowledge_document_revisions%ROWTYPE; inserted_count integer;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' OR COALESCE(cardinality(page_texts),0) NOT BETWEEN 1 AND 100
          OR EXISTS(SELECT 1 FROM unnest(page_texts) p WHERE p IS NULL OR length(p)>50000)
          OR (SELECT COALESCE(sum(length(p)),0) FROM unnest(page_texts) p)>500000 THEN
          RAISE EXCEPTION 'invalid document extraction result' USING ERRCODE='22023';
        END IF;
        SELECT * INTO r FROM public.knowledge_document_revisions WHERE id=target_revision FOR UPDATE;
        IF NOT FOUND OR r.status NOT IN ('QUEUED','PROCESSING') THEN RETURN false; END IF;
        IF EXISTS(SELECT 1 FROM unnest(page_texts) p WHERE length(btrim(p))<10) THEN
          RAISE EXCEPTION 'document contains pages without extractable text' USING ERRCODE='22023';
        END IF;
        DELETE FROM public.knowledge_document_pages WHERE business_id=r.business_id AND revision_id=r.id;
        INSERT INTO public.knowledge_document_pages(business_id,document_id,revision_id,page_number,content)
          SELECT r.business_id,r.document_id,r.id,n,p FROM unnest(page_texts) WITH ORDINALITY x(p,n);
        GET DIAGNOSTICS inserted_count=ROW_COUNT;
        UPDATE public.knowledge_document_revisions SET status='DRAFT',page_count=inserted_count,error_code=NULL,updated_at=now()
          WHERE id=r.id AND business_id=r.business_id;
        UPDATE public.knowledge_documents SET status='DRAFT',draft_revision_id=r.id,updated_at=now() WHERE id=r.document_id AND business_id=r.business_id;
        RETURN true;
      END $$;
      CREATE FUNCTION public.kleva_knowledge_document_job_fail(target_revision uuid,failure_code text,terminal boolean)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE r public.knowledge_document_revisions%ROWTYPE;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' OR failure_code NOT IN ('INVALID_PDF','ENCRYPTED_PDF','NO_EXTRACTABLE_TEXT','EXTRACTION_LIMIT','OBJECT_UNAVAILABLE','CHECKSUM_MISMATCH','PROCESSING_FAILED') THEN
          RAISE EXCEPTION 'document job failure update denied' USING ERRCODE='42501';
        END IF;
        SELECT * INTO r FROM public.knowledge_document_revisions WHERE id=target_revision FOR UPDATE;
        IF NOT FOUND THEN RETURN false; END IF;
        UPDATE public.knowledge_document_revisions SET status=CASE WHEN terminal THEN 'FAILED' ELSE 'QUEUED' END,error_code=failure_code,updated_at=now() WHERE id=r.id;
        IF terminal THEN UPDATE public.knowledge_documents SET status='FAILED',updated_at=now() WHERE id=r.document_id AND business_id=r.business_id; END IF;
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_search_published_documents(target_business_id uuid,target_query text,target_limit integer)
      RETURNS TABLE(source_type text,source_id uuid,revision_id uuid,relevance_score real,title text,content text,page_number integer,has_published_content boolean)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      BEGIN
        IF session_user::text ~ '^kleva_(merchant|identity)_' THEN RAISE EXCEPTION 'document retrieval denied' USING ERRCODE='42501'; END IF;
        IF target_business_id IS NULL OR target_query IS NULL OR length(target_query)>256 OR target_limit IS NULL OR target_limit NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid document search request' USING ERRCODE='22023'; END IF;
        RETURN QUERY WITH q AS (SELECT websearch_to_tsquery('pg_catalog.simple'::regconfig,btrim(target_query)) query),
        matches AS (SELECT 'DOCUMENT'::text source_type,d.id source_id,r.id revision_id,
          ts_rank_cd(p.search_vector,q.query,32)::real relevance_score,d.title::text title,p.content::text content,p.page_number
          FROM public.knowledge_documents d JOIN public.knowledge_document_revisions r ON r.business_id=d.business_id AND r.id=d.published_revision_id
          JOIN public.knowledge_document_pages p ON p.business_id=r.business_id AND p.revision_id=r.id CROSS JOIN q
          JOIN public.businesses b ON b.id=d.business_id AND b.status='active'
          WHERE d.business_id=target_business_id AND d.published_revision_id IS NOT NULL AND p.search_vector @@ q.query),
        ranked AS (SELECT m.*,row_number() OVER(ORDER BY m.relevance_score DESC,m.source_id,m.page_number) pos FROM matches m),
        available AS (SELECT EXISTS(SELECT 1 FROM public.knowledge_documents d JOIN public.businesses b ON b.id=d.business_id AND b.status='active'
          WHERE d.business_id=target_business_id AND d.published_revision_id IS NOT NULL) AS has_content)
        SELECT 'DOCUMENT'::text,ranked.source_id,ranked.revision_id,ranked.relevance_score,ranked.title,ranked.content,ranked.page_number,available.has_content
        FROM available LEFT JOIN ranked ON ranked.pos<=target_limit ORDER BY ranked.pos NULLS LAST;
      END $$;

      REVOKE ALL ON FUNCTION public.kleva_knowledge_document_create(uuid,uuid,text,text,integer,text),
        public.kleva_knowledge_document_complete(uuid,text),public.kleva_knowledge_document_upload_info(uuid),public.kleva_knowledge_document_list(),
        public.kleva_knowledge_document_publish(uuid),public.kleva_knowledge_document_unpublish(uuid),
        public.kleva_knowledge_document_job_read(uuid),public.kleva_knowledge_document_pages_save(uuid,text[]),
        public.kleva_knowledge_document_job_fail(uuid,text,boolean),public.kleva_knowledge_uploads_claim_expired(integer),
        public.kleva_search_published_documents(uuid,text,integer) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_merchant_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_knowledge_document_create(uuid,uuid,text,text,integer,text), public.kleva_knowledge_document_complete(uuid,text), public.kleva_knowledge_document_upload_info(uuid), public.kleva_knowledge_document_list(), public.kleva_knowledge_document_publish(uuid), public.kleva_knowledge_document_unpublish(uuid) TO %I',role_name);
        END LOOP;
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_knowledge_document_job_read(uuid), public.kleva_knowledge_document_pages_save(uuid,text[]), public.kleva_knowledge_document_job_fail(uuid,text,boolean), public.kleva_knowledge_uploads_claim_expired(integer), public.kleva_search_published_documents(uuid,text,integer) TO %I',role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(r: QueryRunner): Promise<void> {
    const [row] = (await r.query(
      'SELECT count(*)::bigint AS count FROM public.knowledge_documents',
    )) as { count: string }[];
    if (Number(row?.count ?? 0) > 0)
      throw new Error(
        'Knowledge document data exists; preserve the migration.',
      );
    await r.query(`
      DROP FUNCTION public.kleva_search_published_documents(uuid,text,integer);
      DROP FUNCTION public.kleva_knowledge_document_job_fail(uuid,text,boolean);
      DROP FUNCTION public.kleva_knowledge_document_pages_save(uuid,text[]);
      DROP FUNCTION public.kleva_knowledge_document_job_read(uuid);
      DROP FUNCTION public.kleva_knowledge_uploads_claim_expired(integer);
      DROP FUNCTION public.kleva_knowledge_document_unpublish(uuid);
      DROP FUNCTION public.kleva_knowledge_document_publish(uuid);
      DROP FUNCTION public.kleva_knowledge_document_list();
      DROP FUNCTION public.kleva_knowledge_document_complete(uuid,text);
      DROP FUNCTION public.kleva_knowledge_document_upload_info(uuid);
      DROP FUNCTION public.kleva_knowledge_document_create(uuid,uuid,text,text,integer,text);
      DROP TABLE public.knowledge_document_pages;
      ALTER TABLE public.knowledge_documents DROP CONSTRAINT fk_knowledge_documents_published_revision;
      ALTER TABLE public.knowledge_documents DROP CONSTRAINT fk_knowledge_documents_draft_revision;
      DROP TABLE public.knowledge_document_upload_intents;
      DROP TABLE public.knowledge_document_revisions;
      DROP TABLE public.knowledge_documents;

      CREATE OR REPLACE FUNCTION public.kleva_pilot_readiness()
      RETURNS TABLE(business_active boolean,connection_id uuid,whatsapp_verified boolean,published_knowledge boolean,
        assistant_configured boolean,pilot_approved boolean,approval_matches_connection boolean,human_takeover_count bigint)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner','editor','agent') THEN RAISE EXCEPTION 'pilot status access denied' USING ERRCODE='42501'; END IF;
        RETURN QUERY WITH connection AS (
          SELECT c.id,c.status,c."verifiedAt" FROM public.channel_connections c WHERE c."businessId"=tenant_id AND c.provider='whatsapp' ORDER BY c."updatedAt" DESC LIMIT 1
        ), enrollment AS (
          SELECT e.status,e.connection_id FROM public.business_pilot_enrollments e WHERE e.business_id=tenant_id AND e.status IN ('PENDING_REVIEW','ACTIVE') ORDER BY e.created_at DESC LIMIT 1
        ) SELECT b.status='active',c.id,COALESCE(c.status='active' AND c."verifiedAt" IS NOT NULL,false),
          EXISTS(SELECT 1 FROM public.knowledge_faqs f WHERE f.business_id=tenant_id AND f.published_revision_id IS NOT NULL)
          OR EXISTS(SELECT 1 FROM public.merchant_products p WHERE p.business_id=tenant_id AND p.published_revision_id IS NOT NULL),
          EXISTS(SELECT 1 FROM public.assistant_configurations ac WHERE ac.business_id=tenant_id),COALESCE(e.status='ACTIVE',false),
          COALESCE(e.status='ACTIVE' AND e.connection_id=c.id,false),
          (SELECT count(*) FROM public.conversations v WHERE v."businessId"=tenant_id AND v.control_mode='HUMAN' AND lower(COALESCE(v.status,'open')) NOT IN ('closed','resolved'))
        FROM public.businesses b CROSS JOIN (SELECT 1) seed LEFT JOIN connection c ON true LEFT JOIN enrollment e ON true WHERE b.id=tenant_id;
      END $$;

      CREATE OR REPLACE FUNCTION public.kleva_pilot_activate(target_enrollment uuid,evidence_reference text,
        default_ai_input integer,default_ai_output integer,default_whatsapp integer,default_request_tokens integer)
      RETURNS TABLE(enrollment_id uuid,business_id uuid,connection_id uuid,status varchar,activated_at timestamptz,activated_by text,activation_reference text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      BEGIN
        IF session_user !~ '^kleva_pilot_operator_[a-z0-9_]{1,40}$' THEN RAISE EXCEPTION 'pilot operator role required' USING ERRCODE='42501'; END IF;
        IF evidence_reference IS NULL OR evidence_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{5,199}$' THEN RAISE EXCEPTION 'valid approval evidence reference required' USING ERRCODE='22023'; END IF;
        IF default_ai_input<1 OR default_ai_output<1 OR default_whatsapp<1 OR default_request_tokens<1 THEN RAISE EXCEPTION 'positive usage limits are required' USING ERRCODE='22023'; END IF;
        RETURN QUERY UPDATE public.business_pilot_enrollments e SET status='ACTIVE',activated_at=now(),activated_by=session_user,activation_reference=evidence_reference,updated_at=now()
          FROM public.businesses b,public.channel_connections c WHERE e.id=target_enrollment AND e.status='PENDING_REVIEW'
            AND b.id=e.business_id AND b.status='active' AND c.id=e.connection_id AND c."businessId"=e.business_id
            AND c.provider='whatsapp' AND c.status='active' AND c."verifiedAt" IS NOT NULL
            AND (EXISTS(SELECT 1 FROM public.knowledge_faqs f WHERE f.business_id=e.business_id AND f.published_revision_id IS NOT NULL)
              OR EXISTS(SELECT 1 FROM public.merchant_products p WHERE p.business_id=e.business_id AND p.published_revision_id IS NOT NULL))
            AND EXISTS(SELECT 1 FROM public.assistant_configurations ac WHERE ac.business_id=e.business_id)
            AND COALESCE((SELECT l.monthly_ai_input_tokens FROM public.business_usage_limits l WHERE l.business_id=e.business_id),default_ai_input)>COALESCE((SELECT sum(u.reserved_amount-u.released_amount) FROM public.usage_reservations u WHERE u.business_id=e.business_id AND u.category='ai_input_tokens' AND u.period_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date),0)
            AND COALESCE((SELECT l.monthly_ai_output_tokens FROM public.business_usage_limits l WHERE l.business_id=e.business_id),default_ai_output)>COALESCE((SELECT sum(u.reserved_amount-u.released_amount) FROM public.usage_reservations u WHERE u.business_id=e.business_id AND u.category='ai_output_tokens' AND u.period_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date),0)
            AND COALESCE((SELECT l.monthly_whatsapp_messages FROM public.business_usage_limits l WHERE l.business_id=e.business_id),default_whatsapp)>COALESCE((SELECT sum(u.reserved_amount-u.released_amount) FROM public.usage_reservations u WHERE u.business_id=e.business_id AND u.category='whatsapp_outbound' AND u.period_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date),0)
            AND COALESCE((SELECT l.ai_tokens_per_request FROM public.business_usage_limits l WHERE l.business_id=e.business_id),default_request_tokens)>0
          RETURNING e.id,e.business_id,e.connection_id,e.status,e.activated_at,e.activated_by,e.activation_reference;
      END $$;

      CREATE OR REPLACE FUNCTION public.kleva_website_widget_update(target_id uuid,new_name text,new_enabled boolean,new_ai_enabled boolean,new_configuration jsonb)
      RETURNS TABLE(id uuid,enabled boolean,ai_enabled boolean,updated_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; widget_row public.website_widgets%ROWTYPE;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner') OR length(btrim(new_name)) NOT BETWEEN 1 AND 80 OR jsonb_typeof(new_configuration)<>'object' THEN RAISE EXCEPTION 'website widget update denied' USING ERRCODE='42501'; END IF;
        SELECT * INTO widget_row FROM public.website_widgets w WHERE w.id=target_id AND w.business_id=tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        IF new_enabled AND NOT EXISTS(SELECT 1 FROM public.website_widget_domains d WHERE d.business_id=tenant_id AND d.widget_id=target_id) THEN RAISE EXCEPTION 'add an authorized domain before enabling the widget' USING ERRCODE='22023'; END IF;
        IF new_ai_enabled AND (NOT new_enabled OR NOT EXISTS(SELECT 1 FROM public.businesses b WHERE b.id=tenant_id AND b.status='active')
          OR NOT EXISTS(SELECT 1 FROM public.assistant_configurations a WHERE a.business_id=tenant_id)
          OR NOT (EXISTS(SELECT 1 FROM public.knowledge_faqs f WHERE f.business_id=tenant_id AND f.published_revision_id IS NOT NULL)
            OR EXISTS(SELECT 1 FROM public.merchant_products p WHERE p.business_id=tenant_id AND p.published_revision_id IS NOT NULL))) THEN
          RAISE EXCEPTION 'website AI prerequisites are incomplete' USING ERRCODE='22023'; END IF;
        UPDATE public.website_widgets SET name=btrim(new_name),enabled=new_enabled,ai_enabled=new_ai_enabled,configuration=new_configuration,updated_at=now()
          WHERE id=target_id AND business_id=tenant_id RETURNING website_widgets.enabled,website_widgets.ai_enabled,website_widgets.updated_at INTO new_enabled,new_ai_enabled,updated_at;
        UPDATE public.channel_connections c SET status=CASE WHEN new_enabled THEN 'active' ELSE 'inactive' END,"displayName"=btrim(new_name),"updatedAt"=now()
          WHERE c.id=widget_row.channel_connection_id AND c."businessId"=tenant_id;
        RETURN QUERY SELECT target_id,new_enabled,new_ai_enabled,updated_at;
      END $$;
    `);
  }
}
