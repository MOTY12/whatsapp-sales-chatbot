import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PublishedKnowledgeSearch1760000000015 implements MigrationInterface {
  name = 'PublishedKnowledgeSearch1760000000015';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE public.knowledge_faq_revisions ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (
          setweight(to_tsvector('pg_catalog.simple'::regconfig, coalesce(question, '')), 'A') ||
          setweight(to_tsvector('pg_catalog.simple'::regconfig, coalesce(answer, '')), 'B')
        ) STORED;
      ALTER TABLE public.merchant_product_revisions ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (
          setweight(to_tsvector('pg_catalog.simple'::regconfig, coalesce(name, '')), 'A') ||
          setweight(to_tsvector('pg_catalog.simple'::regconfig, coalesce(description, '')), 'B') ||
          setweight(to_tsvector('pg_catalog.simple'::regconfig, coalesce(sku, '')), 'A')
        ) STORED;
      CREATE INDEX "IDX_knowledge_faq_revision_search"
        ON public.knowledge_faq_revisions USING GIN (search_vector);
      CREATE INDEX "IDX_merchant_product_revision_search"
        ON public.merchant_product_revisions USING GIN (search_vector);
      CREATE INDEX "IDX_merchant_product_revision_sku_exact"
        ON public.merchant_product_revisions (upper(btrim(sku))) WHERE sku IS NOT NULL;

      CREATE FUNCTION public.kleva_search_published_knowledge(
        target_business_id uuid, target_query text, target_limit integer
      ) RETURNS TABLE (
        has_published_content boolean, source_type text, source_id uuid, revision_id uuid,
        relevance_score real, title text, content text, sku text, price numeric,
        currency text, availability text
      ) LANGUAGE plpgsql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        IF session_user::text ~ '^kleva_(merchant|identity)_' THEN
          RAISE EXCEPTION 'knowledge retrieval denied' USING ERRCODE = '42501';
        END IF;
        IF target_business_id IS NULL OR target_query IS NULL OR target_limit IS NULL
          OR length(target_query) > 256 OR target_limit < 1 OR target_limit > 10 THEN
          RAISE EXCEPTION 'invalid knowledge search request' USING ERRCODE = '22023';
        END IF;
        RETURN QUERY
        WITH query_terms AS (
          SELECT websearch_to_tsquery('pg_catalog.simple'::regconfig, btrim(target_query)) AS query,
            lower(btrim(target_query)) AS normalized
        ),
        faq_matches AS (
          SELECT 'FAQ'::text AS source_type, f.id AS source_id, r.id AS revision_id,
            CASE WHEN lower(btrim(r.question)) = q.normalized THEN 1.0::real
              ELSE ts_rank_cd(r.search_vector, q.query, 32) END AS relevance_score,
            r.question::text AS title, r.answer::text AS content,
            NULL::text AS sku, NULL::numeric AS price, NULL::text AS currency,
            NULL::text AS availability
          FROM public.knowledge_faqs f
          JOIN public.knowledge_faq_revisions r ON r.id = f.published_revision_id
            AND r.business_id = f.business_id AND r.faq_id = f.id
          CROSS JOIN query_terms q
          WHERE f.business_id = target_business_id AND f.published_revision_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.businesses b
              WHERE b.id = f.business_id AND b.status = 'active')
            AND (
              r.search_vector @@ q.query
              OR (q.normalized <> '' AND lower(btrim(r.question)) = q.normalized)
            )
        ),
        product_matches AS (
          SELECT 'PRODUCT'::text AS source_type, p.id AS source_id, r.id AS revision_id,
            CASE WHEN lower(btrim(r.name)) = q.normalized OR
              (r.sku IS NOT NULL AND upper(btrim(r.sku)) = upper(btrim(target_query))) THEN 1.0::real
              ELSE ts_rank_cd(r.search_vector, q.query, 32) END AS relevance_score,
            r.name::text AS title, r.description::text AS content,
            r.sku::text AS sku, r.price, r.currency::text AS currency,
            r.availability::text AS availability
          FROM public.merchant_products p
          JOIN public.merchant_product_revisions r ON r.id = p.published_revision_id
            AND r.business_id = p.business_id AND r.product_id = p.id
          CROSS JOIN query_terms q
          WHERE p.business_id = target_business_id AND p.published_revision_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.businesses b
              WHERE b.id = p.business_id AND b.status = 'active')
            AND (
              r.search_vector @@ q.query
              OR (q.normalized <> '' AND lower(btrim(r.name)) = q.normalized)
              OR (q.normalized <> '' AND r.sku IS NOT NULL
                AND upper(btrim(r.sku)) = upper(btrim(target_query)))
            )
        ),
        matches AS (
          SELECT * FROM faq_matches
          UNION ALL
          SELECT * FROM product_matches
        ),
        ranked AS (
          SELECT matches.*, row_number() OVER (
            ORDER BY matches.relevance_score DESC, matches.source_type ASC, matches.source_id ASC
          ) AS position
          FROM matches
        ),
        availability AS (
          SELECT EXISTS (
            SELECT 1 FROM public.knowledge_faqs f
            JOIN public.businesses b ON b.id = f.business_id AND b.status = 'active'
            WHERE f.business_id = target_business_id AND f.published_revision_id IS NOT NULL
          ) OR EXISTS (
            SELECT 1 FROM public.merchant_products p
            JOIN public.businesses b ON b.id = p.business_id AND b.status = 'active'
            WHERE p.business_id = target_business_id AND p.published_revision_id IS NOT NULL
          ) AS has_content
        )
        SELECT availability.has_content, ranked.source_type, ranked.source_id, ranked.revision_id,
          ranked.relevance_score, ranked.title, ranked.content, ranked.sku,
          ranked.price, ranked.currency, ranked.availability
        FROM availability LEFT JOIN ranked ON ranked.position <= target_limit
        ORDER BY ranked.position NULLS LAST;
      END $$;

      REVOKE ALL ON FUNCTION public.kleva_search_published_knowledge(uuid,text,integer) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_search_published_knowledge(uuid,text,integer) TO %I', role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DROP FUNCTION public.kleva_search_published_knowledge(uuid,text,integer);
      DROP INDEX public."IDX_merchant_product_revision_sku_exact";
      DROP INDEX public."IDX_merchant_product_revision_search";
      DROP INDEX public."IDX_knowledge_faq_revision_search";
      ALTER TABLE public.merchant_product_revisions DROP COLUMN search_vector;
      ALTER TABLE public.knowledge_faq_revisions DROP COLUMN search_vector;
    `);
  }
}
