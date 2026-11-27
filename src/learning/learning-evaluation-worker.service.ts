import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { OutboxOperation } from '../database/entities/outbox-operation.entity';
import { UnifiedKnowledgeRetrievalService } from '../knowledge/unified-knowledge-retrieval.service';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type EvaluationInput = {
  run_id: string;
  business_id: string;
  expected_source_id: string;
  expected_revision_id: string;
  expected_generation_id: string | null;
  question: string;
  previous_revision_id: string | null;
  previous_content: string;
  evaluation_current: boolean;
};

function isEvaluationInput(value: unknown): value is EvaluationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Partial<EvaluationInput>;
  return (
    typeof row.run_id === 'string' &&
    typeof row.business_id === 'string' &&
    typeof row.expected_source_id === 'string' &&
    typeof row.expected_revision_id === 'string' &&
    (typeof row.expected_generation_id === 'string' ||
      row.expected_generation_id === null) &&
    typeof row.question === 'string' &&
    (typeof row.previous_revision_id === 'string' ||
      row.previous_revision_id === null) &&
    typeof row.previous_content === 'string' &&
    typeof row.evaluation_current === 'boolean'
  );
}

function lexicalMatch(question: string, content: string): boolean {
  const terms = (value: string) =>
    new Set(value.toLocaleLowerCase('en-NG').match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const query = terms(question);
  const body = terms(content);
  if (!query.size || !body.size) return false;
  let overlap = 0;
  for (const term of query) if (body.has(term)) overlap += 1;
  return overlap / query.size >= 0.35;
}

@Injectable()
export class LearningEvaluationWorkerService {
  private readonly logger = new Logger(LearningEvaluationWorkerService.name);

  constructor(
    @InjectDataSource() private readonly database: DataSource,
    private readonly retrieval: UnifiedKnowledgeRetrievalService,
  ) {}

  async execute(operation: Readonly<OutboxOperation>): Promise<void> {
    const runId = operation.metadata?.evaluationRunId;
    if (typeof runId !== 'string' || !uuid.test(runId)) return;
    const runner = this.database.createQueryRunner();
    await runner.connect();
    let acquired = false;
    try {
      const lockResult: unknown = await runner.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',
        [`learning-evaluation:${runId}`],
      );
      acquired =
        Array.isArray(lockResult) &&
        !!lockResult[0] &&
        typeof lockResult[0] === 'object' &&
        (lockResult[0] as { acquired?: unknown }).acquired === true;
      if (!acquired) return;
      await this.executeLocked(operation, runId, runner);
    } finally {
      if (acquired) {
        try {
          await runner.query(
            'SELECT pg_advisory_unlock(hashtextextended($1,0))',
            [`learning-evaluation:${runId}`],
          );
        } catch {
          // Releasing the pooled connection also releases its session lock.
        }
      }
      await runner.release();
    }
  }

  private async executeLocked(
    operation: Readonly<OutboxOperation>,
    runId: string,
    runner: QueryRunner,
  ): Promise<void> {
    const inputRows: unknown = await runner.query(
      'SELECT * FROM public.kleva_learning_evaluation_job_read_v2($1)',
      [runId],
    );
    const input =
      Array.isArray(inputRows) && isEvaluationInput(inputRows[0])
        ? inputRows[0]
        : undefined;
    if (!input) return;
    try {
      if (!input.evaluation_current) {
        await runner.query(
          "SELECT public.kleva_learning_evaluation_save($1,'[]'::jsonb,$2)",
          [runId, 'EVALUATION_SUPERSEDED'],
        );
        return;
      }
      const retrieval = await this.retrieval.retrieve({
        businessId: input.business_id,
        query: input.question,
        semanticQuery: input.question,
        limit: 5,
        purpose: 'evaluation',
        requestId: `learning-eval:${runId}`,
      });
      const afterEvidence = retrieval.evidence.map((item) => ({
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        revisionId: item.revisionId,
        generationId: item.generationId ?? null,
        relevanceScore: Number(item.relevanceScore.toFixed(4)),
      }));
      const afterMatch = afterEvidence.some(
        (item) =>
          item.sourceType === 'FAQ' &&
          item.sourceId === input.expected_source_id &&
          item.revisionId === input.expected_revision_id &&
          item.generationId === input.expected_generation_id,
      );
      const differentRevisionMatch = afterEvidence.some(
        (item) =>
          item.sourceType === 'FAQ' &&
          item.sourceId === input.expected_source_id &&
          item.revisionId !== input.expected_revision_id,
      );
      const beforeMatch = input.previous_revision_id
        ? lexicalMatch(input.question, input.previous_content)
        : false;
      const results = [
        {
          caseId: 'approved_question',
          question: input.question,
          beforeOutcome: input.previous_revision_id
            ? 'COMPARABLE_BASELINE_UNAVAILABLE'
            : 'NO_PREVIOUS_REVISION',
          afterOutcome: afterMatch
            ? 'APPROVED_REVISION_RETRIEVED'
            : differentRevisionMatch
              ? 'SAME_SOURCE_DIFFERENT_REVISION'
              : retrieval.sufficientEvidence
                ? 'OTHER_EVIDENCE_RETRIEVED'
                : 'INSUFFICIENT_EVIDENCE',
          beforeEvidence:
            input.previous_revision_id && beforeMatch
              ? [
                  {
                    revisionId: input.previous_revision_id,
                    method: 'LOCAL_LEXICAL_OVERLAP_DIAGNOSTIC',
                  },
                ]
              : [],
          afterEvidence,
        },
      ];
      await runner.query(
        'SELECT public.kleva_learning_evaluation_save($1,$2::jsonb,NULL)',
        [runId, JSON.stringify(results)],
      );
    } catch {
      const attempts = Number.isSafeInteger(operation.attempts)
        ? operation.attempts
        : 0;
      if (attempts < 2) throw new Error('LEARNING_EVALUATION_RETRYABLE');
      await runner.query(
        "SELECT public.kleva_learning_evaluation_save($1,'[]'::jsonb,$2)",
        [runId, 'EVALUATION_UNAVAILABLE'],
      );
      this.logger.warn({
        event: 'learning.evaluation_failed',
        category: 'EVALUATION_UNAVAILABLE',
      });
    }
  }
}
