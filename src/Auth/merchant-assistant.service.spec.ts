import type { EntityManager } from 'typeorm';
import { ForbiddenException } from '@nestjs/common';
import { MerchantAssistantService } from './merchant-assistant.service';
import type { MerchantAccess } from './merchant-access.service';
import type { MerchantPrincipal } from './auth.service';
import type {
  UnifiedKnowledgeRetrievalService,
  EvidenceItem,
} from '../knowledge/unified-knowledge-retrieval.service';
import type { UsageService } from '../metering/usage.service';
import { UsageLimitExceededError } from '../metering/usage.service';
import type {
  GroundedModel,
  GroundedModelResponse,
} from '../assistant/grounded-model.provider';

const businessId = '10000000-0000-4000-8000-000000000001';
const actor = {
  accountId: '20000000-0000-4000-8000-000000000001',
  sessionDigest: 'session-digest',
} as MerchantPrincipal;
const evidence: EvidenceItem = {
  sourceType: 'PRODUCT',
  sourceId: '30000000-0000-4000-8000-000000000001',
  revisionId: '40000000-0000-4000-8000-000000000001',
  relevanceScore: 1,
  title: 'Standing fan',
  content: 'The standing fan includes a remote control.',
  facts: { price: '25000.00', currency: 'NGN', availability: 'IN_STOCK' },
};
const response = (
  overrides: Partial<GroundedModelResponse> = {},
): GroundedModelResponse => ({
  reply: 'The standing fan includes a remote control.',
  evidenceIds: [evidence.sourceId],
  canAnswer: true,
  needsHuman: false,
  inputTokens: 120,
  outputTokens: 14,
  ...overrides,
});

