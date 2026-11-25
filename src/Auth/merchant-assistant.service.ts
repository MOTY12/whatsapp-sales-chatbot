import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { MerchantAccess } from './merchant-access.service';
import type { MerchantPrincipal } from './auth.service';
import {
  UsageLimitExceededError,
  UsageService,
} from '../metering/usage.service';
import {
  UnifiedKnowledgeRetrievalService,
  type EvidenceItem,
} from '../knowledge/unified-knowledge-retrieval.service';
import {
  GROUNDED_MODEL,
  ModelResponseError,
  type GroundedModel,
} from '../assistant/grounded-model.provider';
import { validateGroundedResponse } from '../assistant/grounded-response.validator';
import type { GroundedModelResponse } from '../assistant/grounded-model.provider';
import {
  type AssistantConfiguration,
  type AssistantHandoffBehavior,
  type AssistantLanguage,
  type AssistantPreferences,
  type AssistantResponseLength,
  type AssistantTone,
  type PlaygroundMessage,
  type PlaygroundOutcome,
  type PlaygroundResult,
  type PlaygroundSource,
} from '../assistant/assistant-preferences';
import { AgentToolExecutor } from '../agent-tools/agent-tool-executor.service';
import { agentToolRegistry } from '../agent-tools/tool-registry';

type ConfigurationRow = {
  business_id: string;
  version: number | string;
  assistant_name: string;
  greeting: string;
  tone: AssistantTone;
  language: AssistantLanguage;
  response_length: AssistantResponseLength;
  handoff_behavior: AssistantHandoffBehavior;
  fallback_response: string;
  updated_at: Date | string | null;
};

type PlaygroundInput = { message: string; history: PlaygroundMessage[] };
const configKeys = [
  'revision',
  'assistantName',
  'greeting',
  'tone',
  'language',
  'responseLength',
  'handoffBehavior',
  'fallbackResponse',
];

function isModelResponse(value: unknown): value is GroundedModelResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const response = value as Partial<GroundedModelResponse>;
  return (
    typeof response.reply === 'string' &&
    Array.isArray(response.evidenceIds) &&
    response.evidenceIds.every((id) => typeof id === 'string') &&
    typeof response.canAnswer === 'boolean' &&
    typeof response.needsHuman === 'boolean' &&
    Number.isSafeInteger(response.inputTokens) &&
    Number(response.inputTokens) >= 0 &&
    Number(response.inputTokens) <= 3600 &&
    Number.isSafeInteger(response.outputTokens) &&
    Number(response.outputTokens) >= 0 &&
    Number(response.outputTokens) <= 300
  );
}

function mapConfiguration(row: ConfigurationRow): AssistantConfiguration {
  return {
    businessId: row.business_id,
    revision: Number(row.version),
    assistantName: row.assistant_name,
    greeting: row.greeting,
    tone: row.tone,
    language: row.language,
    responseLength: row.response_length,
    handoffBehavior: row.handoff_behavior,
    fallbackResponse: row.fallback_response,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function validateConfiguration(
  body: unknown,
): AssistantConfiguration & AssistantPreferences {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Expected assistant settings.');
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !configKeys.includes(key)) ||
    configKeys.some((key) => !(key in input))
  )
    throw new BadRequestException(
      'Assistant settings contain unexpected or missing fields.',
    );
  const boundedText = (key: string, max: number) => {
    const value = input[key];
    if (
      typeof value !== 'string' ||
      value.includes('\0') ||
      !value.trim() ||
      value.trim().length > max
    )
      throw new BadRequestException(
        `Assistant ${key} must be between 1 and ${max} characters.`,
      );
    return value.trim();
  };
  const revision = input.revision;
  if (!Number.isSafeInteger(revision) || Number(revision) < 0)
    throw new BadRequestException(
      'A valid assistant settings revision is required.',
    );
  if (
    !['PROFESSIONAL', 'FRIENDLY', 'CASUAL'].includes(String(input.tone)) ||
    !['ENGLISH', 'NIGERIAN_PIDGIN'].includes(String(input.language)) ||
    !['SHORT', 'BALANCED', 'DETAILED'].includes(String(input.responseLength)) ||
    !['OFFER_HUMAN', 'PRIORITIZE_HUMAN'].includes(String(input.handoffBehavior))
  )
    throw new BadRequestException('Choose a supported assistant preference.');
  return {
    businessId: '',
    revision: Number(revision),
    assistantName: boundedText('assistantName', 80),
    greeting: boundedText('greeting', 300),
    tone: input.tone as AssistantTone,
    language: input.language as AssistantLanguage,
    responseLength: input.responseLength as AssistantResponseLength,
    handoffBehavior: input.handoffBehavior as AssistantHandoffBehavior,
    fallbackResponse: boundedText('fallbackResponse', 500),
    updatedAt: null,
  };
}

