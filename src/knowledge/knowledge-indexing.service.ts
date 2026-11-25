import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { countTokens } from 'gpt-tokenizer/cjs/encoding/cl100k_base';
import { knowledgeIndexConfig } from '../config/env';
import type { OutboxOperation } from '../database/entities/outbox-operation.entity';
import { PermanentJobFailure } from '../jobs/outbox.store';
import { UsageService } from '../metering/usage.service';
import {
  chunkKnowledgeText,
  type ChunkSource,
  type KnowledgeTextChunk,
} from './knowledge-chunker';
import {
  EMBEDDING_PROVIDER,
  EmbeddingProviderError,
  type EmbeddingProvider,
  type EmbeddingResponse,
} from './embedding-provider';

type SourceRow = {
  generation_id: string;
  business_id: string;
  source_type: 'FAQ' | 'PRODUCT' | 'DOCUMENT';
  source_id: string;
  source_revision_id: string;
  provider: string;
  model: string;
  dimensions: number;
  title: string;
  content: string;
  page_number: number | null;
  source_offset: number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class KnowledgeIndexingWorkerService {
  private readonly logger = new Logger(KnowledgeIndexingWorkerService.name);
  constructor(
    @InjectDataSource() private readonly database: DataSource,
    private readonly usage: UsageService,
    @Inject(EMBEDDING_PROVIDER) private readonly embedding: EmbeddingProvider,
  ) {}

  async execute(operation: Readonly<OutboxOperation>): Promise<void> {
    const generationId = operation.metadata?.generationId;
    if (typeof generationId !== 'string' || !uuid.test(generationId))
      throw new PermanentJobFailure('INVALID_GENERATION_REFERENCE');
    const config = knowledgeIndexConfig();
    const runner = this.database.createQueryRunner();
    await runner.connect();
    const lockKey = `knowledge-index:${generationId}`;
    let concurrencyLockKey: string | undefined;
    try {
      if (!(await this.tryAcquireLock(runner, lockKey)))
        throw new Error('KNOWLEDGE_INDEX_ALREADY_RUNNING');
      for (let slot = 0; slot < config.concurrency; slot += 1) {
        const candidate = `knowledge-index-concurrency:${slot}`;
        if (await this.tryAcquireLock(runner, candidate)) {
          concurrencyLockKey = candidate;
          break;
        }
      }
      if (!concurrencyLockKey)
        throw new Error('KNOWLEDGE_INDEX_CONCURRENCY_LIMIT');
      await this.executeLocked(operation, generationId);
    } finally {
      try {
        if (concurrencyLockKey)
          await runner.query(
            'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
            [concurrencyLockKey],
          );
        await runner.query(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
          [lockKey],
        );
      } finally {
        await runner.release();
      }
    }
  }

  private async tryAcquireLock(
    runner: ReturnType<DataSource['createQueryRunner']>,
    key: string,
  ): Promise<boolean> {
    const result: unknown = await runner.query(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [key],
    );
    const rows = Array.isArray(result)
      ? (result as Array<{ acquired?: unknown }>)
      : [];
    return rows[0]?.acquired === true;
  }

  private async executeLocked(
    operation: Readonly<OutboxOperation>,
    generationId: string,
  ): Promise<void> {
    const rows = await this.database.query<SourceRow[]>(
      'SELECT * FROM public.kleva_knowledge_index_job_read($1)',
      [generationId],
    );
    if (!rows.length) return; // Already complete, stale or unpublished.
    const config = knowledgeIndexConfig();
    if (!config.apiKey) {
      await this.database.query(
        'SELECT public.kleva_knowledge_index_fail($1,$2)',
        [generationId, 'PROVIDER_NOT_CONFIGURED'],
      );
      throw new PermanentJobFailure('PROVIDER_NOT_CONFIGURED');
    }
    const sources: ChunkSource[] = rows.map((row) => ({
      title: row.title,
      text: row.content,
      pageNumber: row.page_number,
      sourceOffset: row.source_offset,
    }));
    let chunks: KnowledgeTextChunk[];
    try {
      chunks = chunkKnowledgeText(sources, {
        targetTokens: config.targetTokens,
        maxTokens: config.maxTokens,
        overlapTokens: config.overlapTokens,
      });
    } catch (error) {
      const category =
        error instanceof Error && error.message === 'CHUNK_LIMIT'
          ? 'CHUNK_LIMIT'
          : 'CHUNKING_FAILED';
      await this.database.query(
        'SELECT public.kleva_knowledge_index_fail($1,$2)',
        [generationId, category],
      );
      throw new PermanentJobFailure(category);
    }
    const [accepted] = await this.database.query<
      Array<{ kleva_knowledge_index_expected: boolean }>
    >('SELECT public.kleva_knowledge_index_expected($1,$2)', [
      generationId,
      chunks.length,
    ]);
    if (!accepted?.kleva_knowledge_index_expected) return;

    for (let offset = 0; offset < chunks.length; offset += config.batchSize) {
      const batch = chunks.slice(offset, offset + config.batchSize);
      const missing: Array<{
        chunk: KnowledgeTextChunk;
        source: string;
        index: number;
      }> = [];
      for (const chunk of batch) {
        const [existing] = await this.database.query<
          Array<{ exists: boolean }>
        >('SELECT public.kleva_knowledge_chunk_exists($1,$2,$3) AS exists', [
          generationId,
          chunk.chunkIndex,
          chunk.checksum,
        ]);
        if (!existing?.exists)
          missing.push({
            chunk,
            source: `${chunk.title}\n${chunk.content}`,
            index: chunk.chunkIndex,
          });
      }
      if (!missing.length) continue;
      const tokenCount = missing.reduce(
        (sum, item) => sum + countTokens(item.source),
        0,
      );
      const batchConfig = knowledgeIndexConfig();
      if (tokenCount > batchConfig.maxBatchTokens) {
        await this.database.query(
          'SELECT public.kleva_knowledge_index_fail($1,$2)',
          [generationId, 'BATCH_TOKEN_LIMIT'],
        );
        throw new PermanentJobFailure('BATCH_TOKEN_LIMIT');
      }
      const batchIdentity = createHash('sha256')
        .update(missing.map((item) => item.chunk.checksum).join(':'))
        .digest('hex')
        .slice(0, 32);
      const attempt = Number.isSafeInteger(operation.attempts)
        ? operation.attempts
        : 0;
      const idempotencyKey = `embedding:${generationId}:${attempt}:${offset}:${batchIdentity}`;
      await this.usage.reserveKnowledgeEmbeddingTokens(
        rows[0].business_id,
        idempotencyKey,
        tokenCount,
      );
      let response: EmbeddingResponse;
      try {
        response = await this.embedding.embed({
          texts: missing.map((item) => item.source),
          model: rows[0].model,
          dimensions: rows[0].dimensions,
        });
      } catch (error) {
        await this.usage.markKnowledgeEmbeddingTokensUncertain(
          rows[0].business_id,
          idempotencyKey,
        );
        const category =
          error instanceof EmbeddingProviderError
            ? error.category
            : 'UNAVAILABLE';
        if (error instanceof EmbeddingProviderError && !error.retryable) {
          await this.database.query(
            'SELECT public.kleva_knowledge_index_fail($1,$2)',
            [generationId, category],
          );
          throw new PermanentJobFailure(category);
        }
        throw new Error(`EMBEDDING_${category}`);
      }
      const actualTokens = response.inputTokens ?? tokenCount;
      if (actualTokens > tokenCount) {
        await this.usage.markKnowledgeEmbeddingTokensUncertain(
          rows[0].business_id,
          idempotencyKey,
        );
        await this.database.query(
          'SELECT public.kleva_knowledge_index_fail($1,$2)',
          [generationId, 'INVALID_USAGE_RESPONSE'],
        );
        throw new PermanentJobFailure('INVALID_USAGE_RESPONSE');
      }
      const saved = missing.map((item, index) => ({
        chunkIndex: item.index,
        pageNumber: item.chunk.pageNumber,
        startOffset: item.chunk.startOffset,
        endOffset: item.chunk.endOffset,
        title: item.chunk.title,
        content: item.chunk.content,
        checksum: item.chunk.checksum,
        tokenCount: item.chunk.tokenCount,
        embedding: response.vectors[index],
      }));
      await this.database.query(
        'SELECT public.kleva_knowledge_chunks_save($1,$2::jsonb)',
        [generationId, JSON.stringify(saved)],
      );
      await this.usage.commitKnowledgeEmbeddingTokens(
        rows[0].business_id,
        idempotencyKey,
        actualTokens,
      );
    }
    const [activated] = await this.database.query<
      Array<{ kleva_knowledge_index_activate: boolean }>
    >('SELECT public.kleva_knowledge_index_activate($1)', [generationId]);
    if (!activated?.kleva_knowledge_index_activate)
      this.logger.log({
        event: 'knowledge.index.stale_generation',
        generationId,
      });
  }
}
