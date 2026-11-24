import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

export type RetrievalRequest = {
  businessId: string;
  query: string;
  limit?: number;
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
      Number.isSafeInteger(row.page_number))
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
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

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
        return item;
      });
    const [rows, documentRows] = await Promise.all([
      loadRows(queryText),
      loadDocumentRows(queryText),
    ]);
    const candidates = [...toEvidence(rows), ...toEvidence(documentRows)]
      .sort(
        (a, b) =>
          b.relevanceScore - a.relevanceScore ||
          a.sourceType.localeCompare(b.sourceType) ||
          a.sourceId.localeCompare(b.sourceId),
      )
      .slice(0, limit);
    const evidence = candidates.filter(
      (item) => item.relevanceScore >= minimumEvidenceScore,
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
      : candidates.length
        ? 'LOW_RELEVANCE'
        : 'NO_MATCH';
    return { evidence: [], sufficientEvidence: false, reason };
  }
}