describe('MerchantAssistantService', () => {
  let service: MerchantAssistantService;
  let withBusiness: jest.Mock;
  let queries: string[];
  let modelGenerate: jest.Mock;
  let reserve: jest.Mock;
  let commit: jest.Mock;
  let enoughEvidence: boolean;

  beforeEach(() => {
    queries = [];
    const row = {
      business_id: businessId,
      version: 2,
      assistant_name: 'Store Guide',
      greeting: 'Welcome.',
      tone: 'FRIENDLY',
      language: 'NIGERIAN_PIDGIN',
      response_length: 'BALANCED',
      handoff_behavior: 'OFFER_HUMAN',
      fallback_response: 'A teammate can help with that.',
      updated_at: null,
    };
    const manager = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        queries.push(sql);
        if (sql.includes('kleva_assistant_config_read')) return [row];
        if (sql.includes('kleva_assistant_config_save')) {
          const input = JSON.parse(String(params?.[1])) as Record<
            string,
            unknown
          >;
          return [
            {
              ...row,
              ...{
                version: Number(input.revision) + 1,
                assistant_name: input.assistantName,
                greeting: input.greeting,
                tone: input.tone,
                language: input.language,
                response_length: input.responseLength,
                handoff_behavior: input.handoffBehavior,
                fallback_response: input.fallbackResponse,
              },
            },
          ];
        }
        if (sql.includes('kleva_ai_playground_admit'))
          return [{ admitted: true }];
        if (sql.includes('kleva_ai_playground_finish'))
          return [{ finished: true }];
        return [];
      }),
    } as unknown as EntityManager;
    withBusiness = jest.fn(
      async (
        _actor: unknown,
        currentBusinessId: string,
        _permission: unknown,
        operation: unknown,
      ) => {
        const run = operation as (
          manager: EntityManager,
          membership: { businessId: string; role: 'owner' },
        ) => Promise<unknown>;
        return run(manager, { businessId: currentBusinessId, role: 'owner' });
      },
    );
    const access = { withBusiness } as unknown as MerchantAccess;
    enoughEvidence = true;
    const retrieval = {
      retrieve: jest.fn(async () =>
        enoughEvidence
          ? { sufficientEvidence: true, evidence: [evidence] }
          : { sufficientEvidence: false, evidence: [], reason: 'NO_MATCH' },
      ),
    } as unknown as UnifiedKnowledgeRetrievalService;
    reserve = jest.fn().mockResolvedValue(undefined);
    commit = jest.fn().mockResolvedValue(undefined);
    const usage = {
      reserveAiTokens: reserve,
      commitAiTokens: commit,
    } as unknown as UsageService;
    modelGenerate = jest.fn(async () => response());
    const model = { generate: modelGenerate } as unknown as GroundedModel;
    service = new MerchantAssistantService(access, retrieval, usage, model);
  });

  it('reads defaults through the tenant authorization boundary and uses owner/editor assistant permission', async () => {
    await service.getConfiguration(actor, businessId);
    expect(withBusiness).toHaveBeenCalledWith(
      actor,
      businessId,
      'assistant.manage',
      expect.any(Function),
    );
    expect(queries[0]).toContain('kleva_assistant_config_read');
  });

  it('saves versioned preferences and rejects out-of-range or unknown settings', async () => {
    const config = await service.updateConfiguration(actor, businessId, {
      revision: 2,
      assistantName: 'Store Guide',
      greeting: 'Welcome.',
      tone: 'CASUAL',
      language: 'NIGERIAN_PIDGIN',
      responseLength: 'SHORT',
      handoffBehavior: 'OFFER_HUMAN',
      fallbackResponse: 'Please check with our team.',
    });
    expect(config.revision).toBe(3);
    expect(config.language).toBe('NIGERIAN_PIDGIN');
    await expect(
      service.updateConfiguration(actor, businessId, {
        revision: 2,
        assistantName: 'x',
        greeting: 'x',
        tone: 'CASUAL',
        language: 'ENGLISH',
        responseLength: 'SHORT',
        handoffBehavior: 'OFFER_HUMAN',
        fallbackResponse: 'x',
        unexpected: true,
      }),
    ).rejects.toThrow('unexpected or missing fields');
  });

  it('returns only validated cited published sources and meters a synthetic answer', async () => {
    const result = await service.testMessage(actor, businessId, {
      message: 'How much is the standing fan?',
      history: [{ role: 'customer', content: 'I need a fan.' }],
    });
    expect(result).toMatchObject({
      outcome: 'ANSWERED',
      tokenUsage: { input: 120, output: 14, kind: 'ACTUAL' },
      handoffRecommended: false,
    });
    expect(result.sources).toEqual([
      {
        id: evidence.sourceId,
        revisionId: evidence.revisionId,
        type: 'PRODUCT',
        title: evidence.title,
        excerpt: evidence.content,
        retrievalMethod: 'LEXICAL',
      },
    ]);
    expect(modelGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        playground: true,
        history: [{ role: 'customer', content: 'I need a fan.' }],
      }),
    );
    expect(reserve).toHaveBeenCalledWith(
      businessId,
      expect.stringMatching(/^playground:/),
      expect.any(Number),
      300,
    );
    expect(commit).toHaveBeenCalledWith(
      businessId,
      expect.stringMatching(/^playground:/),
      120,
      14,
    );
    expect(queries.every((sql) => sql.includes('kleva_'))).toBe(true);
    expect(queries.join(' ')).not.toMatch(
      /INSERT INTO public\.(messages|customers|merchant_leads|whatsapp_outbound_messages)/i,
    );
  });

  it('returns an exact published product price with its supporting citation', async () => {
    modelGenerate.mockResolvedValue(
      response({ reply: 'The standing fan costs NGN 25,000.00.' }),
    );
    const result = await service.testMessage(actor, businessId, {
      message: 'How much is the standing fan?',
    });
    expect(result).toMatchObject({
      outcome: 'ANSWERED',
      reply: 'The standing fan costs NGN 25,000.00.',
      sources: [{ id: evidence.sourceId, type: 'PRODUCT' }],
    });
  });

  it('fails closed on an invalid model response without returning citations', async () => {
    modelGenerate.mockResolvedValue({
      reply: 'A discounted price is available.',
      evidenceIds: ['unretrieved-private-id'],
      canAnswer: true,
    });
    const result = await service.testMessage(actor, businessId, {
      message: 'Can you offer a discount?',
    });
    expect(result).toMatchObject({
      outcome: 'PROVIDER_FAILURE',
      reply: 'A teammate can help with that.',
      sources: [],
      handoffRecommended: true,
    });
  });

  it('abstains without provider usage when published knowledge is insufficient', async () => {
    enoughEvidence = false;
    const result = await service.testMessage(actor, businessId, {
      message: 'What discount can I get?',
    });
    expect(result).toMatchObject({
      outcome: 'INSUFFICIENT_EVIDENCE',
      reply: 'A teammate can help with that.',
      sources: [],
      handoffRecommended: true,
    });
    expect(modelGenerate).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it('uses a safe Nigerian Pidgin clarification for a model clarification outcome', async () => {
    modelGenerate.mockResolvedValue(
      response({
        canAnswer: false,
        needsHuman: false,
        reply: 'untrusted output',
      }),
    );
    const result = await service.testMessage(actor, businessId, {
      message: 'Una dey deliver reach Ikeja?',
    });
    expect(result.outcome).toBe('CLARIFICATION');
    expect(result.reply).toContain('Abeg');
    expect(result.sources).toEqual([]);
    expect(result.handoffRecommended).toBe(false);
  });

  it('uses the configured fallback on provider timeout and reports conservatively estimated usage', async () => {
    modelGenerate.mockRejectedValue(
      new Error('provider timeout with private details'),
    );
    const result = await service.testMessage(actor, businessId, {
      message: 'Is delivery available?',
    });
    expect(result).toMatchObject({
      outcome: 'PROVIDER_FAILURE',
      reply: 'A teammate can help with that.',
      tokenUsage: { kind: 'ESTIMATED' },
      handoffRecommended: true,
    });
    expect(commit).toHaveBeenCalledWith(
      businessId,
      expect.stringMatching(/^playground:/),
    );
  });

  it('fails closed when a member has no assistant permission', async () => {
    withBusiness.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      service.getConfiguration(actor, businessId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns a safe handoff when the per-request token allowance is exhausted', async () => {
    reserve.mockRejectedValue(new UsageLimitExceededError('ai_input_tokens'));
    const result = await service.testMessage(actor, businessId, {
      message: 'How much is the standing fan?',
    });
    expect(result).toMatchObject({
      outcome: 'HANDOFF',
      reply: 'A teammate can help with that.',
      handoffRecommended: true,
    });
    expect(modelGenerate).not.toHaveBeenCalled();
  });
});
