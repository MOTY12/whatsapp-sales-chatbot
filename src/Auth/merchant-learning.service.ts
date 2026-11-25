import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { MerchantPrincipal } from './auth.service';
import { MerchantAccess } from './merchant-access.service';
import { knowledgeIndexConfig } from '../config/env';
import { knowledgeChunkingVersion } from '../knowledge/knowledge-chunker';
import { MerchantAssistantService } from './merchant-assistant.service';

type KnowledgeGapListRow = {
  id: string;
  category: string;
  topic_label: string;
  normalized_topic: string;
  status: LearningGapStatus;
  occurrence_count: number;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  last_reason_code: string;
  sample_question: string | null;
};

export type LearningGapStatus = 'OPEN' | 'REVIEWED' | 'DISMISSED';
const statuses = new Set<LearningGapStatus>(['OPEN', 'REVIEWED', 'DISMISSED']);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const suggestionStatuses = new Set([
  'DRAFT',
  'PENDING_REVIEW',
  'APPROVED',
  'INDEXING',
  'PUBLISHED',
  'INDEXING_FAILED',
  'PUBLICATION_CONFLICT',
  'DISMISSED',
  'SUPERSEDED',
]);
type SuggestionRow = Record<string, unknown> & { id: string };

@Injectable()
export class MerchantLearningService {
  constructor(
    private readonly access: MerchantAccess,
    @Optional() private readonly assistant?: MerchantAssistantService,
  ) {}

