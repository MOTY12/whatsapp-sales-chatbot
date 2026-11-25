import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { OutboxOperation } from '../database/entities/outbox-operation.entity';
import { UnifiedKnowledgeRetrievalService } from '../knowledge/unified-knowledge-retrieval.service';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type EvaluationInput = {
  run_id: string;
  business_id: string;
  expected_source_id: string;
  question: string;
  previous_revision_id: string | null;
  previous_content: string;
};

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
    const inputs = await this.database.query<EvaluationInput[]>(
      'SELECT * FROM public.kleva_learning_evaluation_job_read($1)',
      [runId],
    );
    const input = inputs[0];
    if (!input) return;
    try {
      const retrieval = await this.retrieval.retrieve({
        businessId: input.business_id,
        query: input.question,
        semanticQuery: input.question,
        limit: 5,
        purpose: 'playground',
        requestId: `learning-eval:${runId}`,
      });
      const afterEvidence = retrieval.evidence.map((item) => ({
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        revisionId: item.revisionId,
        relevanceScore: Number(item.relevanceScore.toFixed(4)),
      }));
      const afterMatch = afterEvidence.some(
        (item) =>
          item.sourceType === 'FAQ' &&
          item.sourceId === input.expected_source_id,
      );
      const beforeMatch = input.previous_revision_id
        ? lexicalMatch(input.question, input.previous_content)
        : false;
      const results = [
        {
          caseId: 'approved_question',
          question: input.question,
          beforeOutcome: input.previous_revision_id
            ? beforeMatch
              ? 'PREVIOUS_FAQ_LEXICAL_MATCH'
              : 'PREVIOUS_FAQ_NO_LEXICAL_MATCH'
            : 'NO_PREVIOUS_REVISION',
          afterOutcome: afterMatch
            ? 'EXPECTED_FAQ_RETRIEVED'
            : retrieval.sufficientEvidence
              ? 'OTHER_EVIDENCE_RETRIEVED'
              : 'INSUFFICIENT_EVIDENCE',
          beforeEvidence:
            input.previous_revision_id && beforeMatch
              ? [
                  {
                    revisionId: input.previous_revision_id,
                    method: 'LOCAL_LEXICAL_OVERLAP',
                  },
                ]
              : [],
          afterEvidence,
        },
      ];
      await this.database.query(
        'SELECT public.kleva_learning_evaluation_save($1,$2::jsonb,NULL)',
        [runId, JSON.stringify(results)],
      );
    } catch {
      const attempts = Number.isSafeInteger(operation.attempts)
        ? operation.attempts
        : 0;
      if (attempts < 2) throw new Error('LEARNING_EVALUATION_RETRYABLE');
      await this.database.query(
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