function validatePlayground(body: unknown): PlaygroundInput {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Expected a playground message.');
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !['message', 'history'].includes(key)) ||
    typeof input.message !== 'string'
  )
    throw new BadRequestException('Playground message is invalid.');
  const message = input.message.trim();
  if (!message || message.includes('\0') || message.length > 1000)
    throw new BadRequestException(
      'Keep the test message between 1 and 1000 characters.',
    );
  const rawHistory = input.history ?? [];
  if (!Array.isArray(rawHistory) || rawHistory.length > 6)
    throw new BadRequestException(
      'Playground history is limited to the last six turns.',
    );
  let historySize = 0;
  const history = rawHistory.map((item): PlaygroundMessage => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new BadRequestException('Playground history is invalid.');
    const turn = item as Record<string, unknown>;
    if (
      Object.keys(turn).some((key) => !['role', 'content'].includes(key)) ||
      !['customer', 'assistant'].includes(String(turn.role)) ||
      typeof turn.content !== 'string' ||
      !turn.content.trim() ||
      turn.content.includes('\0') ||
      turn.content.length > 500
    )
      throw new BadRequestException(
        'Each playground turn must be plain text under 500 characters.',
      );
    historySize += turn.content.length;
    return {
      role: turn.role as PlaygroundMessage['role'],
      content: turn.content.trim(),
    };
  });
  if (historySize > 2000)
    throw new BadRequestException('Playground history is too long.');
  return { message, history };
}

async function readConfiguration(manager: EntityManager) {
  const [row] = await safeQuery<ConfigurationRow[]>(
    manager,
    'SELECT * FROM public.kleva_assistant_config_read()',
  );
  if (!row) throw new Error('Assistant configuration result was empty.');
  return mapConfiguration(row);
}

async function safeQuery<T>(
  manager: EntityManager,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  try {
    return await manager.query<T>(sql, params);
  } catch (error) {
    const code = (error as { driverError?: { code?: string } }).driverError
      ?.code;
    if (code === '40001' || code === '23505')
      throw new ConflictException(
        'Assistant settings changed. Refresh and try again.',
      );
    if (code === '42501') throw new ForbiddenException();
    if (code === '22023')
      throw new BadRequestException('Assistant request is invalid.');
    throw error;
  }
}

@Injectable()
export class MerchantAssistantService {
  constructor(
    private readonly access: MerchantAccess,
    private readonly retrieval: UnifiedKnowledgeRetrievalService,
    private readonly usage: UsageService,
    @Inject(GROUNDED_MODEL) private readonly model: GroundedModel,
    @Optional() private readonly tools?: AgentToolExecutor,
  ) {}

  getConfiguration(actor: MerchantPrincipal, businessId: string) {
    return this.access.withBusiness(
      actor,
      businessId,
      'assistant.manage',
      readConfiguration,
    );
  }

