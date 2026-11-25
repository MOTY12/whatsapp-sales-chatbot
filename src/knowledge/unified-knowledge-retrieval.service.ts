import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Inject, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { countTokens } from 'gpt-tokenizer/cjs/encoding/cl100k_base';
import { knowledgeIndexConfig } from '../config/env';
import { UsageService } from '../metering/usage.service';
import {
  EMBEDDING_PROVIDER,
  EmbeddingProviderError,
  type EmbeddingProvider,
  type EmbeddingResponse,
} from './embedding-provider';

export type RetrievalRequest = {
  businessId: string;
  query: string;
  limit?: number;
  purpose?: 'live' | 'playground';
  requestId?: string;
  /** Current customer question for query embedding; the lexical query may include bounded context. */
  semanticQuery?: string;
};

export type EvidenceItem = {
  sourceType: 'FAQ' | 'PRODUCT' | 'DOCUMENT';
  sourceId: string;
  revisionId: string;
  relevanceScore: number;
  title: string;
  content: string;
  pageNumber?: number;
  sku?: string | null;
  facts?: {
    price: string | null;
    currency: string;
    availability: 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN';
  };
  chunkId?: string;
  generationId?: string;
  sourceStartOffset?: number;
  sourceEndOffset?: number;
  retrievalMethod?: 'LEXICAL' | 'SEMANTIC' | 'HYBRID' | 'EXACT_IDENTIFIER';
};

export type InsufficientEvidenceReason =
  'NO_MATCH' | 'LOW_RELEVANCE' | 'NO_PUBLISHED_CONTENT';

export type RetrievalResult = {
  evidence: EvidenceItem[];
  sufficientEvidence: boolean;
  reason?: InsufficientEvidenceReason;
};

type SearchRow = {
  has_published_content: boolean;
  source_type: 'FAQ' | 'PRODUCT' | 'DOCUMENT' | null;
  source_id: string | null;
  revision_id: string | null;
  relevance_score: number | string | null;
  title: string | null;
  content: string | null;
  sku?: string | null;
  price?: string | null;
  currency?: string | null;
  availability?: 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN' | null;
  page_number?: number | null;
  chunk_id?: string | null;
  generation_id?: string | null;
  source_start_offset?: number | null;
  source_end_offset?: number | null;
  retrieval_method?: 'LEXICAL' | 'SEMANTIC' | null;
};

type EvidenceRow = SearchRow & {
  source_type: 'FAQ' | 'PRODUCT' | 'DOCUMENT';
  source_id: string;
  revision_id: string;
  relevance_score: number | string;
  title: string;
  content: string;
};

function isSearchRow(value: unknown): value is SearchRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Partial<SearchRow>;
  return (
    typeof row.has_published_content === 'boolean' &&
    (row.source_type === null ||
      row.source_type === 'FAQ' ||
      row.source_type === 'PRODUCT' ||
      row.source_type === 'DOCUMENT') &&
    (row.source_id === null || typeof row.source_id === 'string') &&
    (row.revision_id === null || typeof row.revision_id === 'string') &&
    (row.relevance_score === null ||
      typeof row.relevance_score === 'string' ||
      typeof row.relevance_score === 'number') &&
    (row.title === null || typeof row.title === 'string') &&
    (row.content === null || typeof row.content === 'string') &&
    (row.sku === undefined ||
      row.sku === null ||
      typeof row.sku === 'string') &&
    (row.price === undefined ||
      row.price === null ||
      typeof row.price === 'string') &&
    (row.currency === undefined ||
      row.currency === null ||
      typeof row.currency === 'string') &&
    (row.availability === undefined ||
      row.availability === null ||
      row.availability === 'IN_STOCK' ||
      row.availability === 'OUT_OF_STOCK' ||
      row.availability === 'UNKNOWN') &&
    (row.page_number === undefined ||
      row.page_number === null ||
      Number.isSafeInteger(row.page_number)) &&
    (row.chunk_id === undefined ||
      row.chunk_id === null ||
      typeof row.chunk_id === 'string') &&
    (row.generation_id === undefined ||
      row.generation_id === null ||
      typeof row.generation_id === 'string') &&
    (row.source_start_offset === undefined ||
      row.source_start_offset === null ||
      Number.isSafeInteger(row.source_start_offset)) &&
    (row.source_end_offset === undefined ||
      row.source_end_offset === null ||
      Number.isSafeInteger(row.source_end_offset)) &&
    (row.retrieval_method === undefined ||
      row.retrieval_method === null ||
      row.retrieval_method === 'LEXICAL' ||
      row.retrieval_method === 'SEMANTIC')
  );
}

