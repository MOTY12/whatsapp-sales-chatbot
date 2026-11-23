import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
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
import {
  defaultAssistantPreferences,
  type AssistantPreferences,
} from './assistant-preferences';
import { AgentToolExecutor } from '../agent-tools/agent-tool-executor.service';
import { agentToolRegistry } from '../agent-tools/tool-registry';
import { ConversationMemoryService } from '../support-agent/conversation-memory.service';

export const whatsappAiResponseOperation = 'whatsapp.ai_response';
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
  error_category: string | null;
  evidence: Array<{ sourceId: string; revisionId: string; sourceType: string }>;
  reply: string | null;
  recipient: string;
  customer_message: string;
  control_mode: string;
  control_version: number | string;
  business_status: string;
  connection_status: string;
  verified_at: Date | null;
  pilot_approved: boolean;
  has_newer_inbound: boolean;
  published_knowledge_ready: boolean;
  assistant_configured: boolean;
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
    @Optional() private readonly tools?: AgentToolExecutor,
    @Optional() private readonly memory?: ConversationMemoryService,
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
        humanTakeover || row.has_newer_inbound ? 'SKIPPED' : 'HANDOFF_REQUIRED',
        humanTakeover
          ? 'HUMAN_TAKEOVER'
          : row.has_newer_inbound
            ? 'NEWER_CUSTOMER_TURN'
            : !row.pilot_approved
              ? 'PILOT_APPROVAL_REQUIRED'
              : !row.published_knowledge_ready || !row.assistant_configured
                ? 'AI_SETUP_INCOMPLETE'
                : 'BUSINESS_OR_CONNECTION_INACTIVE',
      );
      this.log(
        humanTakeover || row.has_newer_inbound
          ? 'AI_RESPONSE_SUPPRESSED'
          : 'AI_HANDOFF_REQUIRED',
        row,
      );
      return;
    }

    let evidence: EvidenceItem[] = [];
    const configuredAssistant = await this.loadAssistantPreferences(
      row.business_id,
    );
    const fallbackMessage =
      configuredAssistant.fallbackResponse || aiConfig().handoffMessage;
    let reply = row.reply;
    let status: 'GENERATED' | 'HANDOFF_REQUIRED' =
      row.status === 'GENERATED' && row.error_category
        ? 'HANDOFF_REQUIRED'
        : 'GENERATED';
    let errorCategory: string | null = row.error_category;
    if (row.status !== 'GENERATED') {
      let memory: Awaited<ReturnType<ConversationMemoryService['prepare']>>;
      try {
        memory = this.memory
          ? await this.memory.prepare(runId)
          : {
              history: [],
              conversationVersion: String(row.control_version),
            };
      } catch {
        await this.finish(row, 'SKIPPED', 'NEWER_CUSTOMER_TURN');
        this.log('AI_RESPONSE_SUPPRESSED', row, 'NEWER_CUSTOMER_TURN');
        return;
      }
      const retrievalQuery = this.retrievalQuery(row.customer_message, memory);
      const retrieval = await this.retrieval.retrieve({
        businessId: row.business_id,
        query: retrievalQuery,
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
      const possibleOfferSearch =
        /\b(price|cost|product|service|offer|stock|available|how much|do you sell|buy)\b/i.test(
          row.customer_message,
        );
      if (!retrieval.sufficientEvidence && !possibleOfferSearch) {
        status = 'HANDOFF_REQUIRED';
        errorCategory = retrieval.reason ?? 'INSUFFICIENT_EVIDENCE';
        reply = fallbackMessage;
      } else if (!this.isAuthorized(await this.load(runId, row.business_id))) {
        await this.finish(row, 'SKIPPED', 'STALE_CONVERSATION');
        this.log('AI_RESPONSE_SUPPRESSED', row, 'STALE_CONVERSATION');
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
                memory.history.reduce(
                  (sum, turn) => sum + turn.content.length,
                  0,
                ) +
                (memory.summary?.length ?? 0) +
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
          const qualificationFields =
            row.lead_id && this.tools
              ? await this.tools.qualificationFields(runId)
              : [];
          const generated = await this.model.generate({
            message: row.customer_message,
            history: memory.history,
            conversationSummary: memory.summary,
            assistant: configuredAssistant,
            approvedTools: agentToolRegistry.map(
              ({ name, version, description, input }) => ({
                name,
                version,
                description,
                input,
              }),
            ),
            qualificationFields,
            maxOutputTokens: outputBudget,
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
          let toolResult: Awaited<
            ReturnType<AgentToolExecutor['execute']>
          > | null = null;
          if (generated.toolCall !== undefined) {
            try {
              if (!this.tools) throw new Error('Agent tools are unavailable.');
              toolResult = await this.tools.execute(generated.toolCall, {
                businessId: row.business_id,
                conversationId: row.conversation_id,
                aiRunId: row.id,
                leadId: row.lead_id,
                customerMessage: row.customer_message,
              });
            } catch {
              toolResult = {
                toolName: 'search_published_offers',
                classification: 'UNAVAILABLE',
                result: {
                  reason: 'The requested tool could not be completed.',
                },
              };
            }
            if (
              toolResult.toolName === 'request_human_handoff' &&
              ['HANDOFF', 'ALREADY_HUMAN'].includes(toolResult.classification)
            ) {
              this.log('AI_TOOL_HANDOFF', row, toolResult.classification);
              return;
            }
            if (
              [
                'UNKNOWN_TOOL',
                'INVALID_ARGUMENTS',
                'REJECTED',
                'CONFLICT',
                'UNAVAILABLE',
              ].includes(toolResult.classification)
            ) {
              status = 'HANDOFF_REQUIRED';
              errorCategory = `TOOL_${toolResult.classification}`;
              reply = fallbackMessage;
            } else if (toolResult.toolName === 'record_lead_qualification') {
              if (
                ['REJECTED', 'CONFLICT', 'UNAVAILABLE'].includes(
                  toolResult.classification,
                )
              ) {
                status = 'HANDOFF_REQUIRED';
                errorCategory = `TOOL_${toolResult.classification}`;
                reply = fallbackMessage;
              } else if (toolResult.classification === 'CONSENT_REQUIRED') {
                status = 'HANDOFF_REQUIRED';
                errorCategory = 'TOOL_CONSENT_REQUIRED';
                reply = fallbackMessage;
              } else {
                const ids = Array.isArray(toolResult.result.missingFieldIds)
                  ? toolResult.result.missingFieldIds.map(String)
                  : [];
                const requiredLabels = qualificationFields
                  .filter((field) => ids.includes(String(field.id)))
                  .map((field) => String(field.label));
                status = 'GENERATED';
                reply = requiredLabels.length
                  ? `Thanks. To help with that, could you share ${requiredLabels.join(' and ')}?`
                  : 'Thanks, I’ve noted those details for the team. Is there anything else you would like to know?';
                errorCategory = null;
              }
            } else {
              const sources = toolResult.evidence ?? [];
              evidence = [
                ...evidence.filter(
                  (item) =>
                    !sources.some((source) => source.id === item.sourceId),
                ),
                ...sources.map((item) => ({
                  sourceType: 'PRODUCT' as const,
                  sourceId: item.id,
                  revisionId: item.revisionId,
                  relevanceScore: 1,
                  title: item.title,
                  content: item.content,
                  facts: {
                    ...item.facts,
                    availability: item.facts.availability as
                      'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN',
                  },
                })),
              ];
              if (
                ['REJECTED', 'CONFLICT', 'UNAVAILABLE'].includes(
                  toolResult.classification,
                )
              ) {
                status = 'HANDOFF_REQUIRED';
                errorCategory = `TOOL_${toolResult.classification}`;
                reply = fallbackMessage;
              } else {
                const validation = validateGroundedResponse(
                  generated,
                  evidence,
                );
                if (validation.valid) reply = generated.reply.trim();
                else {
                  status = 'HANDOFF_REQUIRED';
                  errorCategory = validation.reason;
                  reply = fallbackMessage;
                  this.log('AI_RESPONSE_REJECTED', row, validation.reason);
                }
              }
            }
          } else {
            const validation = validateGroundedResponse(generated, evidence);
            if (validation.valid) reply = generated.reply.trim();
            else {
              status = 'HANDOFF_REQUIRED';
              errorCategory = validation.reason;
              reply = fallbackMessage;
              this.log('AI_RESPONSE_REJECTED', row, validation.reason);
            }
          }
          if (
            status === 'GENERATED' &&
            evidence.length > 0 &&
            !(await this.evidenceIsCurrent(row.business_id, evidence))
          ) {
            status = 'HANDOFF_REQUIRED';
            errorCategory = 'PUBLISHED_EVIDENCE_CHANGED';
            reply = fallbackMessage;
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
      if (
        error instanceof OutboundPolicyError &&
        error.reason === 'NEWER_CUSTOMER_TURN'
      ) {
        await this.database.query(
          `UPDATE public.ai_response_runs SET status='SKIPPED',error_category='NEWER_CUSTOMER_TURN',
            updated_at=now(),completed_at=now() WHERE id=$1 AND business_id=$2 AND status='GENERATED'`,
          [runId, row.business_id],
        );
        this.log('AI_RESPONSE_SUPPRESSED', row, 'NEWER_CUSTOMER_TURN');
        return;
      }
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
        a.authorized_control_version,a.status,a.error_category,a.evidence,a.reply,m.content AS customer_message,
        c."whatsappId" AS recipient,v.control_mode,v.control_version,b.status AS business_status,
        ch.status AS connection_status,ch."verifiedAt" AS verified_at,
        EXISTS (SELECT 1 FROM public.business_pilot_enrollments p
          WHERE p.business_id=a.business_id AND p.connection_id=ch.id AND p.status='ACTIVE') AS pilot_approved,
        EXISTS (SELECT 1 FROM public.messages newer
          WHERE newer."businessId"=a.business_id AND newer."conversationId"=a.conversation_id
            AND newer.direction='inbound' AND (newer."createdAt",newer.id)>(m."createdAt",m.id)) AS has_newer_inbound,
        (EXISTS (SELECT 1 FROM public.knowledge_faqs f
          WHERE f.business_id=a.business_id AND f.published_revision_id IS NOT NULL)
          OR EXISTS (SELECT 1 FROM public.merchant_products p
          WHERE p.business_id=a.business_id AND p.published_revision_id IS NOT NULL)) AS published_knowledge_ready,
        EXISTS (SELECT 1 FROM public.assistant_configurations ac WHERE ac.business_id=a.business_id) AS assistant_configured
       FROM public.ai_response_runs a JOIN public.messages m ON m.id=a.inbound_message_id AND m."businessId"=a.business_id
       JOIN public.conversations v ON v.id=a.conversation_id AND v."businessId"=a.business_id
       JOIN public.customers c ON c.id=v."customerId" AND c."businessId"=a.business_id
       JOIN public.businesses b ON b.id=a.business_id
       JOIN LATERAL (SELECT id,status,"verifiedAt" FROM public.channel_connections WHERE "businessId"=a.business_id
         AND provider='whatsapp' ORDER BY "updatedAt" DESC LIMIT 1) ch ON true
       WHERE a.id=$1 AND a.business_id=$2`,
      [id, businessId],
    );
    if (!row) return null;
    return row;
  }

  private async loadAssistantPreferences(
    businessId: string,
  ): Promise<AssistantPreferences> {
    const [row] = await this.database.query<
      Array<{
        assistant_name: string;
        greeting: string;
        tone: AssistantPreferences['tone'];
        language: AssistantPreferences['language'];
        response_length: AssistantPreferences['responseLength'];
        handoff_behavior: AssistantPreferences['handoffBehavior'];
        fallback_response: string;
      }>
    >('SELECT * FROM public.kleva_assistant_config_for_runtime($1)', [
      businessId,
    ]);
    if (!row)
      return {
        ...defaultAssistantPreferences,
        fallbackResponse: aiConfig().handoffMessage,
      };
    return {
      assistantName: row.assistant_name,
      greeting: row.greeting,
      tone: row.tone,
      language: row.language,
      responseLength: row.response_length,
      handoffBehavior: row.handoff_behavior,
      fallbackResponse: row.fallback_response,
    };
  }

  private isAuthorized(row: RunRow | null): boolean {
    return Boolean(
      row &&
      row.business_status === 'active' &&
      row.connection_status === 'active' &&
      row.verified_at &&
      row.pilot_approved === true &&
      row.has_newer_inbound !== true &&
      row.published_knowledge_ready === true &&
      row.assistant_configured === true &&
      row.control_mode === 'AUTO' &&
      String(row.control_version) === String(row.authorized_control_version),
    );
  }

  private retrievalQuery(
    currentMessage: string,
    memory: Awaited<ReturnType<ConversationMemoryService['prepare']>>,
  ) {
    return [
      ...(memory.summary ? [memory.summary] : []),
      ...memory.history.slice(-4).map((turn) => turn.content),
      currentMessage,
    ]
      .join('\n')
      .slice(-1200);
  }

  private async evidenceIsCurrent(
    businessId: string,
    evidence: EvidenceItem[],
  ) {
    for (const item of evidence) {
      const query =
        item.sourceType === 'FAQ'
          ? `SELECT EXISTS (SELECT 1 FROM public.knowledge_faqs f
              WHERE f.business_id=$1 AND f.id=$2 AND f.published_revision_id=$3) AS current`
          : `SELECT EXISTS (SELECT 1 FROM public.merchant_products p
              WHERE p.business_id=$1 AND p.id=$2 AND p.published_revision_id=$3) AS current`;
      const [row] = await this.database.query<{ current: boolean }[]>(query, [
        businessId,
        item.sourceId,
        item.revisionId,
      ]);
      if (row?.current !== true) return false;
    }
    return true;
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
