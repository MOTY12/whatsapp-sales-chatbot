import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MerchantProductCatalog1760000000014 implements MigrationInterface {
  name = 'MerchantProductCatalog1760000000014';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE public.merchant_products (
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
        CONSTRAINT "UQ_merchant_product_creation" UNIQUE (business_id, creation_key),
        CONSTRAINT "UQ_merchant_product_business_id" UNIQUE (business_id, id),
        CONSTRAINT "FK_merchant_product_business" FOREIGN KEY (business_id)
          REFERENCES public.businesses(id) ON DELETE RESTRICT,
        CONSTRAINT "FK_merchant_product_created_by" FOREIGN KEY (created_by)
          REFERENCES public.accounts(id) ON DELETE SET NULL,
        CONSTRAINT "FK_merchant_product_updated_by" FOREIGN KEY (updated_by)
          REFERENCES public.accounts(id) ON DELETE SET NULL
      );
      CREATE TABLE public.merchant_product_revisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        product_id uuid NOT NULL,
        revision integer NOT NULL CHECK (revision > 0),
        name varchar(160) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
        description varchar(4000) NOT NULL CHECK (length(description) <= 4000),
        sku varchar(100),
        price numeric(14,2) CHECK (price IS NULL OR price >= 0),
        currency char(3) NOT NULL DEFAULT 'NGN' CHECK (currency ~ '^[A-Z]{3}$'),
        availability varchar(16) NOT NULL DEFAULT 'UNKNOWN'
          CHECK (availability IN ('IN_STOCK','OUT_OF_STOCK','UNKNOWN')),
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_merchant_product_revision" UNIQUE (product_id, revision),
        CONSTRAINT "UQ_merchant_product_revision_scope" UNIQUE (id, business_id, product_id),
        CONSTRAINT "FK_merchant_product_revision_product" FOREIGN KEY (business_id, product_id)
          REFERENCES public.merchant_products(business_id, id) ON DELETE RESTRICT,
        CONSTRAINT "FK_merchant_product_revision_actor" FOREIGN KEY (created_by)
          REFERENCES public.accounts(id) ON DELETE SET NULL
      );
      ALTER TABLE public.merchant_products
        ADD CONSTRAINT "FK_merchant_product_draft_revision" FOREIGN KEY (draft_revision_id, business_id, id)
          REFERENCES public.merchant_product_revisions(id, business_id, product_id) DEFERRABLE INITIALLY DEFERRED,
        ADD CONSTRAINT "FK_merchant_product_published_revision" FOREIGN KEY (published_revision_id, business_id, id)
          REFERENCES public.merchant_product_revisions(id, business_id, product_id) DEFERRABLE INITIALLY DEFERRED;
      CREATE INDEX "IDX_merchant_products_business_updated"
        ON public.merchant_products(business_id, updated_at DESC, id DESC);
      CREATE INDEX "IDX_merchant_products_published"
        ON public.merchant_products(business_id, published_at DESC, id)
        WHERE published_revision_id IS NOT NULL;
      CREATE TABLE public.merchant_product_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        product_id uuid NOT NULL,
        revision_id uuid,
        event_type varchar(16) NOT NULL CHECK (event_type IN ('CREATED','EDITED','PUBLISHED','UNPUBLISHED')),
        actor_account_id uuid,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (business_id, product_id) REFERENCES public.merchant_products(business_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (revision_id, business_id, product_id)
          REFERENCES public.merchant_product_revisions(id, business_id, product_id) ON DELETE RESTRICT,
        FOREIGN KEY (actor_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL
      );
      CREATE INDEX "IDX_merchant_product_event_history"
        ON public.merchant_product_events(business_id, product_id, occurred_at DESC, id);

      ALTER TABLE public.merchant_products ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.merchant_products FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_merchant_product_internal ON public.merchant_products
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
      ALTER TABLE public.merchant_product_revisions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.merchant_product_revisions FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_merchant_product_revision_internal ON public.merchant_product_revisions
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
      ALTER TABLE public.merchant_product_events ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.merchant_product_events FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_merchant_product_event_internal ON public.merchant_product_events
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE FUNCTION public.kleva_product_list(target_limit integer, target_offset integer)
      RETURNS TABLE (id uuid, status text, revision integer, published_revision integer,
        has_unpublished_changes boolean, name text, description text, sku text,
        price numeric, currency text, availability text, published_at timestamptz,
        created_at timestamptz, updated_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
      BEGIN
        IF COALESCE(public.kleva_current_role(), '') NOT IN ('owner','editor') THEN
          RAISE EXCEPTION 'catalog access denied' USING ERRCODE = '42501';
        END IF;
        IF target_limit < 1 OR target_limit > 100 OR target_offset < 0 OR target_offset > 10000 THEN
          RAISE EXCEPTION 'invalid product page' USING ERRCODE = '22023';
        END IF;
        RETURN QUERY SELECT p.id,
          CASE WHEN p.published_revision_id IS NULL THEN 'DRAFT' ELSE 'PUBLISHED' END,
          draft.revision, published.revision,
          p.published_revision_id IS NOT NULL AND p.draft_revision_id IS DISTINCT FROM p.published_revision_id,
          draft.name::text, draft.description::text, draft.sku::text, draft.price,
          draft.currency::text, draft.availability::text, p.published_at, p.created_at, p.updated_at
        FROM public.merchant_products p
        JOIN public.merchant_product_revisions draft ON draft.id = p.draft_revision_id
          AND draft.business_id = p.business_id AND draft.product_id = p.id
        LEFT JOIN public.merchant_product_revisions published ON published.id = p.published_revision_id
          AND published.business_id = p.business_id AND published.product_id = p.id
        WHERE p.business_id = tenant_id
        ORDER BY p.updated_at DESC, p.id DESC
        LIMIT target_limit OFFSET target_offset;
      END $$;

      CREATE FUNCTION public.kleva_product_detail(target_id uuid)
      RETURNS TABLE (id uuid, status text, revision integer, published_revision integer,
        has_unpublished_changes boolean, name text, description text, sku text,
        price numeric, currency text, availability text, published_at timestamptz,
        created_at timestamptz, updated_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
      BEGIN
        IF COALESCE(public.kleva_current_role(), '') NOT IN ('owner','editor') THEN
          RAISE EXCEPTION 'catalog access denied' USING ERRCODE = '42501';
        END IF;
        RETURN QUERY SELECT p.id,
          CASE WHEN p.published_revision_id IS NULL THEN 'DRAFT' ELSE 'PUBLISHED' END,
          draft.revision, published.revision,
          p.published_revision_id IS NOT NULL AND p.draft_revision_id IS DISTINCT FROM p.published_revision_id,
          draft.name::text, draft.description::text, draft.sku::text, draft.price,
          draft.currency::text, draft.availability::text, p.published_at, p.created_at, p.updated_at
        FROM public.merchant_products p
        JOIN public.merchant_product_revisions draft ON draft.id = p.draft_revision_id
          AND draft.business_id = p.business_id AND draft.product_id = p.id
        LEFT JOIN public.merchant_product_revisions published ON published.id = p.published_revision_id
          AND published.business_id = p.business_id AND published.product_id = p.id
        WHERE p.business_id = tenant_id AND p.id = target_id;
      END $$;

      CREATE FUNCTION public.kleva_product_create(target_key uuid, target_name text,
        target_description text, target_sku text, target_price numeric,
        target_currency text, target_availability text)
      RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        actor_id uuid := public.kleva_current_account(); product_id uuid; revision_id uuid;
        old_fingerprint text; fingerprint text;
      BEGIN
        IF COALESCE(public.kleva_current_role(), '') NOT IN ('owner','editor') OR actor_id IS NULL THEN
          RAISE EXCEPTION 'catalog access denied' USING ERRCODE = '42501';
        END IF;
        fingerprint := md5(jsonb_build_array(target_name, target_description, target_sku,
          target_price::text, target_currency, target_availability)::text);
        PERFORM pg_advisory_xact_lock(hashtextextended(tenant_id::text || ':' || target_key::text, 0));
        SELECT p.id, p.creation_fingerprint INTO product_id, old_fingerprint
          FROM public.merchant_products p WHERE p.business_id = tenant_id AND p.creation_key = target_key;
        IF product_id IS NOT NULL THEN
          IF old_fingerprint <> fingerprint THEN
            RAISE EXCEPTION 'product idempotency key conflict' USING ERRCODE = '23505', CONSTRAINT = 'UQ_merchant_product_creation';
          END IF;
          RETURN product_id;
        END IF;
        INSERT INTO public.merchant_products(business_id, creation_key, creation_fingerprint, created_by, updated_by)
          VALUES (tenant_id, target_key, fingerprint, actor_id, actor_id) RETURNING id INTO product_id;
        INSERT INTO public.merchant_product_revisions(business_id, product_id, revision, name, description,
          sku, price, currency, availability, created_by)
          VALUES (tenant_id, product_id, 1, target_name, target_description, target_sku,
            target_price, target_currency, target_availability, actor_id) RETURNING id INTO revision_id;
        UPDATE public.merchant_products SET draft_revision_id = revision_id WHERE id = product_id;
        INSERT INTO public.merchant_product_events(business_id, product_id, revision_id, event_type, actor_account_id)
          VALUES (tenant_id, product_id, revision_id, 'CREATED', actor_id);
        RETURN product_id;
      END $$;

      CREATE FUNCTION public.kleva_product_edit(target_id uuid, expected_revision integer,
        target_name text, target_description text, target_sku text, target_price numeric,
        target_currency text, target_availability text)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        actor_id uuid := public.kleva_current_account(); product_row public.merchant_products%ROWTYPE;
        current_row public.merchant_product_revisions%ROWTYPE; revision_id uuid;
      BEGIN
        IF COALESCE(public.kleva_current_role(), '') NOT IN ('owner','editor') OR actor_id IS NULL THEN
          RAISE EXCEPTION 'catalog access denied' USING ERRCODE = '42501';
        END IF;
        SELECT * INTO product_row FROM public.merchant_products p
          WHERE p.id = target_id AND p.business_id = tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN NULL; END IF;
        SELECT * INTO current_row FROM public.merchant_product_revisions r
          WHERE r.id = product_row.draft_revision_id AND r.business_id = tenant_id AND r.product_id = target_id;
        IF current_row.revision <> expected_revision THEN
          RAISE EXCEPTION 'stale product revision' USING ERRCODE = '40001';
        END IF;
        IF current_row.name = target_name AND current_row.description = target_description
          AND current_row.sku IS NOT DISTINCT FROM target_sku AND current_row.price IS NOT DISTINCT FROM target_price
          AND current_row.currency = target_currency AND current_row.availability = target_availability THEN
          RETURN false;
        END IF;
        INSERT INTO public.merchant_product_revisions(business_id, product_id, revision, name, description,
          sku, price, currency, availability, created_by)
          VALUES (tenant_id, target_id, current_row.revision + 1, target_name, target_description,
            target_sku, target_price, target_currency, target_availability, actor_id) RETURNING id INTO revision_id;
        UPDATE public.merchant_products SET draft_revision_id = revision_id, updated_by = actor_id, updated_at = now()
          WHERE id = target_id AND business_id = tenant_id;
        INSERT INTO public.merchant_product_events(business_id, product_id, revision_id, event_type, actor_account_id)
          VALUES (tenant_id, target_id, revision_id, 'EDITED', actor_id);
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_product_publish(target_id uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        actor_id uuid := public.kleva_current_account(); product_row public.merchant_products%ROWTYPE;
      BEGIN
        IF COALESCE(public.kleva_current_role(), '') NOT IN ('owner','editor') OR actor_id IS NULL THEN
          RAISE EXCEPTION 'catalog access denied' USING ERRCODE = '42501';
        END IF;
        SELECT * INTO product_row FROM public.merchant_products p
          WHERE p.id = target_id AND p.business_id = tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN NULL; END IF;
        IF product_row.draft_revision_id = product_row.published_revision_id THEN RETURN false; END IF;
        UPDATE public.merchant_products SET published_revision_id = draft_revision_id,
          published_at = now(), updated_by = actor_id, updated_at = now()
          WHERE id = target_id AND business_id = tenant_id;
        INSERT INTO public.merchant_product_events(business_id, product_id, revision_id, event_type, actor_account_id)
          VALUES (tenant_id, target_id, product_row.draft_revision_id, 'PUBLISHED', actor_id);
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_product_unpublish(target_id uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        actor_id uuid := public.kleva_current_account(); product_row public.merchant_products%ROWTYPE;
      BEGIN
        IF COALESCE(public.kleva_current_role(), '') NOT IN ('owner','editor') OR actor_id IS NULL THEN
          RAISE EXCEPTION 'catalog access denied' USING ERRCODE = '42501';
        END IF;
        SELECT * INTO product_row FROM public.merchant_products p
          WHERE p.id = target_id AND p.business_id = tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN NULL; END IF;
        IF product_row.published_revision_id IS NULL THEN RETURN false; END IF;
        UPDATE public.merchant_products SET published_revision_id = NULL, updated_by = actor_id, updated_at = now()
          WHERE id = target_id AND business_id = tenant_id;
        INSERT INTO public.merchant_product_events(business_id, product_id, revision_id, event_type, actor_account_id)
          VALUES (tenant_id, target_id, product_row.published_revision_id, 'UNPUBLISHED', actor_id);
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_published_products(target_business_id uuid)
      RETURNS TABLE (business_id uuid, product_id uuid, published_revision_id uuid,
        name text, description text, sku text, price numeric, currency text,
        availability text, published_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT p.business_id, p.id, revision.id, revision.name::text, revision.description::text,
          revision.sku::text, revision.price, revision.currency::text, revision.availability::text, p.published_at
        FROM public.merchant_products p
        JOIN public.merchant_product_revisions revision ON revision.id = p.published_revision_id
          AND revision.business_id = p.business_id AND revision.product_id = p.id
        JOIN public.businesses b ON b.id = p.business_id AND b.status = 'active'
        WHERE p.business_id = target_business_id AND p.published_revision_id IS NOT NULL
          AND session_user::text !~ '^kleva_(merchant|identity)_'
        ORDER BY p.published_at DESC, p.id
      $$;
      REVOKE ALL ON FUNCTION public.kleva_product_list(integer,integer), public.kleva_product_detail(uuid),
        public.kleva_product_create(uuid,text,text,text,numeric,text,text),
        public.kleva_product_edit(uuid,integer,text,text,text,numeric,text,text),
        public.kleva_product_publish(uuid), public.kleva_product_unpublish(uuid),
        public.kleva_published_products(uuid) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_published_products(uuid) TO %I', role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM public.merchant_product_events)
          OR EXISTS (SELECT 1 FROM public.merchant_product_revisions)
          OR EXISTS (SELECT 1 FROM public.merchant_products) THEN
          RAISE EXCEPTION 'Merchant product history exists; preserve the schema for rollback.';
        END IF;
      END $$;
      DROP FUNCTION public.kleva_published_products(uuid);
      DROP FUNCTION public.kleva_product_unpublish(uuid);
      DROP FUNCTION public.kleva_product_publish(uuid);
      DROP FUNCTION public.kleva_product_edit(uuid,integer,text,text,text,numeric,text,text);
      DROP FUNCTION public.kleva_product_create(uuid,text,text,text,numeric,text,text);
      DROP FUNCTION public.kleva_product_detail(uuid);
      DROP FUNCTION public.kleva_product_list(integer,integer);
      DROP TABLE public.merchant_product_events;
      ALTER TABLE public.merchant_products DROP CONSTRAINT "FK_merchant_product_draft_revision",
        DROP CONSTRAINT "FK_merchant_product_published_revision";
      DROP TABLE public.merchant_product_revisions;
      DROP TABLE public.merchant_products;
    `);
  }
}
