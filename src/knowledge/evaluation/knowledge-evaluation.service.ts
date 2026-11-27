import { Injectable } from '@nestjs/common';
import { countTokens } from 'gpt-tokenizer/cjs/encoding/cl100k_base';
import type {
  EvaluationObservation,
  EvaluationStrategy,
  KnowledgeEvaluationCase,
  KnowledgeEvaluationReport,
} from './evaluation.types';
import {
  calculateStrategyMetrics,
  groupCasesByLanguage,
} from './evaluation-metrics';

export type EvaluationAdapter = {
  retrieve(input: {
    strategy: EvaluationStrategy;
    evaluationCase: KnowledgeEvaluationCase;
  }): Promise<EvaluationObservation>;
};

export type EvaluationOptions = {
  mode: 'DETERMINISTIC' | 'REAL_PROVIDER';
  provider: string;
  model: string;
  dimensions: number;
  chunkingVersion: string;
  retrievalConfiguration: Record<string, string | number | boolean>;
  authorizedRealProviderRun?: boolean;
  maxCases?: number;
  tokenBudget?: number;
  estimatedCost?: KnowledgeEvaluationReport['estimatedCost'];
};

const strategies: readonly EvaluationStrategy[] = [
  'LEXICAL',
  'SEMANTIC',
  'HYBRID',
];

@Injectable()
export class KnowledgeEvaluationService {
  async run(
    dataset: readonly KnowledgeEvaluationCase[],
    adapter: EvaluationAdapter,
    options: EvaluationOptions,
  ): Promise<KnowledgeEvaluationReport> {
    const maxCases = options.maxCases ?? 50;
    if (!Number.isSafeInteger(maxCases) || maxCases < 1 || maxCases > 50)
      throw new Error('Evaluation case bound must be between 1 and 50.');
    if (dataset.length > maxCases)
      throw new Error('Evaluation dataset exceeds the configured case bound.');
    if (options.mode === 'REAL_PROVIDER') {
      if (options.authorizedRealProviderRun !== true)
        throw new Error(
          'Real-provider evaluation requires explicit authorization.',
        );
      if (
        !Number.isSafeInteger(options.tokenBudget) ||
        (options.tokenBudget ?? 0) < 1
      )
        throw new Error(
          'Real-provider evaluation requires a positive token budget.',
        );
    }
    const observations = Object.fromEntries(
      strategies.map((strategy) => [strategy, [] as EvaluationObservation[]]),
    ) as Record<EvaluationStrategy, EvaluationObservation[]>;
    let consumedBudget = 0;
    for (const strategy of strategies) {
      for (const evaluationCase of dataset) {
        if (options.mode === 'REAL_PROVIDER') {
          const estimatedQueryTokens = countTokens(evaluationCase.question);
          if (
            consumedBudget + estimatedQueryTokens >
            (options.tokenBudget ?? 0)
          )
            throw new Error(
              'Real-provider evaluation token budget would be exceeded.',
            );
        }
        const observation = await adapter.retrieve({
          strategy,
          evaluationCase,
        });
        if (
          !Number.isFinite(observation.latencyMs) ||
          observation.latencyMs < 0 ||
          !Number.isSafeInteger(observation.embeddingTokens) ||
          observation.embeddingTokens < 0
        )
          throw new Error(
            'Evaluation adapter returned invalid measurement metadata.',
          );
        observations[strategy].push(observation);
        consumedBudget += observation.embeddingTokens;
        if (
          options.mode === 'REAL_PROVIDER' &&
          consumedBudget > (options.tokenBudget ?? 0)
        )
          throw new Error(
            'Real-provider evaluation exceeded its configured token budget.',
          );
      }
    }
    const byStrategy = Object.fromEntries(
      strategies.map((strategy) => [
        strategy,
        calculateStrategyMetrics(dataset, observations[strategy]),
      ]),
    ) as Record<
      EvaluationStrategy,
      ReturnType<typeof calculateStrategyMetrics>
    >;
    return {
      datasetVersion: dataset[0]?.datasetVersion ?? 'empty',
      evaluatedAt: new Date().toISOString(),
      mode: options.mode,
      provider: options.provider,
      model: options.model,
      dimensions: options.dimensions,
      chunkingVersion: options.chunkingVersion,
      retrievalConfiguration: options.retrievalConfiguration,
      caseCount: dataset.length,
      byStrategy,
      byLanguage: groupCasesByLanguage(dataset, observations),
      failedCaseIds: dataset.flatMap((evaluationCase, index) =>
        strategies.flatMap((strategy) => {
          const result = observations[strategy][index];
          const hit = evaluationCase.expectedSourceId
            ? !result.abstained &&
              result.evidence.some(
                (item) => item.sourceId === evaluationCase.expectedSourceId,
              )
            : result.abstained && result.evidence.length === 0;
          return hit ? [] : [{ strategy, caseId: evaluationCase.id }];
        }),
      ),
      estimatedCost: options.estimatedCost ?? null,
      limitations:
        options.mode === 'DETERMINISTIC'
          ? [
              'Deterministic fixture vectors verify plumbing and ranking only; they do not establish semantic language quality.',
            ]
          : [
              'Synthetic fixture questions only; results are not production accuracy guarantees.',
            ],
    };
  }
}

export function renderKnowledgeEvaluationMarkdown(
  report: KnowledgeEvaluationReport,
): string {
  const percentage = (value: number | null) =>
    value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
  const lines = [
    `# Knowledge retrieval evaluation — ${report.datasetVersion}`,
    '',
    `Mode: ${report.mode} · Provider: ${report.provider} · Model: ${report.model} · Cases: ${report.caseCount}`,
    `Evaluated: ${report.evaluatedAt} · Dimensions: ${report.dimensions} · Chunking: ${report.chunkingVersion}`,
    '',
    '| Strategy | Recall@1 | Recall@3 | Recall@5 | MRR | Exact revision | Abstention | P95 ms | Embedding tokens |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...strategies.map((strategy) => {
      const metric = report.byStrategy[strategy];
      return `| ${strategy} | ${percentage(metric.recallAt1)} | ${percentage(metric.recallAt3)} | ${percentage(metric.recallAt5)} | ${percentage(metric.meanReciprocalRank)} | ${percentage(metric.exactRevisionAccuracy)} | ${percentage(metric.unsupportedAbstentionRate)} | ${metric.p95LatencyMs ?? 'n/a'} | ${metric.embeddingTokens} |`;
    }),
    '',
    '## Limitations',
    ...report.limitations.map((item) => `- ${item}`),
    '',
    `Failed case IDs: ${report.failedCaseIds.length ? report.failedCaseIds.map(({ strategy, caseId }) => `${strategy}/${caseId}`).join(', ') : 'none'}`,
  ];
  return lines.join('\n');
}
