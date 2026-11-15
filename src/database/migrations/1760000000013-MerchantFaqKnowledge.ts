import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MerchantFaqKnowledge1760000000013 implements MigrationInterface {
  name = 'MerchantFaqKnowledge1760000000013';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE public.knowledge_faqs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        creation_key uuid NOT NULL,
        creation_fingerprint text NOT NULL,
        created_by uuid,
        updated_by uuid,
        draft_revision_id uuid,
        published_revision_id uuid,
        published_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_knowledge_faq_creation" UNIQUE (business_id, creation_key),
        CONSTRAINT "UQ_knowledge_faq_business_id" UNIQUE (business_id, id),
        CONSTRAINT "FK_knowledge_faq_business" FOREIGN KEY (business_id)
          REFERENCES public.businesses(id) ON DELETE RESTRICT,
        CONSTRAINT "FK_knowledge_faq_created_by" FOREIGN KEY (created_by)
          REFERENCES public.accounts(id) ON DELETE SET NULL,
        CONSTRAINT "FK_knowledge_faq_updated_by" FOREIGN KEY (updated_by)
          REFERENCES public.accounts(id) ON DELETE SET NULL
      );
      CREATE TABLE public.knowledge_faq_revisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        faq_id uuid NOT NULL,
        revision integer NOT NULL CHECK (revision > 0),
        question varchar(500) NOT NULL CHECK (length(btrim(question)) BETWEEN 1 AND 500),
        answer varchar(5000) NOT NULL CHECK (length(btrim(answer)) BETWEEN 1 AND 5000),
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_knowledge_faq_revision" UNIQUE (faq_id, revision),
        CONSTRAINT "UQ_knowledge_faq_revision_scope" UNIQUE (id, business_id, faq_id),
        CONSTRAINT "FK_knowledge_revision_faq" FOREIGN KEY (business_id, faq_id)
          REFERENCES public.knowledge_faqs(business_id, id) ON DELETE RESTRICT,
        CONSTRAINT "FK_knowledge_revision_actor" FOREIGN KEY (created_by)
          REFERENCES public.accounts(id) ON DELETE SET NULL
      );
      ALTER TABLE public.knowledge_faqs
        ADD CONSTRAINT "FK_knowledge_faq_draft_revision" FOREIGN KEY (draft_revision_id, business_id, id)
          REFERENCES public.knowledge_faq_revisions(id, business_id, faq_id) DEFERRABLE INITIALLY DEFERRED,
        ADD CONSTRAINT "FK_knowledge_faq_published_revision" FOREIGN KEY (published_revision_id, business_id, id)
          REFERENCES public.knowledge_faq_revisions(id, business_id, faq_id) DEFERRABLE INITIALLY DEFERRED;
      CREATE INDEX "IDX_knowledge_faq_business_updated"
        ON public.knowledge_faqs(business_id, updated_at DESC, id DESC);
      CREATE INDEX "IDX_knowledge_faq_published"
        ON public.knowledge_faqs(business_id, published_at DESC, id)
        WHERE published_revision_id IS NOT NULL;
      CREATE TABLE public.knowledge_faq_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        faq_id uuid NOT NULL,
        revision_id uuid,
        event_type varchar(16) NOT NULL CHECK (event_type IN ('CREATED','EDITED','PUBLISHED','UNPUBLISHED')),
        actor_account_id uuid,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (business_id, faq_id) REFERENCES public.knowledge_faqs(business_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (revision_id, business_id, faq_id)
          REFERENCES public.knowledge_faq_revisions(id, business_id, faq_id) ON DELETE RESTRICT,
        FOREIGN KEY (actor_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL
      );
      CREATE INDEX "IDX_knowledge_faq_event_history"
        ON public.knowledge_faq_events(business_id, faq_id, occurred_at DESC, id);

      ALTER TABLE public.knowledge_faqs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.knowledge_faqs FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_knowledge_faq_internal ON public.knowledge_faqs
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
      ALTER TABLE public.knowledge_faq_revisions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.knowledge_faq_revisions FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_knowledge_revision_internal ON public.knowledge_faq_revisions
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
      ALTER TABLE public.knowledge_faq_events ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.knowledge_faq_events FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_knowledge_event_internal ON public.knowledge_faq_events
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE FUNCTION public.kleva_faq_list()
      RETURNS TABLE (id uuid, status text, revision integer, published_revision integer,
        has_unpublished_changes boolean, question text, answer text, published_at timestamptz,
        created_at timestamptz, updated_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT f.id, CASE WHEN f.published_revision_id IS NULL THEN 'DRAFT' ELSE 'PUBLISHED' END,
          draft.revision,
          published.revision,
          f.published_revision_id IS NOT NULL AND f.draft_revision_id <> f.published_revision_id,
          draft.question::text, draft.answer::text, f.published_at, f.created_at, f.updated_at
        FROM public.knowledge_faqs f
        JOIN public.knowledge_faq_revisions draft ON draft.id = f.draft_revision_id
          AND draft.business_id = f.business_id AND draft.faq_id = f.id
        LEFT JOIN public.knowledge_faq_revisions published ON published.id = f.published_revision_id
          AND published.business_id = f.business_id AND published.faq_id = f.id
        WHERE f.business_id = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND public.kleva_current_role() IN ('owner','editor')
        ORDER BY f.updated_at DESC, f.id DESC
      $$;

      CREATE FUNCTION public.kleva_faq_detail(target_id uuid)
      RETURNS TABLE (id uuid, status text, revision integer, published_revision integer,
        has_unpublished_changes boolean, question text, answer text, published_at timestamptz,
        created_at timestamptz, updated_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT f.id, CASE WHEN f.published_revision_id IS NULL THEN 'DRAFT' ELSE 'PUBLISHED' END,
          draft.revision,
          published.revision,
          f.published_revision_id IS NOT NULL AND f.draft_revision_id <> f.published_revision_id,
          draft.question::text, draft.answer::text, f.published_at, f.created_at, f.updated_at
        FROM public.knowledge_faqs f
        JOIN public.knowledge_faq_revisions draft ON draft.id = f.draft_revision_id
          AND draft.business_id = f.business_id AND draft.faq_id = f.id
        LEFT JOIN public.knowledge_faq_revisions published ON published.id = f.published_revision_id
          AND published.business_id = f.business_id AND published.faq_id = f.id
        WHERE f.id = target_id AND f.business_id = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND public.kleva_current_role() IN ('owner','editor')
      $$;

      CREATE FUNCTION public.kleva_faq_create(request_key uuid, faq_question text, faq_answer text)
      RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        actor_id uuid := public.kleva_current_account(); faq_id uuid; revision_id uuid;
        fingerprint text := md5(jsonb_build_array(btrim(faq_question), btrim(faq_answer))::text);
        existing_fingerprint text;
      BEGIN
        IF COALESCE(public.kleva_current_role(), '') NOT IN ('owner','editor') OR actor_id IS NULL THEN
          RAISE EXCEPTION 'knowledge access denied' USING ERRCODE = '42501';
        END IF;
        IF request_key IS NULL OR faq_question IS NULL OR faq_answer IS NULL
          OR length(btrim(faq_question)) NOT BETWEEN 1 AND 500
          OR length(btrim(faq_answer)) NOT BETWEEN 1 AND 5000 THEN
          RAISE EXCEPTION 'invalid FAQ content' USING ERRCODE = '22023';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended('faq-create:' || tenant_id::text || ':' || request_key::text, 0));
        SELECT id, creation_fingerprint INTO faq_id, existing_fingerprint FROM public.knowledge_faqs
          WHERE business_id = tenant_id AND creation_key = request_key;
        IF FOUND THEN
          IF existing_fingerprint <> fingerprint THEN
            RAISE EXCEPTION 'FAQ idempotency key conflict' USING ERRCODE = '23505', CONSTRAINT = 'UQ_knowledge_faq_creation';
          END IF;
          RETURN faq_id;
        END IF;
        INSERT INTO public.knowledge_faqs(business_id, creation_key, creation_fingerprint, created_by, updated_by)
          VALUES (tenant_id, request_key, fingerprint, actor_id, actor_id) RETURNING id INTO faq_id;
        INSERT INTO public.knowledge_faq_revisions(business_id, faq_id, revision, question, answer, created_by)
          VALUES (tenant_id, faq_id, 1, btrim(faq_question), btrim(faq_answer), actor_id) RETURNING id INTO revision_id;
        UPDATE public.knowledge_faqs SET draft_revision_id = revision_id WHERE id = faq_id AND business_id = tenant_id;
        INSERT INTO public.knowledge_faq_events(business_id, faq_id, revision_id, event_type, actor_account_id)
          VALUES (tenant_id, faq_id, revision_id, 'CREATED', actor_id);
        RETURN faq_id;
      END $$;

      CREATE FUNCTION public.kleva_faq_edit(target_id uuid, expected_revision integer, faq_question text, faq_answer text)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        actor_id uuid := public.kleva_current_account(); faq_row public.knowledge_faqs%ROWTYPE;
        current_revision public.knowledge_faq_revisions%ROWTYPE; next_revision_id uuid;
      BEGIN
        IF COALESCE(public.kleva_current_role(), '') NOT IN ('owner','editor') OR actor_id IS NULL THEN
          RAISE EXCEPTION 'knowledge access denied' USING ERRCODE = '42501';
        END IF;
        IF faq_question IS NULL OR faq_answer IS NULL
          OR length(btrim(faq_question)) NOT BETWEEN 1 AND 500
          OR length(btrim(faq_answer)) NOT BETWEEN 1 AND 5000 THEN
          RAISE EXCEPTION 'invalid FAQ content' USING ERRCODE = '22023';
        END IF;
        SELECT * INTO faq_row FROM public.knowledge_faqs f
          WHERE f.id = target_id AND f.business_id = tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN NULL; END IF;
        SELECT * INTO current_revision FROM public.knowledge_faq_revisions r
          WHERE r.id = faq_row.draft_revision_id AND r.business_id = tenant_id AND r.faq_id = target_id;
        IF current_revision.revision <> expected_revision THEN
          RAISE EXCEPTION 'FAQ revision conflict' USING ERRCODE = '40001';
        END IF;
        IF current_revision.question = btrim(faq_question) AND current_revision.answer = btrim(faq_answer) THEN
          RETURN false;
        END IF;
        INSERT INTO public.knowledge_faq_revisions(business_id, faq_id, revision, question, answer, created_by)
          VALUES (tenant_id, target_id, current_revision.revision + 1, btrim(faq_question), btrim(faq_answer), actor_id)
          RETURNING id INTO next_revision_id;
        UPDATE public.knowledge_faqs SET draft_revision_id = next_revision_id, updated_by = actor_id, updated_at = now()
          WHERE id = target_id AND business_id = tenant_id;
        INSERT INTO public.knowledge_faq_events(business_id, faq_id, revision_id, event_type, actor_account_id)
          VALUES (tenant_id, target_id, next_revision_id, 'EDITED', actor_id);
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_faq_publish(target_id uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        actor_id uuid := public.kleva_current_account(); faq_row public.knowledge_faqs%ROWTYPE;
      BEGIN
        IF COALESCE(public.kleva_current_role(), '') NOT IN ('owner','editor') OR actor_id IS NULL THEN
          RAISE EXCEPTION 'knowledge access denied' USING ERRCODE = '42501';
        END IF;
        SELECT * INTO faq_row FROM public.knowledge_faqs f
          WHERE f.id = target_id AND f.business_id = tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN NULL; END IF;
        IF faq_row.draft_revision_id = faq_row.published_revision_id THEN RETURN false; END IF;
        UPDATE public.knowledge_faqs SET published_revision_id = draft_revision_id,
          published_at = now(), updated_by = actor_id, updated_at = now()
          WHERE id = target_id AND business_id = tenant_id;
        INSERT INTO public.knowledge_faq_events(business_id, faq_id, revision_id, event_type, actor_account_id)
          VALUES (tenant_id, target_id, faq_row.draft_revision_id, 'PUBLISHED', actor_id);
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_faq_unpublish(target_id uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        actor_id uuid := public.kleva_current_account(); faq_row public.knowledge_faqs%ROWTYPE;
      BEGIN
        IF COALESCE(public.kleva_current_role(), '') NOT IN ('owner','editor') OR actor_id IS NULL THEN
          RAISE EXCEPTION 'knowledge access denied' USING ERRCODE = '42501';
        END IF;
        SELECT * INTO faq_row FROM public.knowledge_faqs f
          WHERE f.id = target_id AND f.business_id = tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN NULL; END IF;
        IF faq_row.published_revision_id IS NULL THEN RETURN false; END IF;
        UPDATE public.knowledge_faqs SET published_revision_id = NULL,
          updated_by = actor_id, updated_at = now()
          WHERE id = target_id AND business_id = tenant_id;
        INSERT INTO public.knowledge_faq_events(business_id, faq_id, revision_id, event_type, actor_account_id)
          VALUES (tenant_id, target_id, faq_row.published_revision_id, 'UNPUBLISHED', actor_id);
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_published_faqs(target_business_id uuid)
      RETURNS TABLE (business_id uuid, faq_id uuid, published_revision_id uuid,
        question text, answer text, published_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT f.business_id, f.id, revision.id, revision.question::text, revision.answer::text, f.published_at
        FROM public.knowledge_faqs f
        JOIN public.knowledge_faq_revisions revision ON revision.id = f.published_revision_id
          AND revision.business_id = f.business_id AND revision.faq_id = f.id
        JOIN public.businesses b ON b.id = f.business_id AND b.status = 'active'
        WHERE f.business_id = target_business_id AND f.published_revision_id IS NOT NULL
          AND session_user::text !~ '^kleva_(merchant|identity)_'
        ORDER BY f.published_at DESC, f.id
      $$;
      REVOKE ALL ON FUNCTION public.kleva_faq_list(), public.kleva_faq_detail(uuid),
        public.kleva_faq_create(uuid,text,text), public.kleva_faq_edit(uuid,integer,text,text),
        public.kleva_faq_publish(uuid), public.kleva_faq_unpublish(uuid), public.kleva_published_faqs(uuid) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_published_faqs(uuid) TO %I', role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM public.knowledge_faq_events)
          OR EXISTS (SELECT 1 FROM public.knowledge_faq_revisions)
          OR EXISTS (SELECT 1 FROM public.knowledge_faqs) THEN
          RAISE EXCEPTION 'FAQ knowledge history exists; preserve the schema for rollback.';
        END IF;
      END $$;
      DROP FUNCTION public.kleva_published_faqs(uuid);
      DROP FUNCTION public.kleva_faq_unpublish(uuid);
      DROP FUNCTION public.kleva_faq_publish(uuid);
      DROP FUNCTION public.kleva_faq_edit(uuid,integer,text,text);
      DROP FUNCTION public.kleva_faq_create(uuid,text,text);
      DROP FUNCTION public.kleva_faq_detail(uuid);
      DROP FUNCTION public.kleva_faq_list();
      DROP TABLE public.knowledge_faq_events;
      ALTER TABLE public.knowledge_faqs DROP CONSTRAINT "FK_knowledge_faq_draft_revision",
        DROP CONSTRAINT "FK_knowledge_faq_published_revision";
      DROP TABLE public.knowledge_faq_revisions;
      DROP TABLE public.knowledge_faqs;
    `);
  }
}