  async updateConfiguration(
    actor: MerchantPrincipal,
    businessId: string,
    body: unknown,
  ) {
    const config = validateConfiguration(body);
    return this.access.withBusiness(
      actor,
      businessId,
      'assistant.manage',
      async (manager) => {
        const [row] = await safeQuery<ConfigurationRow[]>(
          manager,
          'SELECT * FROM public.kleva_assistant_config_save($1,$2::jsonb)',
          [
            config.revision,
            JSON.stringify({
              revision: config.revision,
              assistantName: config.assistantName,
              greeting: config.greeting,
              tone: config.tone,
              language: config.language,
              responseLength: config.responseLength,
              handoffBehavior: config.handoffBehavior,
              fallbackResponse: config.fallbackResponse,
            }),
          ],
        );
        if (!row)
          throw new Error('Assistant configuration save returned no row.');
        return mapConfiguration(row);
      },
    );
  }

  async testMessage(
    actor: MerchantPrincipal,
    businessId: string,
    body: unknown,
  ): Promise<PlaygroundResult> {
    const input = validatePlayground(body);
    const requestId = randomUUID();
    const admitted = await this.access.withBusiness(
      actor,
      businessId,
      'assistant.manage',
      async (manager) => {
        const configuration = await readConfiguration(manager);
        const [policy] = await safeQuery<
          Array<{ fields: Array<Record<string, unknown>> }>
        >(manager, 'SELECT * FROM public.kleva_sales_policy_read()');
        const [result] = await safeQuery<{ admitted: boolean }[]>(
          manager,
          'SELECT public.kleva_ai_playground_admit($1) AS admitted',
          [requestId],
        );
        return {
          configuration,
          qualificationFields: policy?.fields ?? [],
          admitted: result?.admitted === true,
        };
      },
    );
    if (!admitted.admitted)
      throw new HttpException(
        'Playground limit reached. Try again in an hour.',
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const started = Date.now();
    const requestKey = `playground:${requestId}`;
    let reserved = false;
    let reservationEstimate = { input: 0, output: 0 };
    let tokens: PlaygroundResult['tokenUsage'] = {
      input: 0,
      output: 0,
      kind: 'ACTUAL',
    };
    let outcome: PlaygroundOutcome = 'PROVIDER_FAILURE';
    let reply = admitted.configuration.fallbackResponse;
    let sources: PlaygroundSource[] = [];
    const toolExecutions: PlaygroundResult['toolExecutions'] = [];
    let handoffRecommended = true;
    try {
      const retrieval = await this.retrieval.retrieve({
        businessId,
        query: input.message.slice(0, 256),
        limit: 5,
        purpose: 'playground',
        requestId,
        semanticQuery: input.message,
      });
      if (!retrieval.sufficientEvidence) {
        outcome = 'INSUFFICIENT_EVIDENCE';
      } else {
        const estimatedInput = Math.min(
          3600,
          Math.max(
            64,
            Math.ceil(
              (input.message.length +
                input.history.reduce(
                  (sum, turn) => sum + turn.content.length,
                  0,
                ) +
                retrieval.evidence.reduce(
                  (sum, item) => sum + item.title.length + item.content.length,
                  0,
                ) +
                1600) /
                3,
            ),
          ),
        );
        await this.usage.reserveAiTokens(
          businessId,
          requestKey,
          estimatedInput,
          300,
        );
        reserved = true;
        reservationEstimate = { input: estimatedInput, output: 300 };
        const generated: unknown = await this.model.generate({
          playground: true,
          message: input.message,
          history: input.history,
          assistant: admitted.configuration,
          approvedTools: agentToolRegistry.map(
            ({ name, version, description, input: toolInput }) => ({
              name,
              version,
              description,
              input: toolInput,
            }),
          ),
          qualificationFields: admitted.qualificationFields,
          evidence: retrieval.evidence.map((item) => ({
            id: item.sourceId,
            revisionId: item.revisionId,
            type: item.sourceType,
            title: item.title,
            content: item.content,
            pageNumber: item.pageNumber,
            facts: item.facts,
          })),
        });
        if (!isModelResponse(generated)) {
          await this.usage.commitAiTokens(businessId, requestKey);
          reserved = false;
          tokens = { ...reservationEstimate, kind: 'ESTIMATED' };
          outcome = 'PROVIDER_FAILURE';
        } else {
          if (generated.toolCall !== undefined) {
            toolExecutions.push(
              this.tools
                ? this.tools.simulate(generated.toolCall, {
                    businessId,
                    message: input.message,
                    evidence: retrieval.evidence,
                    fields: admitted.qualificationFields,
                  })
                : {
                    requestedTool: 'unknown',
                    validation: 'REJECTED',
                    simulatedOutcome: 'SIMULATOR_UNAVAILABLE',
                    sideEffects: false,
                  },
            );
          }
          await this.usage.commitAiTokens(
            businessId,
            requestKey,
            generated.inputTokens,
            generated.outputTokens,
          );
          reserved = false;
          tokens = {
            input: generated.inputTokens,
            output: generated.outputTokens,
            kind: 'ACTUAL',
          };

          if (!generated.canAnswer) {
            if (generated.needsHuman) {
              outcome = 'HANDOFF';
            } else {
              outcome = 'CLARIFICATION';
              reply =
                admitted.configuration.language === 'NIGERIAN_PIDGIN'
                  ? 'Abeg, fit you share small more detail make I check the correct information?'
                  : 'Could you share a little more detail so I can check the right information?';
              handoffRecommended = false;
            }
          } else {
            const validation = validateGroundedResponse(
              generated,
              retrieval.evidence,
            );
            if (validation.valid) {
              outcome = 'ANSWERED';
              reply = generated.reply.trim();
              const byId = new Map(
                retrieval.evidence.map((item) => [item.sourceId, item]),
              );
              sources = generated.evidenceIds
                .map((id) => byId.get(id))
                .filter((item): item is EvidenceItem => !!item)
                .map((item) => ({
                  id: item.sourceId,
                  revisionId: item.revisionId,
                  type: item.sourceType,
                  retrievalMethod: item.retrievalMethod ?? 'LEXICAL',
                  title: item.title,
                  excerpt: item.content.slice(0, 400),
                  ...(item.pageNumber ? { pageNumber: item.pageNumber } : {}),
                }));
              handoffRecommended = false;
            } else if (
              validation.reason === 'MALFORMED_REPLY' ||
              validation.reason === 'INVALID_EVIDENCE_REFERENCE'
            ) {
              outcome = 'PROVIDER_FAILURE';
            } else if (validation.reason === 'MODEL_ABSTAINED') {
              outcome = 'HANDOFF';
            } else {
              outcome = 'INSUFFICIENT_EVIDENCE';
            }
          }
        }
      }
    } catch (error) {
      if (reserved) {
        await this.usage
          .commitAiTokens(businessId, requestKey)
          .catch(() => undefined);
        tokens = { ...reservationEstimate, kind: 'ESTIMATED' };
        reserved = false;
      }
      if (error instanceof UsageLimitExceededError) outcome = 'HANDOFF';
      else if (error instanceof ModelResponseError)
        outcome = 'PROVIDER_FAILURE';
      else outcome = 'PROVIDER_FAILURE';
      reply = admitted.configuration.fallbackResponse;
      sources = [];
      handoffRecommended = true;
    }

    const durationMs = Math.min(30000, Math.max(0, Date.now() - started));
    await this.access.withBusiness(
      actor,
      businessId,
      'assistant.manage',
      async (manager) => {
        const [finished] = await safeQuery<{ finished: boolean }[]>(
          manager,
          'SELECT public.kleva_ai_playground_finish($1,$2,$3,$4,$5) AS finished',
          [requestId, outcome, tokens.input, tokens.output, durationMs],
        );
        if (finished?.finished !== true)
          throw new Error('Playground usage record could not be finalized.');
      },
    );
    return {
      reply,
      outcome,
      sources,
      tokenUsage: tokens,
      durationMs,
      handoffRecommended,
      toolExecutions,
    };
  }
}
