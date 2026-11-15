import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { aiConfig } from '../config/env';
import {
  UsageLimitExceededError,
  UsageService,
} from '../metering/usage.service';
import {
  UnifiedKnowledgeRetrievalService,
  type EvidenceItem,
} from '../knowledge/unified-knowledge-retrieval.service';
import {
  OutboundMessageService,
  OutboundPolicyError,
} from '../whatsapp/outbound-message.service';
import type { OutboxOperation } from '../database/entities/outbox-operation.entity';
import {
  GROUNDED_MODEL,
  ModelResponseError,
  type GroundedModel,
} from './grounded-model.provider';
import { validateGroundedResponse } from './grounded-response.validator';

export const whatsappAiResponseOperation = 'whatsapp.ai_response';
const fallbackMessage =
  "I don't have enough information to confirm that. Let me connect you with someone from the business.";
const inputBudget = 3600;
const outputBudget = 300;

type RunRow = {
  id: string;
  business_id: string;
  inbound_message_id: string;
  conversation_id: string;
  lead_id: string | null;
  authorized_control_version: number | string;
  status: string;
  evidence: Array<{ sourceId: string; revisionId: string; sourceType: string }>;
  reply: string | null;
  recipient: string;
  customer_message: string;
  control_mode: string;
  control_version: number | string;
  business_status: string;
  connection_status: string;
  verified_at: Date | null;
};

@Injectable()
export class AiResponseService {
  private readonly logger = new Logger(AiResponseService.name);
  constructor(
    @InjectDataSource() private readonly database: DataSource,
    private readonly retrieval: UnifiedKnowledgeRetrievalService,
    private readonly usage: UsageService,
    private readonly outbound: OutboundMessageService,
    @Inject(GROUNDED_MODEL) private readonly model: GroundedModel,
  ) {}

