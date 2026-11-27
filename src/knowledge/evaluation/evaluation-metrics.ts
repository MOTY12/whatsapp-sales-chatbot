import type {
  EvaluationLanguage,
  EvaluationObservation,
  EvaluationStrategy,
  KnowledgeEvaluationCase,
  StrategyMetrics,
} from './evaluation.types';

function percentile(values: number[], percentileValue: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)];
}

export function calculateStrategyMetrics(
  cases: readonly KnowledgeEvaluationCase[],
  observations: readonly EvaluationObservation[],
): StrategyMetrics {
  if (cases.length !== observations.length)
    throw new Error('Evaluation observations must align with dataset cases.');
  const positives = cases
    .map((item, index) => ({ item, observation: observations[index] }))
    .filter(({ item }) => !!item.expectedSourceId);
  const recallAt = (count: number) =>
    positives.length
      ? positives.filter(
          ({ item, observation }) =>
            observation.evidence
              .slice(0, count)
              .some(
                (evidence) => evidence.sourceId === item.expectedSourceId,
              ) && !observation.abstained,
        ).length / positives.length
      : null;
  const reciprocalRanks = positives.map(({ item, observation }) => {
    if (observation.abstained) return 0;
    const rank = observation.evidence.findIndex(
      ({ sourceId }) => sourceId === item.expectedSourceId,
    );
    return rank < 0 ? 0 : 1 / (rank + 1);
  });
  const labeled = cases
    .map((item, index) => ({ item, observation: observations[index] }))
    .filter(({ item }) => item.expectedEvidence?.length);
  let precisionRelevant = 0;
  let precisionTotal = 0;
  for (const { item, observation } of labeled) {
    for (const evidence of observation.evidence) {
      precisionTotal += 1;
      const content = evidence.content.toLocaleLowerCase('en-NG');
      if (
        item.expectedEvidence!.some((term) =>
          content.includes(term.toLocaleLowerCase('en-NG')),
        )
      )
        precisionRelevant += 1;
    }
  }
  const revisionCases = positives.filter(({ item }) => item.expectedRevisionId);
  const skuCases = positives.filter(({ item }) => item.expectedSku);
  const negativeCases = cases
    .map((item, index) => ({ item, observation: observations[index] }))
    .filter(({ item }) => item.shouldAbstain);
  const latencies = observations.map(({ latencyMs }) => latencyMs);
  return {
    cases: cases.length,
    recallAt1: recallAt(1),
    recallAt3: recallAt(3),
    recallAt5: recallAt(5),
    meanReciprocalRank: reciprocalRanks.length
      ? reciprocalRanks.reduce((sum, score) => sum + score, 0) /
        reciprocalRanks.length
      : null,
    evidencePrecision: precisionTotal
      ? precisionRelevant / precisionTotal
      : null,
    sourceAttributionAccuracy: positives.length
      ? positives.filter(
          ({ item, observation }) =>
            !observation.abstained &&
            observation.evidence[0]?.sourceId === item.expectedSourceId,
        ).length / positives.length
      : null,
    exactRevisionAccuracy: revisionCases.length
      ? revisionCases.filter(
          ({ item, observation }) =>
            !observation.abstained &&
            observation.evidence.some(
              (evidence) =>
                evidence.sourceId === item.expectedSourceId &&
                evidence.revisionId === item.expectedRevisionId,
            ),
        ).length / revisionCases.length
      : null,
    exactSkuAccuracy: skuCases.length
      ? skuCases.filter(
          ({ item, observation }) =>
            !observation.abstained &&
            observation.evidence.some(
              (evidence) =>
                evidence.sourceId === item.expectedSourceId &&
                evidence.sku === item.expectedSku,
            ),
        ).length / skuCases.length
      : null,
    unsupportedAbstentionRate: negativeCases.length
      ? negativeCases.filter(
          ({ observation }) =>
            observation.abstained && observation.evidence.length === 0,
        ).length / negativeCases.length
      : null,
    crossTenantViolations: observations.filter(
      ({ crossTenantViolation }) => crossTenantViolation === true,
    ).length,
    medianLatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    embeddingTokens: observations.reduce(
      (sum, item) => sum + item.embeddingTokens,
      0,
    ),
  };
}

export function groupCasesByLanguage(
  cases: readonly KnowledgeEvaluationCase[],
  observationsByStrategy: Record<
    EvaluationStrategy,
    readonly EvaluationObservation[]
  >,
): Record<
  EvaluationLanguage,
  Partial<Record<EvaluationStrategy, StrategyMetrics>>
> {
  const languages: EvaluationLanguage[] = [
    'ENGLISH',
    'NIGERIAN_ENGLISH',
    'NIGERIAN_PIDGIN',
  ];
  const strategies: EvaluationStrategy[] = ['LEXICAL', 'SEMANTIC', 'HYBRID'];
  return Object.fromEntries(
    languages.map((language) => {
      const indices = cases
        .map((item, index) => (item.language === language ? index : -1))
        .filter((index) => index >= 0);
      const byStrategy = Object.fromEntries(
        strategies.map((strategy) => [
          strategy,
          calculateStrategyMetrics(
            indices.map((index) => cases[index]),
            indices.map((index) => observationsByStrategy[strategy][index]),
          ),
        ]),
      );
      return [language, byStrategy];
    }),
  ) as Record<
    EvaluationLanguage,
    Partial<Record<EvaluationStrategy, StrategyMetrics>>
  >;
}
