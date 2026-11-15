import type { DataSource, QueryRunner } from 'typeorm';
import { AiResponseService } from './ai-response.service';
import { FakeGroundedModel } from './grounded-model.provider';
import type { OutboxOperation } from '../database/entities/outbox-operation.entity';
import type { EvidenceItem } from '../knowledge/unified-knowledge-retrieval.service';

const evidence: EvidenceItem = {
  sourceType: 'PRODUCT',
  sourceId: 'a2000000-0000-4000-8000-000000000001',
  revisionId: 'a2000000-0000-4000-8000-000000000002',
  relevanceScore: 1,
  title: 'Standing fan',
  content: 'Quiet standing fan with remote control.',
  facts: { price: '25000.00', currency: 'NGN', availability: 'IN_STOCK' },
};
const initial = () => ({
  id: 'a3000000-0000-4000-8000-000000000001',
  business_id: 'a1000000-0000-4000-8000-000000000001',
  inbound_message_id: 'a4000000-0000-4000-8000-000000000001',
  conversation_id: 'a5000000-0000-4000-8000-000000000001',
  lead_id: 'a6000000-0000-4000-8000-000000000001',
  authorized_control_version: '1',
  status: 'PENDING',
  evidence: [],
  reply: null,
  recipient: '2348012345678',
  customer_message: 'What is the price of the standing fan?',
  control_mode: 'AUTO',
  control_version: '1',
  business_status: 'active',
  connection_status: 'active',
  verified_at: new Date(),
});

describe('AiResponseService', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    jest.replaceProperty(process, 'env', {
      ...originalEnv,
      AI_RESPONSES_ENABLED: 'true',
      OPENAI_API_KEY: 'test-key',
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function fixture(
    options: { takeoverDuringGeneration?: boolean; sufficient?: boolean } = {},
  ) {
    const state = initial();
    let loads = 0;
    const database = {
      async query(sql: string, parameters?: unknown[]) {
        if (sql.includes('SELECT a.id')) {
          loads += 1;
          const row = { ...state };
          if (options.takeoverDuringGeneration && loads >= 4) {
            row.control_mode = 'HUMAN';
            row.control_version = '2';
          }
          return [row];
        }
        if (sql.includes("SET status = 'GENERATED'")) {
          state.status = 'GENERATED';
          state.reply = String(parameters?.[2]);
          state.evidence = [
            {
              sourceId: evidence.sourceId,
              revisionId: evidence.revisionId,
              sourceType: evidence.sourceType,
            },
          ];
        }
        return [];
      },
      createQueryRunner() {
        return {
          async connect() {},
          async query() {
            return [];
          },
          async release() {},
        } as unknown as QueryRunner;
      },
    } as unknown as DataSource;
    const retrieval = {
      async retrieve() {
        return options.sufficient === false
          ? {
              evidence: [],
              sufficientEvidence: false,
              reason: 'NO_MATCH' as const,
            }
          : { evidence: [evidence], sufficientEvidence: true };
      },
    };
    const usage = {
      reserveAiTokens: jest.fn().mockResolvedValue({}),
      commitAiTokens: jest.fn().mockResolvedValue({}),
    };
    const outbound = {
      enqueueTextMessage: jest.fn().mockResolvedValue('outbound-id'),
    };
    const model = new FakeGroundedModel({
      reply: 'The standing fan costs NGN 25,000 and includes remote control.',
      evidenceIds: [evidence.sourceId],
      canAnswer: true,
      needsHuman: false,
      inputTokens: 140,
      outputTokens: 18,
    });
    const service = new AiResponseService(
      database,
      retrieval as never,
      usage as never,
      outbound as never,
      model,
    );
    return { service, usage, outbound, state };
  }

  const operation = (): OutboxOperation =>
    ({
      id: initial().id,
      businessId: initial().business_id,
      operation: 'whatsapp.ai_response',
      metadata: { aiResponseRunId: initial().id },
    }) as OutboxOperation;

  it('retrieves tenant evidence, reserves and reconciles tokens, then queues a fenced AI reply', async () => {
    const { service, usage, outbound, state } = fixture();
    await service.execute(operation());
    expect(usage.reserveAiTokens).toHaveBeenCalledWith(
      state.business_id,
      state.id,
      expect.any(Number),
      300,
    );
    expect(usage.commitAiTokens).toHaveBeenCalledWith(
      state.business_id,
      state.id,
      140,
      18,
    );
    expect(outbound.enqueueTextMessage).toHaveBeenCalledWith(
      state.business_id,
      { to: state.recipient, message: expect.stringContaining('NGN 25,000') },
      state.id,
      undefined,
      {
        conversationId: state.conversation_id,
        kind: 'AI',
        controlVersion: '1',
      },
    );
  });

  it('suppresses the response if a merchant takes over during model generation', async () => {
    const { service, outbound } = fixture({ takeoverDuringGeneration: true });
    await service.execute(operation());
    expect(outbound.enqueueTextMessage).not.toHaveBeenCalled();
  });

  it('uses the fallback for missing evidence and does not call the model', async () => {
    const { service, outbound, usage } = fixture({ sufficient: false });
    await service.execute(operation());
    expect(usage.reserveAiTokens).not.toHaveBeenCalled();
    expect(outbound.enqueueTextMessage).toHaveBeenCalledWith(
      expect.any(String),
      {
        to: expect.any(String),
        message: expect.stringContaining('enough information'),
      },
      expect.any(String),
      undefined,
      expect.objectContaining({ kind: 'AI' }),
    );
  });
});