  async execute(operation: Readonly<OutboxOperation>): Promise<void> {
    const runId = operation.metadata.aiResponseRunId;
    const businessId = operation.businessId;
    if (!businessId || runId !== operation.id)
      throw new Error('Invalid AI response operation.');
    const seed = await this.load(runId, businessId);
    if (!seed) return;
    const runner = this.database.createQueryRunner();
    await runner.connect();
    const lockKey = `ai-response:${seed.business_id}:${seed.conversation_id}`;
    try {
      await runner.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [
        lockKey,
      ]);
      await this.executeLocked(operation, runId);
    } finally {
      try {
        await runner.query(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
          [lockKey],
        );
      } finally {
        await runner.release();
      }
    }
  }

  private async executeLocked(
    operation: Readonly<OutboxOperation>,
    runId: string,
  ): Promise<void> {
    const businessId = operation.businessId;
    if (!businessId) return;
    let row = await this.load(runId, businessId);
    if (
      !row ||
      [
        'QUEUED',
        'COMPLETED',
        'ABSTAINED',
        'HANDOFF_REQUIRED',
        'SKIPPED',
        'FAILED',
      ].includes(row.status)
    )
      return;
    this.log('AI_RESPONSE_ELIGIBLE', row);
    if (!aiConfig().enabled) {
      await this.finish(row, 'SKIPPED', 'AI_DISABLED');
      return;
    }
    if (!this.isAuthorized(row)) {
      const humanTakeover = row.control_mode === 'HUMAN';
      await this.finish(
        row,
        humanTakeover ? 'SKIPPED' : 'HANDOFF_REQUIRED',
        humanTakeover ? 'HUMAN_TAKEOVER' : 'BUSINESS_OR_CONNECTION_INACTIVE',
      );
      this.log(
        humanTakeover ? 'AI_SKIPPED_HUMAN_TAKEOVER' : 'AI_HANDOFF_REQUIRED',
        row,
      );
      return;
    }

    let evidence: EvidenceItem[] = [];
    const fallbackMessage = aiConfig().handoffMessage;
    let reply = row.reply;
    let status: 'GENERATED' | 'HANDOFF_REQUIRED' = 'GENERATED';
    let errorCategory: string | null = null;
    if (row.status !== 'GENERATED') {
      const retrieval = await this.retrieval.retrieve({
        businessId: row.business_id,
        query: row.customer_message.slice(0, 256),
        limit: 5,
      });
      evidence = retrieval.evidence;
      this.log(
        retrieval.sufficientEvidence
          ? 'AI_RETRIEVAL_COMPLETED'
          : 'AI_INSUFFICIENT_EVIDENCE',
        row,
        retrieval.reason,
      );
      if (!retrieval.sufficientEvidence) {
        status = 'HANDOFF_REQUIRED';
        errorCategory = retrieval.reason ?? 'INSUFFICIENT_EVIDENCE';
        reply = fallbackMessage;
      } else if (!this.isAuthorized(await this.load(runId, row.business_id))) {
        await this.finish(row, 'SKIPPED', 'HUMAN_TAKEOVER');
        this.log('AI_SKIPPED_HUMAN_TAKEOVER', row);
        return;
      } else {
        const estimateInput = Math.min(
          inputBudget,
          Math.max(
            64,
            Math.ceil(
              (row.customer_message.length +
                evidence.reduce(
                  (sum, item) => sum + item.content.length + item.title.length,
                  0,
                ) +
                1400) /
                3,
            ),
          ),
        );
        try {
          await this.usage.reserveAiTokens(
            row.business_id,
            row.id,
            estimateInput,
            outputBudget,
          );
        } catch (error) {
          if (error instanceof UsageLimitExceededError) {
            await this.finish(row, 'HANDOFF_REQUIRED', 'AI_TOKEN_QUOTA');
            this.log('AI_SKIPPED_QUOTA', row, error.category);
            return;
          }
          throw error;
        }
        this.log('AI_GENERATION_STARTED', row);
        try {
          const generated = await this.model.generate({
            message: row.customer_message,
            evidence: evidence.map((item) => ({
              id: item.sourceId,
              revisionId: item.revisionId,
              type: item.sourceType,
              title: item.title,
              content: item.content,
              facts: item.facts,
            })),
          });
          await this.usage.commitAiTokens(
            row.business_id,
            row.id,
            generated.inputTokens,
            generated.outputTokens,
          );
          const validation = validateGroundedResponse(generated, evidence);
          if (validation.valid) reply = generated.reply.trim();
          else {
            status = 'HANDOFF_REQUIRED';
            errorCategory = validation.reason;
            reply = fallbackMessage;
            this.log('AI_RESPONSE_REJECTED', row, validation.reason);
          }
        } catch (error) {
          // Provider timeouts have uncertain usage; conservatively consume the reservation.
          await this.usage.commitAiTokens(row.business_id, row.id);
          status = 'HANDOFF_REQUIRED';
          errorCategory =
            error instanceof ModelResponseError
              ? error.message
              : 'MODEL_UNAVAILABLE';
          reply = fallbackMessage;
          this.log('AI_GENERATION_FAILED', row, errorCategory);
        }
      }
      if (!reply)
        throw new Error('AI response generation produced no terminal reply.');
      await this.database.query(
        `UPDATE public.ai_response_runs SET status = 'GENERATED', reply = $3, evidence = $4,
          error_category = $5, updated_at = now() WHERE id = $1 AND business_id = $2 AND status IN ('PENDING','PROCESSING')`,
        [
          runId,
          row.business_id,
          reply,
          JSON.stringify(
            evidence.map(({ sourceId, revisionId, sourceType }) => ({
              sourceId,
              revisionId,
              sourceType,
            })),
          ),
          errorCategory,
        ],
      );
    } else {
      evidence = await this.evidenceFromRun(row);
    }

    const current = await this.load(runId, row.business_id);
    if (!current || !this.isAuthorized(current)) {
      await this.finish(row, 'SKIPPED', 'HUMAN_TAKEOVER');
      this.log('AI_SKIPPED_HUMAN_TAKEOVER', row);
      return;
    }
    row = current;
    if (!reply) throw new Error('Generated reply is missing.');
    try {
      const outboundId = await this.outbound.enqueueTextMessage(
        row.business_id,
        { to: row.recipient, message: reply },
        row.id,
        undefined,
        {
          conversationId: row.conversation_id,
          kind: 'AI',
          controlVersion: row.authorized_control_version,
        },
      );
      await this.database.query(
        `UPDATE public.ai_response_runs SET status = $3, outbound_message_id = $4,
          updated_at = now(), completed_at = now() WHERE id = $1 AND business_id = $2 AND status = 'GENERATED'`,
        [
          runId,
          row.business_id,
          status === 'HANDOFF_REQUIRED' ? 'HANDOFF_REQUIRED' : 'QUEUED',
          outboundId,
        ],
      );
      this.log(
        status === 'HANDOFF_REQUIRED'
          ? 'AI_HANDOFF_REQUIRED'
          : 'AI_RESPONSE_QUEUED',
        row,
        errorCategory,
      );
    } catch (error) {
      const category =
        error instanceof UsageLimitExceededError
          ? 'WHATSAPP_MESSAGE_QUOTA'
          : error instanceof OutboundPolicyError
            ? 'OUTBOUND_POLICY_BLOCKED'
            : 'OUTBOUND_UNAVAILABLE';
      await this.database.query(
        `UPDATE public.ai_response_runs SET status = 'HANDOFF_REQUIRED', error_category = $3,
          updated_at = now(), completed_at = now() WHERE id = $1 AND business_id = $2 AND status = 'GENERATED'`,
        [runId, row.business_id, category],
      );
      this.log('AI_HANDOFF_REQUIRED', row, category);
    }
  }

  private async load(id: string, businessId: string): Promise<RunRow | null> {
    const [row] = await this.database.query<RunRow[]>(
      `SELECT a.id,a.business_id,a.inbound_message_id,a.conversation_id,a.lead_id,
        a.authorized_control_version,a.status,a.evidence,a.reply,m.content AS customer_message,
        c."whatsappId" AS recipient,v.control_mode,v.control_version,b.status AS business_status,
        ch.status AS connection_status,ch."verifiedAt" AS verified_at
       FROM public.ai_response_runs a JOIN public.messages m ON m.id=a.inbound_message_id AND m."businessId"=a.business_id
       JOIN public.conversations v ON v.id=a.conversation_id AND v."businessId"=a.business_id
       JOIN public.customers c ON c.id=v."customerId" AND c."businessId"=a.business_id
       JOIN public.businesses b ON b.id=a.business_id
       JOIN LATERAL (SELECT status,"verifiedAt" FROM public.channel_connections WHERE "businessId"=a.business_id
         AND provider='whatsapp' ORDER BY "updatedAt" DESC LIMIT 1) ch ON true
       WHERE a.id=$1 AND a.business_id=$2`,
      [id, businessId],
    );
    return row ?? null;
  }

  private isAuthorized(row: RunRow | null): boolean {
    return Boolean(
      row &&
      row.business_status === 'active' &&
      row.connection_status === 'active' &&
      row.verified_at &&
      row.control_mode === 'AUTO' &&
      String(row.control_version) === String(row.authorized_control_version),
    );
  }

  private async evidenceFromRun(row: RunRow): Promise<EvidenceItem[]> {
    const retrieved = await this.retrieval.retrieve({
      businessId: row.business_id,
      query: row.customer_message.slice(0, 256),
      limit: 5,
    });
    const allowed = new Map(
      retrieved.evidence.map((item) => [item.sourceId, item]),
    );
    return (row.evidence ?? [])
      .map((saved) => allowed.get(saved.sourceId))
      .filter((item): item is EvidenceItem => Boolean(item));
  }

  private async finish(row: RunRow, status: string, category: string) {
    await this.database.query(
      `UPDATE public.ai_response_runs SET status=$3,error_category=$4,updated_at=now(),completed_at=now()
        WHERE id=$1 AND business_id=$2 AND status NOT IN ('QUEUED','COMPLETED')`,
      [row.id, row.business_id, status, category],
    );
  }

  private log(event: string, row: RunRow, category?: string | null) {
    this.logger.log({
      event,
      businessId: row.business_id,
      conversationId: row.conversation_id,
      inboundMessageId: row.inbound_message_id,
      correlationId: row.id,
      ...(category ? { category } : {}),
    });
  }
}