  suggestions(actor: MerchantPrincipal, businessId: string, status?: string) {
    const filter = status?.trim().toUpperCase() || null;
    if (filter !== null && !suggestionStatuses.has(filter))
      throw new BadRequestException('Choose a valid suggestion status.');
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => ({
        items: await manager.query<SuggestionRow[]>(
          'SELECT * FROM public.kleva_learning_suggestions_list($1)',
          [filter],
        ),
      }),
    );
  }

  suggestion(
    actor: MerchantPrincipal,
    businessId: string,
    suggestionId: string,
  ) {
    if (!uuid.test(suggestionId)) throw new NotFoundException();
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        const [row] = await manager.query<SuggestionRow[]>(
          'SELECT * FROM public.kleva_learning_suggestion_detail($1)',
          [suggestionId],
        );
        if (!row) throw new NotFoundException();
        return row;
      },
    );
  }

  evaluations(
    actor: MerchantPrincipal,
    businessId: string,
    suggestionId: string,
  ) {
    if (!uuid.test(suggestionId)) throw new NotFoundException();
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => ({
        items: await manager.query<SuggestionRow[]>(
          'SELECT * FROM public.kleva_learning_evaluation_list($1)',
          [suggestionId],
        ),
      }),
    );
  }

  createSuggestion(
    actor: MerchantPrincipal,
    businessId: string,
    gapId: string,
    body: unknown,
  ) {
    if (!uuid.test(gapId)) throw new NotFoundException();
    const input = this.input(body, true);
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        const [row] = await manager.query<SuggestionRow[]>(
          'SELECT * FROM public.kleva_learning_suggestion_create($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
          [
            randomUUID(),
            gapId,
            input.question,
            input.answer,
            input.targetFaqId,
            input.expectedTargetRevisionId,
            JSON.stringify(input.supportingSources),
            'MANUAL',
          ],
        );
        if (!row) throw new NotFoundException();
        return row;
      },
    );
  }

  async draftSuggestionWithAssistant(
    actor: MerchantPrincipal,
    businessId: string,
    gapId: string,
  ) {
    if (!uuid.test(gapId)) throw new NotFoundException();
    if (!this.assistant)
      throw new BadRequestException('AI-assisted drafting is unavailable.');
    const [gap] = await this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) =>
        manager.query<Array<{ sample_question: string | null }>>(
          'SELECT sample_question FROM public.kleva_learning_gaps(100,NULL) WHERE id=$1',
          [gapId],
        ),
    );
    if (!gap?.sample_question)
      throw new ConflictException(
        'This gap has no safe question text to draft from.',
      );
    const draft = await this.assistant.testMessage(actor, businessId, {
      message: gap.sample_question,
      history: [],
    });
    if (draft.outcome !== 'ANSWERED' || draft.sources.length === 0)
      throw new ConflictException(
        'Published knowledge does not support a safe draft. Please provide the answer manually.',
      );
    const sourceRefs = draft.sources.map(
      (source) => `${source.type}:${source.id}:${source.revisionId}`,
    );
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        const [row] = await manager.query<SuggestionRow[]>(
          'SELECT * FROM public.kleva_learning_suggestion_create($1,$2,$3,$4,NULL,NULL,$5::jsonb,$6)',
          [
            randomUUID(),
            gapId,
            gap.sample_question,
            draft.reply,
            JSON.stringify(sourceRefs),
            'AI_ASSISTED',
          ],
        );
        if (!row) throw new NotFoundException();
        const [detail] = await manager.query<SuggestionRow[]>(
          'SELECT * FROM public.kleva_learning_suggestion_detail($1)',
          [row.id],
        );
        if (!detail) throw new NotFoundException();
        return detail;
      },
    );
  }

  editSuggestion(
    actor: MerchantPrincipal,
    businessId: string,
    suggestionId: string,
    body: unknown,
  ) {
    if (!uuid.test(suggestionId)) throw new NotFoundException();
    const input = this.input(body, false);
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        try {
          const [row] = await manager.query<SuggestionRow[]>(
            'SELECT * FROM public.kleva_learning_suggestion_edit($1,$2,$3,$4,$5,$6)',
            [
              suggestionId,
              input.expectedVersion,
              input.question,
              input.answer,
              input.targetFaqId,
              input.expectedTargetRevisionId,
            ],
          );
          if (!row) throw new NotFoundException();
          return row;
        } catch (error) {
          if ((error as { code?: string }).code === '40001')
            throw new ConflictException(
              'Suggestion changed. Refresh and try again.',
            );
          throw error;
        }
      },
    );
  }

  submitSuggestion(
    actor: MerchantPrincipal,
    businessId: string,
    suggestionId: string,
    body: unknown,
  ) {
    if (!uuid.test(suggestionId)) throw new NotFoundException();
    const version = this.expectedVersion(body);
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        try {
          const [row] = await manager.query<Array<{ submitted: boolean }>>(
            'SELECT public.kleva_learning_suggestion_submit($1,$2) AS submitted',
            [suggestionId, version],
          );
          if (!row?.submitted) throw new NotFoundException();
          return { id: suggestionId, status: 'PENDING_REVIEW', version };
        } catch (error) {
          if ((error as { code?: string }).code === '40001')
            throw new ConflictException(
              'Suggestion changed. Refresh and try again.',
            );
          throw error;
        }
      },
    );
  }

  approveSuggestion(
    actor: MerchantPrincipal,
    businessId: string,
    suggestionId: string,
    body: unknown,
  ) {
    if (!uuid.test(suggestionId)) throw new NotFoundException();
    const version = this.expectedVersion(body);
    const config = knowledgeIndexConfig();
    if (!config.apiKey)
      throw new BadRequestException('Knowledge indexing is not configured.');
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        try {
          const [row] = await manager.query<SuggestionRow[]>(
            'SELECT * FROM public.kleva_learning_suggestion_approve($1,$2,$3,$4,$5,$6,$7)',
            [
              suggestionId,
              version,
              this.idempotencyKey(body),
              config.provider,
              config.model,
              config.dimensions,
              knowledgeChunkingVersion,
            ],
          );
          if (!row) throw new NotFoundException();
          return row;
        } catch (error) {
          if (
            (error as { code?: string }).code === '40001' ||
            (error as { code?: string }).code === '23505'
          )
            throw new ConflictException(
              'Suggestion or target FAQ changed. Refresh and try again.',
            );
          throw error;
        }
      },
    );
  }

  retrySuggestion(
    actor: MerchantPrincipal,
    businessId: string,
    suggestionId: string,
    body: unknown,
  ) {
    if (!uuid.test(suggestionId)) throw new NotFoundException();
    const version = this.expectedVersion(body);
    const config = knowledgeIndexConfig();
    if (!config.apiKey)
      throw new BadRequestException('Knowledge indexing is not configured.');
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        try {
          const [row] = await manager.query<SuggestionRow[]>(
            'SELECT * FROM public.kleva_learning_suggestion_retry($1,$2,$3,$4,$5,$6,$7)',
            [
              suggestionId,
              version,
              this.idempotencyKey(body),
              config.provider,
              config.model,
              config.dimensions,
              knowledgeChunkingVersion,
            ],
          );
          if (!row) throw new NotFoundException();
          return row;
        } catch (error) {
          if (
            (error as { code?: string }).code === '40001' ||
            (error as { code?: string }).code === '23505'
          )
            throw new ConflictException(
              'Suggestion or target FAQ changed. Refresh and try again.',
            );
          throw error;
        }
      },
    );
  }

  dismissSuggestion(
    actor: MerchantPrincipal,
    businessId: string,
    suggestionId: string,
    body: unknown,
  ) {
    if (!uuid.test(suggestionId)) throw new NotFoundException();
    const reason =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>).reason
        : null;
    if (
      reason !== null &&
      reason !== undefined &&
      (typeof reason !== 'string' || !/^[A-Z_]{2,40}$/.test(reason))
    )
      throw new BadRequestException('Invalid dismissal reason.');
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        try {
          const [row] = await manager.query<Array<{ dismissed: boolean }>>(
            'SELECT public.kleva_learning_suggestion_dismiss($1,$2) AS dismissed',
            [suggestionId, reason ?? null],
          );
          if (!row?.dismissed) throw new NotFoundException();
          return { id: suggestionId, status: 'DISMISSED' };
        } catch (error) {
          if ((error as { code?: string }).code === '40001')
            throw new ConflictException(
              'Published suggestions cannot be dismissed.',
            );
          throw error;
        }
      },
    );
  }

  private input(body: unknown, create: boolean) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('Invalid suggestion.');
    const value = body as Record<string, unknown>;
    const allowed = create
      ? [
          'question',
          'answer',
          'targetFaqId',
          'expectedTargetRevisionId',
          'supportingSources',
        ]
      : [
          'expectedVersion',
          'question',
          'answer',
          'targetFaqId',
          'expectedTargetRevisionId',
        ];
    if (
      Object.keys(value).some((key) => !allowed.includes(key)) ||
      typeof value.question !== 'string' ||
      typeof value.answer !== 'string' ||
      value.question.trim().length < 1 ||
      value.question.length > 500 ||
      value.answer.length > 5000 ||
      (create === false &&
        (!Number.isInteger(value.expectedVersion) ||
          Number(value.expectedVersion) < 1))
    )
      throw new BadRequestException('Provide a valid question and answer.');
    const targetFaqId = value.targetFaqId ?? null;
    const expectedTargetRevisionId = value.expectedTargetRevisionId ?? null;
    if (
      (targetFaqId !== null &&
        (typeof targetFaqId !== 'string' || !uuid.test(targetFaqId))) ||
      (expectedTargetRevisionId !== null &&
        (typeof expectedTargetRevisionId !== 'string' ||
          !uuid.test(expectedTargetRevisionId))) ||
      (targetFaqId === null) !== (expectedTargetRevisionId === null)
    )
      throw new BadRequestException('Choose a valid FAQ revision.');
    const sources = value.supportingSources ?? [];
    if (
      !Array.isArray(sources) ||
      sources.length > 10 ||
      sources.some((item) => typeof item !== 'string' || item.length > 120)
    )
      throw new BadRequestException('Invalid supporting knowledge references.');
    return {
      question: value.question,
      answer: value.answer,
      targetFaqId,
      expectedTargetRevisionId,
      supportingSources: sources,
      expectedVersion: value.expectedVersion,
    };
  }

  private expectedVersion(body: unknown): number {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !Number.isInteger((body as Record<string, unknown>).expectedVersion) ||
      Number((body as Record<string, unknown>).expectedVersion) < 1
    )
      throw new BadRequestException('A valid expectedVersion is required.');
    return Number((body as Record<string, unknown>).expectedVersion);
  }

  private idempotencyKey(body: unknown): string {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      typeof (body as Record<string, unknown>).idempotencyKey !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        (body as Record<string, unknown>).idempotencyKey as string,
      )
    )
      throw new BadRequestException('A version 4 idempotencyKey is required.');
    return (body as Record<string, unknown>).idempotencyKey as string;
  }

  list(
    actor: MerchantPrincipal,
    businessId: string,
    status?: string,
    limit?: string,
  ) {
    const filter = status?.trim().toUpperCase() || null;
    if (filter !== null && !statuses.has(filter as LearningGapStatus)) {
      throw new BadRequestException('Choose a valid knowledge-gap status.');
    }
    const pageSize = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new BadRequestException('Page size must be between 1 and 100.');
    }
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        const items = await manager.query<KnowledgeGapListRow[]>(
          'SELECT * FROM public.kleva_learning_gaps($1,$2)',
          [pageSize, filter],
        );
        return { items, limit: pageSize };
      },
    );
  }

  updateStatus(
    actor: MerchantPrincipal,
    businessId: string,
    clusterId: string,
    body: unknown,
  ) {
    if (!uuid.test(clusterId)) throw new NotFoundException();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid knowledge-gap update.');
    }
    const input = body as Record<string, unknown>;
    if (
      Object.keys(input).length !== 1 ||
      typeof input.status !== 'string' ||
      !statuses.has(input.status as LearningGapStatus)
    ) {
      throw new BadRequestException('Choose a valid knowledge-gap status.');
    }
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        const [row] = await manager.query<
          {
            id: string;
            status: LearningGapStatus;
            updated_at: Date | string;
          }[]
        >('SELECT * FROM public.kleva_learning_gap_set_status($1,$2)', [
          clusterId,
          input.status,
        ]);
        if (!row) throw new NotFoundException();
        return row;
      },
    );
  }
}
