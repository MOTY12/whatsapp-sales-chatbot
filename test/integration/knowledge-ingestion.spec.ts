import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { OutboxOperation } from '../../src/database/entities/outbox-operation.entity';
import {
  DeterministicEmbeddingProvider,
  EmbeddingProviderError,
} from '../../src/knowledge/embedding-provider';
import { KnowledgeIndexingWorkerService } from '../../src/knowledge/knowledge-indexing.service';
import { UnifiedKnowledgeRetrievalService } from '../../src/knowledge/unified-knowledge-retrieval.service';
import { UsageService } from '../../src/metering/usage.service';
import { applyMigrations, createIntegrationDatabase } from './postgres';
import { seedTenant } from './fixtures';

describe('pgvector knowledge ingestion and hybrid retrieval', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let admin: DataSource;
  let runtime: DataSource;
  let usage: UsageService;
  let indexing: KnowledgeIndexingWorkerService;
  let retrieval: UnifiedKnowledgeRetrievalService;
  let originalEnabled: string | undefined;
  let originalApiKey: string | undefined;
  let businessA: string;
  let businessB: string;
  let faqA: { id: string; revisionId: string };
  let faqB: { id: string; revisionId: string };

  beforeAll(async () => {
    originalEnabled = process.env.KNOWLEDGE_SEMANTIC_SEARCH_ENABLED;
    originalApiKey = process.env.OPENAI_API_KEY;
    process.env.KNOWLEDGE_SEMANTIC_SEARCH_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'fixture-only-not-a-real-key';
    database = await createIntegrationDatabase();
    admin = await database.migrator();
    await applyMigrations(admin);
    const first = await seedTenant(admin, 1);
    const second = await seedTenant(admin, 2);
    businessA = first.business.id;
    businessB = second.business.id;
    faqA = await createFaq(
      businessA,
      'Returns policy',
      'Return an item within seven days of purchase.',
    );
    faqB = await createFaq(
      businessB,
      'Returns policy',
      'Return an item within seven days of purchase.',
    );
    await database.grantRuntimeAccess(admin);
    runtime = await database.runtime();
    usage = new UsageService(runtime);
    const embeddings = new DeterministicEmbeddingProvider();
    indexing = new KnowledgeIndexingWorkerService(runtime, usage, embeddings);
    retrieval = new UnifiedKnowledgeRetrievalService(
      runtime,
      embeddings,
      usage,
    );
  });

  afterAll(async () => {
    if (originalEnabled === undefined)
      delete process.env.KNOWLEDGE_SEMANTIC_SEARCH_ENABLED;
    else process.env.KNOWLEDGE_SEMANTIC_SEARCH_ENABLED = originalEnabled;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    if (runtime?.isInitialized) await runtime.destroy();
    await database?.close();
  });

  async function createFaq(
    businessId: string,
    question: string,
    answer: string,
  ) {
    const [faq] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.knowledge_faqs(business_id,creation_key,creation_fingerprint)
       VALUES ($1,gen_random_uuid(),md5($2)) RETURNING id`,
      [businessId, question],
    );
    const [revision] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.knowledge_faq_revisions(business_id,faq_id,revision,question,answer)
       VALUES ($1,$2,1,$3,$4) RETURNING id`,
      [businessId, faq.id, question, answer],
    );
    await admin.query(
      `UPDATE public.knowledge_faqs SET draft_revision_id=$2,published_revision_id=$2,published_at=now() WHERE id=$1`,
      [faq.id, revision.id],
    );
    return { id: faq.id, revisionId: revision.id };
  }

  async function createGeneration(
    businessId: string,
    faq: { id: string; revisionId: string },
  ) {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.knowledge_index_generations
       (id,business_id,request_key,source_type,source_id,source_revision_id,embedding_provider,embedding_model,embedding_dimensions,chunking_version)
       VALUES ($1,$2,$3,'FAQ',$4,$5,'openai','text-embedding-3-small',1536,'sentence-cl100k-v1')`,
      [id, businessId, randomUUID(), faq.id, faq.revisionId],
    );
    await admin.query(
      `INSERT INTO public.outbox_operations(id,"businessId",operation,metadata)
       VALUES ($1::uuid,$2::uuid,'knowledge.index.requested',jsonb_build_object('generationId',$1::uuid::text))`,
      [id, businessId],
    );
    return id;
  }

  async function execute(generationId: string, service = indexing) {
    await service.execute({
      id: generationId,
      operation: 'knowledge.index.requested',
      metadata: { generationId },
    } as unknown as OutboxOperation);
  }

  it('indexes published FAQ with durable, deterministic chunks and retrieves it semantically per tenant', async () => {
    const generationA = await createGeneration(businessA, faqA);
    const generationB = await createGeneration(businessB, faqB);
    await execute(generationA);
    await execute(generationB);

    const [active] = await admin.query<
      Array<{
        status: string;
        indexed_chunk_count: number;
        expected_chunk_count: number;
      }>
    >(
      `SELECT status,indexed_chunk_count,expected_chunk_count FROM public.knowledge_index_generations WHERE id=$1`,
      [generationA],
    );
    expect(active).toMatchObject({
      status: 'ACTIVE',
      indexed_chunk_count: 1,
      expected_chunk_count: 1,
    });
    const [chunk] = await admin.query<
      Array<{
        content: string;
        token_count: number;
        checksum_sha256: string;
        page_number: number | null;
      }>
    >(
      `SELECT content,token_count,checksum_sha256,page_number FROM public.knowledge_chunks WHERE generation_id=$1`,
      [generationA],
    );
    expect(chunk).toMatchObject({
      page_number: null,
      token_count: expect.any(Number),
      checksum_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(chunk.content).toContain('Return an item within seven days');

    const answerA = await retrieval.retrieve({
      businessId: businessA,
      query: 'return an item within three days',
      requestId: randomUUID(),
    });
    const answerB = await retrieval.retrieve({
      businessId: businessB,
      query: 'return an item within three days',
      requestId: randomUUID(),
    });
    expect(answerA.sufficientEvidence).toBe(true);
    expect(answerB.sufficientEvidence).toBe(true);
    expect(answerA.evidence.every((item) => item.sourceId === faqA.id)).toBe(
      true,
    );
    expect(answerB.evidence.every((item) => item.sourceId === faqB.id)).toBe(
      true,
    );
    expect(answerA.evidence[0]).toMatchObject({
      retrievalMethod: 'SEMANTIC',
      generationId: generationA,
    });
  });

  it('keeps the active generation after a permanent replacement failure and immediately excludes an unpublished source', async () => {
    const [active] = await admin.query<Array<{ id: string }>>(
      `SELECT id FROM public.knowledge_index_generations WHERE business_id=$1 AND source_id=$2 AND status='ACTIVE'`,
      [businessA, faqA.id],
    );
    const failedGeneration = await createGeneration(businessA, faqA);
    const failingProvider = {
      name: 'fixture',
      embed: async () => {
        throw new EmbeddingProviderError('REJECTED', false);
      },
    };
    const failingIndexing = new KnowledgeIndexingWorkerService(
      runtime,
      usage,
      failingProvider,
    );
    await expect(execute(failedGeneration, failingIndexing)).rejects.toThrow(
      'REJECTED',
    );
    const [replacement] = await admin.query<
      Array<{ status: string; failure_category: string }>
    >(
      `SELECT status,failure_category FROM public.knowledge_index_generations WHERE id=$1`,
      [failedGeneration],
    );
    expect(replacement).toMatchObject({
      status: 'FAILED',
      failure_category: 'REJECTED',
    });
    const [stillActive] = await admin.query<Array<{ id: string }>>(
      `SELECT id FROM public.knowledge_index_generations WHERE business_id=$1 AND source_id=$2 AND status='ACTIVE'`,
      [businessA, faqA.id],
    );
    expect(stillActive.id).toBe(active.id);

    await admin.query(
      'UPDATE public.knowledge_faqs SET published_revision_id=NULL,published_at=NULL WHERE id=$1',
      [faqA.id],
    );
    const result = await retrieval.retrieve({
      businessId: businessA,
      query: 'return an item within three days',
      requestId: randomUUID(),
    });
    expect(result).toMatchObject({
      evidence: [],
      sufficientEvidence: false,
      reason: 'NO_PUBLISHED_CONTENT',
    });
  });
});
