import { knowledgeEvaluationDataset } from './evaluation-dataset';
import {
  KnowledgeEvaluationService,
  renderKnowledgeEvaluationMarkdown,
} from './knowledge-evaluation.service';
import type { EvaluationAdapter } from './knowledge-evaluation.service';

describe('KnowledgeEvaluationService', () => {
  it('compares all retrieval strategies over the versioned synthetic dataset and renders a safe report', async () => {
    const service = new KnowledgeEvaluationService();
    const adapter: EvaluationAdapter = {
      retrieve: async ({ strategy, evaluationCase }) => ({
        evidence: evaluationCase.expectedSourceId
          ? [
              {
                sourceId: evaluationCase.expectedSourceId,
                revisionId: evaluationCase.expectedRevisionId,
                content:
                  evaluationCase.expectedEvidence?.join(' ') ??
                  'synthetic result',
                sku: evaluationCase.expectedSku,
              },
            ]
          : [],
        abstained: evaluationCase.shouldAbstain,
        latencyMs: strategy === 'HYBRID' ? 10 : 5,
        embeddingTokens: strategy === 'LEXICAL' ? 0 : 4,
      }),
    };
    const report = await service.run(knowledgeEvaluationDataset, adapter, {
      mode: 'DETERMINISTIC',
      provider: 'fixture',
      model: 'hash-vector-fixture',
      dimensions: 1536,
      chunkingVersion: 'sentence-cl100k-v1',
      retrievalConfiguration: { candidateLimit: 20 },
    });

    expect(report.caseCount).toBe(18);
    expect(report.byStrategy.HYBRID.recallAt5).toBe(1);
    expect(report.byStrategy.HYBRID.exactSkuAccuracy).toBe(1);
    expect(report.byStrategy.SEMANTIC.embeddingTokens).toBeGreaterThan(0);
    expect(report.byLanguage.NIGERIAN_PIDGIN.HYBRID).toBeDefined();
    expect(report.limitations[0]).toMatch(
      /do not establish semantic language quality/i,
    );
    expect(renderKnowledgeEvaluationMarkdown(report)).toContain('Recall@5');
    expect(JSON.stringify(report)).not.toContain('OPENAI_API_KEY');
  });

  it('requires explicit authorization and a bounded token budget for real-provider mode', async () => {
    const service = new KnowledgeEvaluationService();
    const retrieve = jest.fn().mockResolvedValue({
      evidence: [],
      abstained: true,
      latencyMs: 1,
      embeddingTokens: 0,
    });
    const adapter: EvaluationAdapter = {
      retrieve,
    };
    const options = {
      mode: 'REAL_PROVIDER' as const,
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      chunkingVersion: 'sentence-cl100k-v1',
      retrievalConfiguration: {},
    };
    await expect(
      service.run([knowledgeEvaluationDataset[0]], adapter, options),
    ).rejects.toThrow(
      'Real-provider evaluation requires explicit authorization.',
    );
    await expect(
      service.run([knowledgeEvaluationDataset[0]], adapter, {
        ...options,
        authorizedRealProviderRun: true,
      }),
    ).rejects.toThrow(
      'Real-provider evaluation requires a positive token budget.',
    );
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('refuses a real-provider run before dispatch when its configured query budget is too small', async () => {
    const service = new KnowledgeEvaluationService();
    const retrieve = jest.fn();
    const adapter: EvaluationAdapter = {
      retrieve,
    };
    await expect(
      service.run([knowledgeEvaluationDataset[0]], adapter, {
        mode: 'REAL_PROVIDER',
        provider: 'openai',
        model: 'text-embedding-3-small',
        dimensions: 1536,
        chunkingVersion: 'sentence-cl100k-v1',
        retrievalConfiguration: {},
        authorizedRealProviderRun: true,
        tokenBudget: 1,
      }),
    ).rejects.toThrow(
      'Real-provider evaluation token budget would be exceeded.',
    );
    expect(retrieve).not.toHaveBeenCalled();
  });
});
