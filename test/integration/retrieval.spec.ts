import { DataSource } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { UnifiedKnowledgeRetrievalService } from '../../src/knowledge/unified-knowledge-retrieval.service';
import { applyMigrations, createIntegrationDatabase } from './postgres';
import { seedTenant } from './fixtures';

describe('published PostgreSQL knowledge retrieval', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let admin: DataSource;
  let runtime: DataSource;
  let search: UnifiedKnowledgeRetrievalService;
  let firstBusinessId: string;
  let secondBusinessId: string;
  let merchant: DataSource;

  beforeAll(async () => {
    database = await createIntegrationDatabase();
    admin = await database.migrator();
    await applyMigrations(admin);
    const first = await seedTenant(admin, 1);
    const second = await seedTenant(admin, 2);
    firstBusinessId = first.business.id;
    secondBusinessId = second.business.id;
    const credentials = await database.merchantCredentials(admin);
    await database.grantRuntimeAccess(admin);
    runtime = await database.runtime();
    search = new UnifiedKnowledgeRetrievalService(runtime);
    merchant = new DataSource({
      ...(admin.options as PostgresConnectionOptions),
      username: credentials.username,
      password: credentials.password,
      entities: [],
      migrations: [],
      synchronize: false,
      migrationsRun: false,
    });
    await merchant.initialize();
  });

  afterAll(async () => {
    if (merchant?.isInitialized) await merchant.destroy();
    if (runtime?.isInitialized) await runtime.destroy();
    await database?.close();
  });

  async function createFaq(
    businessId: string,
    question: string,
    answer: string,
    published = false,
  ) {
    const [faq] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.knowledge_faqs(business_id, creation_key, creation_fingerprint)
       VALUES ($1, gen_random_uuid(), md5($2)) RETURNING id`,
      [businessId, question],
    );
    const [revision] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.knowledge_faq_revisions(business_id, faq_id, revision, question, answer)
       VALUES ($1, $2, 1, $3, $4) RETURNING id`,
      [businessId, faq.id, question, answer],
    );
    await admin.query(
      `UPDATE public.knowledge_faqs SET draft_revision_id = $2::uuid,
         published_revision_id = CASE WHEN $3::boolean THEN $2::uuid ELSE NULL::uuid END,
         published_at = CASE WHEN $3::boolean THEN now() ELSE NULL::timestamptz END
       WHERE id = $1::uuid`,
      [faq.id, revision.id, published],
    );
    return { id: faq.id, revisionId: revision.id };
  }

  async function addFaqRevision(
    faqId: string,
    businessId: string,
    revisionNumber: number,
    question: string,
    answer: string,
    publish: boolean,
  ) {
    const [revision] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.knowledge_faq_revisions(business_id, faq_id, revision, question, answer)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [businessId, faqId, revisionNumber, question, answer],
    );
    await admin.query(
      `UPDATE public.knowledge_faqs SET draft_revision_id = $2::uuid,
         published_revision_id = CASE WHEN $3::boolean THEN $2::uuid ELSE published_revision_id END,
         published_at = CASE WHEN $3::boolean THEN now() ELSE published_at END
       WHERE id = $1::uuid`,
      [faqId, revision.id, publish],
    );
    return revision.id;
  }

  async function createProduct(
    businessId: string,
    name: string,
    description: string,
    sku: string | null,
    price: string | null,
    availability: 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN',
    published = false,
  ) {
    const [product] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.merchant_products(business_id, creation_key, creation_fingerprint)
       VALUES ($1, gen_random_uuid(), md5($2)) RETURNING id`,
      [businessId, name],
    );
    const [revision] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.merchant_product_revisions(
         business_id, product_id, revision, name, description, sku, price, currency, availability
       ) VALUES ($1,$2,1,$3,$4,$5,$6,'USD',$7) RETURNING id`,
      [businessId, product.id, name, description, sku, price, availability],
    );
    await admin.query(
      `UPDATE public.merchant_products SET draft_revision_id = $2::uuid,
         published_revision_id = CASE WHEN $3::boolean THEN $2::uuid ELSE NULL::uuid END,
         published_at = CASE WHEN $3::boolean THEN now() ELSE NULL::timestamptz END
       WHERE id = $1::uuid`,
      [product.id, revision.id, published],
    );
    return { id: product.id, revisionId: revision.id };
  }

  async function addProductRevision(
    productId: string,
    businessId: string,
    revisionNumber: number,
    name: string,
    description: string,
    sku: string | null,
    price: string | null,
    availability: 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN',
    publish: boolean,
  ) {
    const [revision] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.merchant_product_revisions(
         business_id, product_id, revision, name, description, sku, price, currency, availability
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'USD',$8) RETURNING id`,
      [
        businessId,
        productId,
        revisionNumber,
        name,
        description,
        sku,
        price,
        availability,
      ],
    );
    await admin.query(
      `UPDATE public.merchant_products SET draft_revision_id = $2::uuid,
         published_revision_id = CASE WHEN $3::boolean THEN $2::uuid ELSE published_revision_id END,
         published_at = CASE WHEN $3::boolean THEN now() ELSE published_at END
       WHERE id = $1::uuid`,
      [productId, revision.id, publish],
    );
    return revision.id;
  }

  it('reports no published material and excludes FAQ and product drafts', async () => {
    expect(
      await search.retrieve({ businessId: firstBusinessId, query: 'delivery' }),
    ).toEqual({
      evidence: [],
      sufficientEvidence: false,
      reason: 'NO_PUBLISHED_CONTENT',
    });
    await createFaq(
      firstBusinessId,
      'Do you offer delivery?',
      'Yes, in Lagos.',
    );
    await createProduct(
      firstBusinessId,
      'Lagos delivery bag',
      'Cotton tote bag.',
      'TOTE-DRAFT',
      null,
      'UNKNOWN',
    );
    expect(
      await search.retrieve({ businessId: firstBusinessId, query: 'delivery' }),
    ).toMatchObject({
      evidence: [],
      sufficientEvidence: false,
      reason: 'NO_PUBLISHED_CONTENT',
    });
  });

  it('searches exact and keyword FAQ matches and returns only published revisions', async () => {
    const faq = await createFaq(
      firstBusinessId,
      'Which payment methods do you accept?',
      'We accept bank transfer and cash on delivery.',
      true,
    );
    const unrelated = await createFaq(
      firstBusinessId,
      'Where is your shop?',
      'Visit our market stall in Surulere.',
      true,
    );
    const exact = await search.retrieve({
      businessId: firstBusinessId,
      query: 'Which payment methods do you accept?',
    });
    expect(exact.sufficientEvidence).toBe(true);
    expect(exact.evidence[0]).toMatchObject({
      sourceType: 'FAQ',
      sourceId: faq.id,
      revisionId: faq.revisionId,
      title: 'Which payment methods do you accept?',
      content: 'We accept bank transfer and cash on delivery.',
    });
    expect(exact.evidence[0].relevanceScore).toBeGreaterThan(0.5);
    const keyword = await search.retrieve({
      businessId: firstBusinessId,
      query: 'bank transfer cash',
    });
    expect(keyword.evidence.map(({ sourceId }) => sourceId)).toContain(faq.id);
    expect(keyword.evidence.map(({ sourceId }) => sourceId)).not.toContain(
      unrelated.id,
    );
  });

  it('searches product names and exact SKUs while preserving null and exact facts', async () => {
    const product = await createProduct(
      firstBusinessId,
      'Handwoven cotton tote bag',
      'Made by a Lagos artisan.',
      'TOTE-LAGOS-01',
      null,
      'UNKNOWN',
      true,
    );
    const nameSearch = await search.retrieve({
      businessId: firstBusinessId,
      query: 'handwoven cotton tote',
    });
    expect(nameSearch.evidence[0]).toMatchObject({
      sourceType: 'PRODUCT',
      sourceId: product.id,
      revisionId: product.revisionId,
      title: 'Handwoven cotton tote bag',
      sku: 'TOTE-LAGOS-01',
      facts: { price: null, currency: 'USD', availability: 'UNKNOWN' },
    });
    const skuSearch = await search.retrieve({
      businessId: firstBusinessId,
      query: 'TOTE-LAGOS-01',
    });
    expect(skuSearch.evidence[0]).toMatchObject({
      sourceId: product.id,
      relevanceScore: 1,
      facts: { price: null, availability: 'UNKNOWN' },
    });
  });

  it('combines and ranks FAQ and product evidence with stable bounded order', async () => {
    const faq = await createFaq(
      firstBusinessId,
      'How much is the handmade soap?',
      'The handmade soap costs 2,500 naira.',
      true,
    );
    const product = await createProduct(
      firstBusinessId,
      'Handmade soap',
      'Artisan soap made in Lagos.',
      'SOAP-01',
      '2500.00',
      'IN_STOCK',
      true,
    );
    const result = await search.retrieve({
      businessId: firstBusinessId,
      query: 'handmade soap',
      limit: 2,
    });
    expect(result.sufficientEvidence).toBe(true);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence.map(({ sourceId }) => sourceId)).toEqual([
      product.id,
      faq.id,
    ]);
    expect(result.evidence[0].relevanceScore).toBeGreaterThanOrEqual(
      result.evidence[1].relevanceScore,
    );
    expect(result.evidence[0].facts).toEqual({
      price: '2500.00',
      currency: 'USD',
      availability: 'IN_STOCK',
    });
    await expect(
      search.retrieve({
        businessId: firstBusinessId,
        query: 'handmade soap',
        limit: 11,
      }),
    ).rejects.toThrow('Search limit must be between 1 and 10.');
  });

  it('keeps published revisions stable while drafts change, then reflects publication and unpublishing', async () => {
    const faq = await createFaq(
      firstBusinessId,
      'What is the return policy?',
      'Returns are accepted within seven days.',
      true,
    );
    const faqDraftId = await addFaqRevision(
      faq.id,
      firstBusinessId,
      2,
      'What is the return policy?',
      'Returns are accepted within fourteen days.',
      false,
    );
    const oldFaq = await search.retrieve({
      businessId: firstBusinessId,
      query: 'fourteen days returns',
    });
    expect(oldFaq.evidence).toEqual([]);
    expect(oldFaq.reason).toBe('NO_MATCH');
    expect(
      (
        await search.retrieve({
          businessId: firstBusinessId,
          query: 'seven days returns',
        })
      ).evidence[0].revisionId,
    ).toBe(faq.revisionId);
    const newFaq = await addFaqRevision(
      faq.id,
      firstBusinessId,
      3,
      'What is the return policy?',
      'Returns are accepted within fourteen days.',
      true,
    );
    expect(
      (
        await search.retrieve({
          businessId: firstBusinessId,
          query: 'fourteen days returns',
        })
      ).evidence[0].revisionId,
    ).toBe(newFaq);
    await admin.query(
      'UPDATE public.knowledge_faqs SET published_revision_id = NULL WHERE id = $1',
      [faq.id],
    );
    expect(
      await search.retrieve({
        businessId: firstBusinessId,
        query: 'fourteen days returns',
      }),
    ).toMatchObject({ evidence: [], reason: 'NO_MATCH' });
    expect(faqDraftId).not.toBe(faq.revisionId);

    const product = await createProduct(
      firstBusinessId,
      'Woven market basket',
      'Handmade basket in Lagos.',
      'BASKET-1',
      null,
      'UNKNOWN',
      true,
    );
    await addProductRevision(
      product.id,
      firstBusinessId,
      2,
      'Woven market basket',
      'Handmade basket in Lagos.',
      'BASKET-1',
      '900719925474.09',
      'OUT_OF_STOCK',
      false,
    );
    expect(
      (
        await search.retrieve({
          businessId: firstBusinessId,
          query: 'BASKET-1',
        })
      ).evidence[0],
    ).toMatchObject({
      revisionId: product.revisionId,
      facts: { price: null, availability: 'UNKNOWN' },
    });
    const publishedProductRevision = await addProductRevision(
      product.id,
      firstBusinessId,
      3,
      'Woven market basket',
      'Handmade basket in Lagos.',
      'BASKET-1',
      '900719925474.09',
      'OUT_OF_STOCK',
      true,
    );
    expect(
      (
        await search.retrieve({
          businessId: firstBusinessId,
          query: 'BASKET-1',
        })
      ).evidence[0],
    ).toMatchObject({
      revisionId: publishedProductRevision,
      facts: {
        price: '900719925474.09',
        currency: 'USD',
        availability: 'OUT_OF_STOCK',
      },
    });
    await admin.query(
      'UPDATE public.merchant_products SET published_revision_id = NULL WHERE id = $1',
      [product.id],
    );
    expect(
      await search.retrieve({ businessId: firstBusinessId, query: 'BASKET-1' }),
    ).toMatchObject({ evidence: [], reason: 'NO_MATCH' });
  });

  it('abstains for empty, unrelated and injection-shaped text and scopes every search to one tenant', async () => {
    await createFaq(
      secondBusinessId,
      'Where can I collect my order?',
      'Collect from our Ikeja shop.',
      true,
    );
    expect(
      await search.retrieve({
        businessId: firstBusinessId,
        query: 'quantum physics',
      }),
    ).toMatchObject({
      evidence: [],
      sufficientEvidence: false,
      reason: 'NO_MATCH',
    });
    expect(
      await search.retrieve({ businessId: firstBusinessId, query: '   ' }),
    ).toMatchObject({
      evidence: [],
      sufficientEvidence: false,
      reason: 'NO_MATCH',
    });
    expect(
      await search.retrieve({
        businessId: firstBusinessId,
        query: "x' OR 1=1 --",
      }),
    ).toMatchObject({ evidence: [], sufficientEvidence: false });
    const isolated = await search.retrieve({
      businessId: firstBusinessId,
      query: 'Ikeja collect order',
    });
    expect(isolated.evidence).toEqual([]);
    expect(
      (
        await search.retrieve({
          businessId: secondBusinessId,
          query: 'Ikeja collect order',
        })
      ).evidence[0].sourceType,
    ).toBe('FAQ');
    await expect(
      search.retrieve({ businessId: firstBusinessId, query: 'x'.repeat(257) }),
    ).rejects.toThrow('Search query must be at most 256 characters.');
    await expect(
      search.retrieve({ businessId: firstBusinessId, query: 'x\0y' }),
    ).rejects.toThrow('Search query must be at most 256 characters.');
  });

  it('keeps search internals unavailable to merchant database roles and uses the GIN indexes', async () => {
    await expect(
      merchant.query(
        'SELECT * FROM public.kleva_search_published_knowledge($1,$2,$3)',
        [firstBusinessId, 'anything', 5],
      ),
    ).rejects.toMatchObject({ driverError: { code: '42501' } });
    const indexes = await admin.query<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
       AND indexname IN ('IDX_knowledge_faq_revision_search',
         'IDX_merchant_product_revision_search','IDX_merchant_product_revision_sku_exact')`,
    );
    expect(indexes.map(({ indexname }) => indexname).sort()).toEqual([
      'IDX_knowledge_faq_revision_search',
      'IDX_merchant_product_revision_search',
      'IDX_merchant_product_revision_sku_exact',
    ]);
    await admin.transaction(async (manager) => {
      await manager.query('SET LOCAL enable_seqscan = off');
      const plan = await manager.query<{ 'QUERY PLAN': string }[]>(`
        EXPLAIN (ANALYZE, BUFFERS)
        SELECT id FROM public.knowledge_faq_revisions
        WHERE search_vector @@ websearch_to_tsquery('pg_catalog.simple'::regconfig, 'delivery')
      `);
      expect(JSON.stringify(plan)).toContain('Execution Time:');
    });
  });
});
