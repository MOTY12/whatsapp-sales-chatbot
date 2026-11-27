export type EvaluationLanguage =
  'ENGLISH' | 'NIGERIAN_ENGLISH' | 'NIGERIAN_PIDGIN';
export type EvaluationBusinessCategory =
  | 'HOTEL'
  | 'RESTAURANT'
  | 'RETAIL'
  | 'SCHOOL'
  | 'PROFESSIONAL_SERVICES'
  | 'ECOMMERCE';
export type EvaluationStrategy = 'LEXICAL' | 'SEMANTIC' | 'HYBRID';

export type KnowledgeEvaluationCase = {
  id: string;
  datasetVersion: string;
  question: string;
  language: EvaluationLanguage;
  businessCategory: EvaluationBusinessCategory;
  expectedSourceId?: string;
  expectedRevisionId?: string;
  expectedEvidence?: string[];
  expectedSku?: string;
  shouldAbstain: boolean;
};

export type EvaluationEvidence = {
  sourceId: string;
  revisionId?: string;
  content: string;
  sku?: string | null;
};

export type EvaluationObservation = {
  evidence: EvaluationEvidence[];
  abstained: boolean;
  latencyMs: number;
  embeddingTokens: number;
  crossTenantViolation?: boolean;
};

export type StrategyMetrics = {
  cases: number;
  recallAt1: number | null;
  recallAt3: number | null;
  recallAt5: number | null;
  meanReciprocalRank: number | null;
  evidencePrecision: number | null;
  sourceAttributionAccuracy: number | null;
  exactRevisionAccuracy: number | null;
  exactSkuAccuracy: number | null;
  unsupportedAbstentionRate: number | null;
  crossTenantViolations: number;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
  embeddingTokens: number;
};

export type KnowledgeEvaluationReport = {
  datasetVersion: string;
  evaluatedAt: string;
  mode: 'DETERMINISTIC' | 'REAL_PROVIDER';
  provider: string;
  model: string;
  dimensions: number;
  chunkingVersion: string;
  retrievalConfiguration: Record<string, string | number | boolean>;
  caseCount: number;
  byStrategy: Record<EvaluationStrategy, StrategyMetrics>;
  byLanguage: Record<
    EvaluationLanguage,
    Partial<Record<EvaluationStrategy, StrategyMetrics>>
  >;
  failedCaseIds: Array<{ strategy: EvaluationStrategy; caseId: string }>;
  estimatedCost: null | { currency: string; amount: number };
  limitations: string[];
};