function isEvidenceRow(row: SearchRow): row is EvidenceRow {
  return (
    row.source_id !== null &&
    row.revision_id !== null &&
    row.source_type !== null &&
    row.relevance_score !== null &&
    row.title !== null &&
    row.content !== null
  );
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const defaultLimit = 5;
const maximumLimit = 10;
export const minimumEvidenceScore = 0.035;
const rrfConstant = 60;

const naturalLanguageStopWords = new Set([
  'are',
  'can',
  'cost',
  'costs',
  'does',
  'do',
  'for',
  'have',
  'how',
  'is',
  'me',
  'much',
  'of',
  'please',
  'price',
  'priced',
  'tell',
  'the',
  'what',
  'you',
]);

function normalizeKnowledgeQuery(value: string): string {
  return value
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((term) => !naturalLanguageStopWords.has(term))
    .join(' ');
}

@Injectable()
export class UnifiedKnowledgeRetrievalService {
  private readonly logger = new Logger(UnifiedKnowledgeRetrievalService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional()
    @Inject(EMBEDDING_PROVIDER)
    private readonly embedding?: EmbeddingProvider,
    @Optional() private readonly usage?: UsageService,
  ) {}

  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    if (
      !request ||
      typeof request !== 'object' ||
      !uuid.test(request.businessId)
    )
      throw new BadRequestException('Invalid business ID.');
    if (
      typeof request.query !== 'string' ||
      request.query.includes('\0') ||
      request.query.length > 256
    ) {
      throw new BadRequestException(
        'Search query must be at most 256 characters.',
      );
    }
    const limit = request.limit ?? defaultLimit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumLimit)
      throw new BadRequestException('Search limit must be between 1 and 10.');

    const queryText = request.query.trim();
    const loadRows = async (queryText: string): Promise<SearchRow[]> => {
      const rawRows: unknown = await this.dataSource.query(
        'SELECT * FROM public.kleva_search_published_knowledge($1, $2, $3)',
        [request.businessId, queryText, limit],
      );
      if (!Array.isArray(rawRows))
        throw new Error(
          'PostgreSQL knowledge retrieval returned an invalid result.',
        );
      const rows = rawRows.filter(isSearchRow);
      if (!rows.length || rows.length !== rawRows.length)
        throw new Error(
          'PostgreSQL knowledge retrieval returned an invalid result.',
        );
      return rows;
    };
    const loadDocumentRows = async (
      queryText: string,
    ): Promise<SearchRow[]> => {
      const rawRows: unknown = await this.dataSource.query(
        'SELECT * FROM public.kleva_search_published_documents($1, $2, $3)',
        [request.businessId, queryText, limit],
      );
      if (
        !Array.isArray(rawRows) ||
        !rawRows.length ||
        rawRows.some((row) => !isSearchRow(row))
      )
        throw new Error(
          'PostgreSQL document retrieval returned an invalid result.',
        );
      return rawRows as SearchRow[];
    };
    const toEvidence = (rows: SearchRow[]): EvidenceItem[] =>
      rows.filter(isEvidenceRow).map((row): EvidenceItem => {
        const item: EvidenceItem = {
          sourceType: row.source_type,
          sourceId: row.source_id,
          revisionId: row.revision_id,
          relevanceScore: Number(row.relevance_score),
          title: row.title,
          content: row.content,
          retrievalMethod:
            row.retrieval_method ?? (row.chunk_id ? 'SEMANTIC' : 'LEXICAL'),
        };
        if (row.source_type === 'DOCUMENT' && row.page_number) {
          item.pageNumber = Number(row.page_number);
        }
        if (row.source_type === 'PRODUCT') {
          item.sku = row.sku;
          item.facts = {
            price: row.price ?? null,
            currency: row.currency ?? 'NGN',
            availability: row.availability ?? 'UNKNOWN',
          };
        }
        if (row.chunk_id) item.chunkId = row.chunk_id;
        if (row.generation_id) item.generationId = row.generation_id;
        if (
          row.source_start_offset !== undefined &&
          row.source_start_offset !== null
        )
          item.sourceStartOffset = Number(row.source_start_offset);
        if (
          row.source_end_offset !== undefined &&
          row.source_end_offset !== null
        )
          item.sourceEndOffset = Number(row.source_end_offset);
        return item;
      });
    const [rows, documentRows] = await Promise.all([
      loadRows(queryText),
      loadDocumentRows(queryText),
    ]);
    const lexical = [...toEvidence(rows), ...toEvidence(documentRows)]
      .sort(
        (a, b) =>
          b.relevanceScore - a.relevanceScore ||
          a.sourceType.localeCompare(b.sourceType) ||
          a.sourceId.localeCompare(b.sourceId),
      )
      .slice(0, limit);
    const lexicalEvidence = lexical.filter(
      (item) => item.relevanceScore >= minimumEvidenceScore,
    );
    const semanticEvidence = await this.semanticCandidates(
      request,
      request.semanticQuery?.trim() || queryText,
      limit,
      toEvidence,
    );
    const evidence = this.fuseCandidates(
      lexicalEvidence,
      semanticEvidence,
      queryText,
      limit,
    );
    if (evidence.length) return { evidence, sufficientEvidence: true };

    const normalizedQuery = normalizeKnowledgeQuery(queryText);
    if (
      normalizedQuery &&
      normalizedQuery !== queryText.toLocaleLowerCase('en')
    ) {
      const [faqFallback, documentFallback] = await Promise.all([
        loadRows(normalizedQuery),
        loadDocumentRows(normalizedQuery),
      ]);
      const fallbackEvidence = [
        ...toEvidence(faqFallback),
        ...toEvidence(documentFallback),
      ]
        .filter((item) => item.relevanceScore >= minimumEvidenceScore)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, limit);
      if (fallbackEvidence.length)
        return { evidence: fallbackEvidence, sufficientEvidence: true };
    }

    const hasPublishedContent = Boolean(
      rows[0]?.has_published_content || documentRows[0]?.has_published_content,
    );
    const reason: InsufficientEvidenceReason = !hasPublishedContent
      ? 'NO_PUBLISHED_CONTENT'
      : lexical.length
        ? 'LOW_RELEVANCE'
        : 'NO_MATCH';
    return { evidence: [], sufficientEvidence: false, reason };
  }

  private async semanticCandidates(
    request: RetrievalRequest,
    query: string,
    limit: number,
    toEvidence: (rows: SearchRow[]) => EvidenceItem[],
  ): Promise<EvidenceItem[]> {
    const config = knowledgeIndexConfig();
    if (
      !config.enabled ||
      !config.apiKey ||
      !this.embedding ||
      !this.usage ||
      !query
    )
      return [];
    let key: string | undefined;
    try {
      const [available] = await this.dataSource.query<
        Array<{ available: boolean }>
      >(
        'SELECT public.kleva_knowledge_semantic_available($1,$2) AS available',
        [request.businessId, config.model],
      );
      if (!available?.available) return [];
      const tokenCount = countTokens(query);
      if (!tokenCount || tokenCount > 128) return [];
      const purpose = request.purpose ?? 'live';
      const requestId =
        request.requestId && /^[0-9a-f-]{36}$/i.test(request.requestId)
          ? request.requestId
          : randomUUID();
      // Every provider call has its own ledger key so a retry after an uncertain
      // outcome conservatively accounts for the additional request.
      key = `semantic-query:${purpose}:${requestId}:${randomUUID()}`;
      const usageCategory =
        purpose === 'playground'
          ? 'playground_embedding_tokens'
          : 'live_embedding_tokens';
      await this.usage.reserveKnowledgeEmbeddingTokens(
        request.businessId,
        key,
        tokenCount,
        usageCategory,
      );
      let response: EmbeddingResponse;
      try {
        response = await this.embedding.embed({
          texts: [query],
          model: config.model,
          dimensions: config.dimensions,
        });
      } catch (error) {
        await this.usage.markKnowledgeEmbeddingTokensUncertain(
          request.businessId,
          key,
          usageCategory,
        );
        this.logSemanticDegradation(error, 'embedding_provider');
        return [];
      }
      const actualTokens = response.inputTokens ?? tokenCount;
      if (actualTokens > tokenCount) {
        await this.usage.markKnowledgeEmbeddingTokensUncertain(
          request.businessId,
          key,
          usageCategory,
        );
        this.logger.warn({
          event: 'knowledge.semantic.degraded',
          category: 'invalid_usage_response',
        });
        return [];
      }
      await this.usage.commitKnowledgeEmbeddingTokens(
        request.businessId,
        key,
        actualTokens,
        usageCategory,
      );
      const vectorLiteral = `[${response.vectors[0].join(',')}]`;
      const raw: unknown = await this.dataSource.query(
        'SELECT * FROM public.kleva_search_semantic($1,$2::public.vector(1536),$3,$4,$5)',
        [
          request.businessId,
          vectorLiteral,
          config.model,
          config.candidates,
          config.minimumSimilarity,
        ],
      );
      if (!Array.isArray(raw) || raw.some((row) => !isSearchRow(row)))
        return [];
      return toEvidence(raw as SearchRow[])
        .filter((item) => item.relevanceScore >= config.minimumSimilarity)
        .sort(
          (a, b) =>
            b.relevanceScore - a.relevanceScore ||
            a.sourceType.localeCompare(b.sourceType) ||
            a.sourceId.localeCompare(b.sourceId),
        )
        .slice(0, Math.min(config.candidates, Math.max(limit * 2, limit)));
    } catch (error) {
      const purpose = request.purpose ?? 'live';
      const category =
        purpose === 'playground'
          ? 'playground_embedding_tokens'
          : 'live_embedding_tokens';
      if (key)
        await this.usage
          .markKnowledgeEmbeddingTokensUncertain(
            request.businessId,
            key,
            category,
          )
          .catch(() => undefined);
      // Provider, quota and temporary vector-store failures degrade to lexical retrieval.
      this.logSemanticDegradation(
        error,
        error instanceof EmbeddingProviderError
          ? error.category.toLowerCase()
          : 'semantic_retrieval',
      );
      return [];
    }
  }

  private logSemanticDegradation(
    error: unknown,
    fallbackCategory: string,
  ): void {
    const category =
      error instanceof EmbeddingProviderError
        ? error.category.toLowerCase()
        : error instanceof Error && error.name === 'UsageLimitExceededError'
          ? 'usage_limit'
          : fallbackCategory;
    this.logger.warn({ event: 'knowledge.semantic.degraded', category });
  }

  private fuseCandidates(
    lexical: EvidenceItem[],
    semantic: EvidenceItem[],
    query: string,
    limit: number,
  ): EvidenceItem[] {
    const ranked = new Map<
      string,
      { item: EvidenceItem; score: number; methods: Set<string> }
    >();
    const add = (
      item: EvidenceItem,
      rank: number,
      method: 'LEXICAL' | 'SEMANTIC',
    ) => {
      const key = [
        item.sourceType,
        item.sourceId,
        item.revisionId,
        item.pageNumber ?? '',
      ].join(':');
      const score = 1 / (rrfConstant + rank);
      const found = ranked.get(key);
      if (found) {
        found.score += score;
        found.methods.add(method);
        if (method === 'SEMANTIC' && item.chunkId) {
          found.item = {
            ...item,
            facts: found.item.facts ?? item.facts,
            sku: found.item.sku ?? item.sku,
          };
        }
      } else
        ranked.set(key, {
          item: { ...item },
          score,
          methods: new Set([method]),
        });
    };
    lexical.forEach((item, index) => add(item, index + 1, 'LEXICAL'));
    semantic.forEach((item, index) => add(item, index + 1, 'SEMANTIC'));
    const exactSku = lexical.find(
      (item) =>
        item.sourceType === 'PRODUCT' &&
        item.sku &&
        item.sku.trim().toLocaleLowerCase('en') ===
          query.trim().toLocaleLowerCase('en'),
    );
    if (exactSku) {
      const key = [
        exactSku.sourceType,
        exactSku.sourceId,
        exactSku.revisionId,
        exactSku.pageNumber ?? '',
      ].join(':');
      const item = ranked.get(key);
      if (item) {
        item.score = 1;
        item.item.retrievalMethod = 'EXACT_IDENTIFIER';
      }
    }
    return [...ranked.values()]
      .map(({ item, score, methods }) => ({
        ...item,
        relevanceScore:
          item.retrievalMethod === 'EXACT_IDENTIFIER'
            ? 1
            : methods.size > 1
              ? score
              : item.relevanceScore,
        retrievalMethod:
          item.retrievalMethod === 'EXACT_IDENTIFIER'
            ? ('EXACT_IDENTIFIER' as const)
            : methods.size > 1
              ? ('HYBRID' as const)
              : methods.has('SEMANTIC')
                ? ('SEMANTIC' as const)
                : ('LEXICAL' as const),
      }))
      .sort(
        (a, b) =>
          b.relevanceScore - a.relevanceScore ||
          a.sourceType.localeCompare(b.sourceType) ||
          a.sourceId.localeCompare(b.sourceId) ||
          (a.pageNumber ?? 0) - (b.pageNumber ?? 0),
      )
      .slice(0, limit);
  }
}
