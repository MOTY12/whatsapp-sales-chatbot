import type { DataSource } from 'typeorm';
import type { OutboxOperation } from '../database/entities/outbox-operation.entity';
import type { UnifiedKnowledgeRetrievalService } from '../knowledge/unified-knowledge-retrieval.service';
import { LearningEvaluationWorkerService } from './learning-evaluation-worker.service';

const runId = '00000000-0000-4000-8000-000000000001';
const sourceId = '00000000-0000-4000-8000-000000000002';
const revisionId = '00000000-0000-4000-8000-000000000003';
const generationId = '00000000-0000-4000-8000-000000000004';

function operation(attempts = 0) {
  return {
    metadata: { evaluationRunId: runId },
    attempts,
  } as unknown as OutboxOperation;
}

function input(evaluation_current = true) {
  return {
    run_id: runId,
    business_id: sourceId,
    expected_source_id: sourceId,
    expected_revision_id: revisionId,
    expected_generation_id: generationId,
    question: 'Where do you deliver?',
    previous_revision_id: null,
    previous_content: '',
    evaluation_current,
  };
}

function evidence(
  revision = revisionId,
  generation: string | null = generationId,
) {
  return {
    sourceType: 'FAQ' as const,
    sourceId,
    revisionId: revision,
    generationId: generation,
    relevanceScore: 0.02,
    title: 'Delivery',
    content: 'We deliver nationwide.',
    retrievalMethod: 'HYBRID' as const,
  };
}

function database(
  query: (sql: string, parameters: unknown[]) => Promise<unknown>,
  acquired = true,
) {
  return {
    createQueryRunner: () => ({
      connect: jest.fn(),
      release: jest.fn(),
      query: jest.fn(async (sql: string, parameters?: unknown[]) => {
        if (sql.includes('pg_try_advisory_lock')) return [{ acquired }];
        if (sql.includes('pg_advisory_unlock'))
          return [{ pg_advisory_unlock: true }];
        return query(sql, parameters ?? []);
      }),
    }),
  };
}

describe('LearningEvaluationWorkerService', () => {
  it('records retrieval of the exact approved revision and generation without claiming a before/after comparison', async () => {
    const saved: unknown[][] = [];
    const query = jest.fn(async (sql: string, parameters: unknown[]) => {
      if (sql.includes('job_read_v2')) return [input()];
      if (sql.includes('evaluation_save')) {
        saved.push(parameters);
        return [true];
      }
      return [];
    });
    const retrieve = jest.fn().mockResolvedValue({
      sufficientEvidence: true,
      evidence: [evidence()],
    });
    const worker = new LearningEvaluationWorkerService(
      database(query) as unknown as DataSource,
      { retrieve } as unknown as UnifiedKnowledgeRetrievalService,
    );

    await worker.execute(operation());

    expect(query).toHaveBeenCalledWith(
      'SELECT * FROM public.kleva_learning_evaluation_job_read_v2($1)',
      [runId],
    );
    expect(retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'evaluation', businessId: sourceId }),
    );
    const results = JSON.parse(String(saved[0][1])) as Array<{
      beforeOutcome: string;
      afterOutcome: string;
      afterEvidence: Array<{ revisionId: string; generationId: string }>;
    }>;
    expect(results[0]).toMatchObject({
      beforeOutcome: 'NO_PREVIOUS_REVISION',
      afterOutcome: 'APPROVED_REVISION_RETRIEVED',
      afterEvidence: [{ revisionId, generationId }],
    });
  });

  it('does not claim the approved revision when another revision of the same FAQ is retrieved', async () => {
    const otherRevision = '00000000-0000-4000-8000-000000000005';
    const previous = input();
    previous.previous_revision_id = '00000000-0000-4000-8000-000000000007';
    previous.previous_content = 'Previously published answer.';
    const query = jest.fn(async (sql: string) =>
      sql.includes('job_read_v2') ? [previous] : [true],
    );
    const worker = new LearningEvaluationWorkerService(
      database(query) as unknown as DataSource,
      {
        retrieve: jest.fn().mockResolvedValue({
          sufficientEvidence: true,
          evidence: [
            evidence(otherRevision, '00000000-0000-4000-8000-000000000006'),
          ],
        }),
      } as unknown as UnifiedKnowledgeRetrievalService,
    );

    await worker.execute(operation());

    const saved = query.mock.calls.find(([sql]) =>
      sql.includes('evaluation_save'),
    );
    const results = JSON.parse(String(saved?.[1][1])) as Array<{
      beforeOutcome: string;
      afterOutcome: string;
    }>;
    expect(results[0]).toMatchObject({
      beforeOutcome: 'COMPARABLE_BASELINE_UNAVAILABLE',
      afterOutcome: 'SAME_SOURCE_DIFFERENT_REVISION',
    });
  });

  it('does not claim the approved revision when generation provenance is missing', async () => {
    const query = jest.fn(async (sql: string) =>
      sql.includes('job_read_v2') ? [input()] : [true],
    );
    const worker = new LearningEvaluationWorkerService(
      database(query) as unknown as DataSource,
      {
        retrieve: jest.fn().mockResolvedValue({
          sufficientEvidence: true,
          evidence: [evidence(revisionId, null)],
        }),
      } as unknown as UnifiedKnowledgeRetrievalService,
    );

    await worker.execute(operation());

    const saved = query.mock.calls.find(([sql]) =>
      sql.includes('evaluation_save'),
    );
    const results = JSON.parse(String(saved?.[1][1])) as Array<{
      afterOutcome: string;
    }>;
    expect(results[0].afterOutcome).toBe('OTHER_EVIDENCE_RETRIEVED');
  });

  it('marks superseded evaluations without retrieving against a newer active source', async () => {
    const query = jest.fn(async (sql: string) =>
      sql.includes('job_read_v2') ? [input(false)] : [true],
    );
    const retrieve = jest.fn();
    const worker = new LearningEvaluationWorkerService(
      database(query) as unknown as DataSource,
      { retrieve } as unknown as UnifiedKnowledgeRetrievalService,
    );

    await worker.execute(operation());

    expect(retrieve).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(
      "SELECT public.kleva_learning_evaluation_save($1,'[]'::jsonb,$2)",
      [runId, 'EVALUATION_SUPERSEDED'],
    );
  });

  it('does not duplicate retrieval or result writes when another worker owns the run lock', async () => {
    const query = jest.fn();
    const retrieve = jest.fn();
    const worker = new LearningEvaluationWorkerService(
      database(query, false) as unknown as DataSource,
      { retrieve } as unknown as UnifiedKnowledgeRetrievalService,
    );

    await worker.execute(operation());

    expect(query).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
  });
});
