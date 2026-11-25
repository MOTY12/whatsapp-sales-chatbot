import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { seedTenant } from './fixtures';
import { applyMigrations, createIntegrationDatabase } from './postgres';

describe('merchant-approved learning publication', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let admin: DataSource;
  let merchant: DataSource;
  let runtime: DataSource;
  let tenant: Awaited<ReturnType<typeof seedTenant>>;
  let foreignGapId: string;
  let merchantCredentials: Awaited<
    ReturnType<typeof database.merchantCredentials>
  >;
  let accountId: string;
  const digest = 'learning-approval-session-digest';

  beforeAll(async () => {
    database = await createIntegrationDatabase();
    admin = await database.migrator();
    await applyMigrations(admin);
    tenant = await seedTenant(admin, 1);
    const foreignTenant = await seedTenant(admin, 2);
    merchantCredentials = await database.merchantCredentials(admin);
    await database.grantRuntimeAccess(admin);
    merchant = new DataSource({
      type: 'postgres',
      host: merchantCredentials.host,
      port: Number(merchantCredentials.port),
      username: merchantCredentials.username,
      password: merchantCredentials.password,
      database: merchantCredentials.database,
      synchronize: false,
    });
    await merchant.initialize();
    runtime = await database.runtime();
    const [account] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.accounts(issuer,subject) VALUES ('https://learning.test','merchant-owner') RETURNING id`,
    );
    accountId = account.id;
    await admin.query(
      `INSERT INTO public.business_members("businessId","accountId",role,status) VALUES ($1,$2,'owner','active')`,
      [tenant.business.id, accountId],
    );
    await admin.query(
      `INSERT INTO public.merchant_sessions(token_digest,csrf_digest,account_id) VALUES ($1,'csrf',$2)`,
      [digest, accountId],
    );
    await admin.query(
      `INSERT INTO public.knowledge_gap_clusters(id,business_id,cluster_key,category,normalized_topic,topic_label,status,occurrence_count,last_reason_code)
       VALUES ($1,$2,$3,'MISSING_KNOWLEDGE','delivery coverage abuja','Delivery coverage — Abuja','REVIEWED',1,'NO_MATCH')`,
      [randomUUID(), tenant.business.id, 'a'.repeat(64)],
    );
    foreignGapId = randomUUID();
    await admin.query(
      `INSERT INTO public.knowledge_gap_clusters(id,business_id,cluster_key,category,normalized_topic,topic_label,status,occurrence_count,last_reason_code)
       VALUES ($1,$2,$3,'MISSING_KNOWLEDGE','delivery coverage abuja','Delivery coverage — Abuja','OPEN',1,'NO_MATCH')`,
      [foreignGapId, foreignTenant.business.id, 'b'.repeat(64)],
    );
  });

  afterAll(async () => {
    await merchant?.destroy();
    await runtime?.destroy();
    await database?.close();
  });

  it('keeps staged FAQ private until complete index activation publishes it atomically', async () => {
    const [gap] = await admin.query<{ id: string }[]>(
      `SELECT id FROM public.knowledge_gap_clusters WHERE business_id=$1`,
      [tenant.business.id],
    );
    const faqId = randomUUID();
    const previousRevisionId = randomUUID();
    await admin.query(
      `INSERT INTO public.knowledge_faqs(id,business_id,creation_key,creation_fingerprint,created_by,updated_by)
       VALUES ($1,$2,$3,'fixture',$4,$4)`,
      [faqId, tenant.business.id, randomUUID(), accountId],
    );
    await admin.query(
      `INSERT INTO public.knowledge_faq_revisions(id,business_id,faq_id,revision,question,answer,created_by)
       VALUES ($1,$2,$3,1,'Where do you deliver?','We deliver to Lagos.', $4)`,
      [previousRevisionId, tenant.business.id, faqId, accountId],
    );
    await admin.query(
      `UPDATE public.knowledge_faqs SET draft_revision_id=$2,published_revision_id=$2,published_at=now() WHERE business_id=$1 AND id=$3`,
      [tenant.business.id, previousRevisionId, faqId],
    );
    const createKey = randomUUID();
    await expect(
      merchant.transaction(async (manager) => {
        await manager.query(
          "SELECT set_config('kleva.business_id',$1,true),set_config('kleva.session_digest',$2,true)",
          [tenant.business.id, digest],
        );
        return manager.query<unknown[]>(
          `SELECT * FROM public.kleva_learning_suggestion_create($1,$2,$3,$4,NULL,NULL,'[]'::jsonb,'MANUAL')`,
          [randomUUID(), foreignGapId, 'Foreign question?', 'Foreign answer.'],
        );
      }),
    ).rejects.toMatchObject({ driverError: { code: 'P0002' } });
    const [suggestion] = await merchant.transaction(async (manager) => {
      await manager.query(
        "SELECT set_config('kleva.business_id',$1,true),set_config('kleva.session_digest',$2,true)",
        [tenant.business.id, digest],
      );
      return manager.query<{ id: string; status: string; version: number }[]>(
        `SELECT * FROM public.kleva_learning_suggestion_create($1,$2,$3,$4,$5,$6,'[]'::jsonb,'MANUAL')`,
        [
          createKey,
          gap.id,
          'Do you deliver to Abuja?',
          'Yes, we deliver nationwide including Abuja. Delivery takes two to four working days.',
          faqId,
          previousRevisionId,
        ],
      );
    });
    expect(suggestion.status).toBe('DRAFT');
    await merchant.transaction(async (manager) => {
      await manager.query(
        "SELECT set_config('kleva.business_id',$1,true),set_config('kleva.session_digest',$2,true)",
        [tenant.business.id, digest],
      );
      await manager.query(
        'SELECT public.kleva_learning_suggestion_submit($1,$2)',
        [suggestion.id, suggestion.version],
      );
      await manager.query(
        'SELECT * FROM public.kleva_learning_suggestion_approve($1,$2,$3,$4,$5,$6,$7)',
        [
          suggestion.id,
          suggestion.version,
          randomUUID(),
          'deterministic',
          'text-embedding-3-small',
          1536,
          'sentence-cl100k-v1',
        ],
      );
    });
    const [staged] = await admin.query<
      {
        faq: string;
        revision: string;
        generation: string;
        faq_published: string | null;
        generation_status: string;
      }[]
    >(
      `SELECT s.approved_faq_id AS faq,s.approved_revision_id AS revision,s.generation_id AS generation,
        f.published_revision_id AS faq_published,g.status AS generation_status
       FROM public.learning_suggestions s JOIN public.knowledge_faqs f ON f.id=s.approved_faq_id
       JOIN public.knowledge_index_generations g ON g.id=s.generation_id WHERE s.id=$1`,
      [suggestion.id],
    );
    expect(staged.faq_published).toBe(previousRevisionId);
    expect(staged.generation_status).toBe('PENDING');
    await runtime.query('SELECT public.kleva_knowledge_index_fail($1,$2)', [
      staged.generation,
      'UNAVAILABLE',
    ]);
    const [failed] = await admin.query<
      Array<{ faq_published: string; status: string }>
    >(
      `SELECT f.published_revision_id AS faq_published,s.status FROM public.learning_suggestions s
       JOIN public.knowledge_faqs f ON f.id=s.approved_faq_id WHERE s.id=$1`,
      [suggestion.id],
    );
    expect(failed).toEqual({
      faq_published: previousRevisionId,
      status: 'INDEXING_FAILED',
    });
    const [retry] = await merchant.transaction(async (manager) => {
      await manager.query(
        "SELECT set_config('kleva.business_id',$1,true),set_config('kleva.session_digest',$2,true)",
        [tenant.business.id, digest],
      );
      return manager.query<Array<{ generation_id: string }>>(
        'SELECT * FROM public.kleva_learning_suggestion_retry($1,$2,$3,$4,$5,$6,$7)',
        [
          suggestion.id,
          suggestion.version,
          randomUUID(),
          'deterministic',
          'text-embedding-3-small',
          1536,
          'sentence-cl100k-v1',
        ],
      );
    });
    const generationId = retry.generation_id;
    const sourceRows = await runtime.query<Array<{ content: string }>>(
      'SELECT content FROM public.kleva_knowledge_index_job_read($1)',
      [generationId],
    );
    expect(sourceRows).toHaveLength(1);
    const [expected] = await runtime.query<Array<{ accepted: boolean }>>(
      'SELECT public.kleva_knowledge_index_expected($1,1) AS accepted',
      [generationId],
    );
    expect(expected.accepted).toBe(true);
    const vector = `[${Array.from({ length: 1536 }, () => '0.001').join(',')}]`;
    await runtime.query(
      'SELECT public.kleva_knowledge_chunks_save($1,$2::jsonb)',
      [
        generationId,
        JSON.stringify([
          {
            chunkIndex: 0,
            pageNumber: null,
            startOffset: 0,
            endOffset: 40,
            title: 'Delivery',
            content: sourceRows[0].content,
            checksum: 'a'.repeat(64),
            tokenCount: 12,
            embedding: vector,
          },
        ]),
      ],
    );
    const unpublishedSearch = await runtime.query<unknown[]>(
      'SELECT * FROM public.kleva_search_semantic($1,$2::public.vector(1536),$3,5,0)',
      [tenant.business.id, vector, 'text-embedding-3-small'],
    );
    expect(unpublishedSearch).toHaveLength(0);
    const [activated] = await runtime.query<Array<{ activated: boolean }>>(
      'SELECT public.kleva_knowledge_index_activate($1) AS activated',
      [generationId],
    );
    expect(activated.activated).toBe(true);
    const [replayed] = await runtime.query<Array<{ activated: boolean }>>(
      'SELECT public.kleva_knowledge_index_activate($1) AS activated',
      [generationId],
    );
    expect(replayed.activated).toBe(true);
    const [published] = await admin.query<
      {
        published_revision_id: string;
        status: string;
        generation_status: string;
      }[]
    >(
      `SELECT f.published_revision_id,s.status,g.status AS generation_status FROM public.learning_suggestions s
       JOIN public.knowledge_faqs f ON f.id=s.approved_faq_id JOIN public.knowledge_index_generations g ON g.id=s.generation_id WHERE s.id=$1`,
      [suggestion.id],
    );
    expect(published).toEqual({
      published_revision_id: staged.revision,
      status: 'PUBLISHED',
      generation_status: 'ACTIVE',
    });
    const [events] = await admin.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM public.outbox_operations WHERE operation='knowledge.learning.evaluate' AND id=$1`,
      [staged.generation],
    );
    expect(events.count).toBe(0); // evaluation has a distinct evaluation run ID.
    const [evaluationEvent] = await admin.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM public.outbox_operations WHERE operation='knowledge.learning.evaluate' AND metadata->>'suggestionId'=$1`,
      [suggestion.id],
    );
    expect(evaluationEvent.count).toBe(1);
    const [secondApprove] = await merchant.transaction(async (manager) => {
      await manager.query(
        "SELECT set_config('kleva.business_id',$1,true),set_config('kleva.session_digest',$2,true)",
        [tenant.business.id, digest],
      );
      return manager.query<{ generation_id: string }[]>(
        'SELECT * FROM public.kleva_learning_suggestion_approve($1,$2,$3,$4,$5,$6,$7)',
        [
          suggestion.id,
          suggestion.version,
          randomUUID(),
          'deterministic',
          'text-embedding-3-small',
          1536,
          'sentence-cl100k-v1',
        ],
      );
    });
    expect(secondApprove.generation_id).toBe(generationId);
  });
});
