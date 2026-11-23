import type { DataSource, QueryRunner } from 'typeorm';
import { AgentToolExecutor } from './agent-tool-executor.service';

const ids = {
  businessId: 'a1000000-0000-4000-8000-000000000001',
  conversationId: 'a5000000-0000-4000-8000-000000000001',
  aiRunId: 'a3000000-0000-4000-8000-000000000001',
  leadId: 'a6000000-0000-4000-8000-000000000001',
};
const publish = {
  business_id: ids.businessId,
  product_id: 'a2000000-0000-4000-8000-000000000001',
  published_revision_id: 'a2000000-0000-4000-8000-000000000002',
  name: 'Samsung A15',
  description: '128 GB smartphone',
  sku: 'A15',
  price: '300000.00',
  currency: 'NGN',
  availability: 'IN_STOCK' as const,
  published_at: new Date(),
};

describe('AgentToolExecutor', () => {
  function fixture(
    options: { policyFields?: Array<Record<string, unknown>> } = {},
  ) {
    const finished: unknown[][] = [];
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('kleva_agent_tool_begin'))
        return [
          {
            execution_id: 'a7000000-0000-4000-8000-000000000001',
            status: 'STARTED',
            safe_result: {},
          },
        ];
      if (sql.includes('kleva_agent_tool_qualification_context'))
        return [
          {
            lead_id: ids.leadId,
            lead_status: 'CONTACTED',
            lead_version: 2,
            policy_version: 4,
            policy_fields: options.policyFields ?? [],
            current_values: {},
            source_fields: {},
          },
        ];
      throw new Error('Unexpected direct database query.');
    });
    const runnerQuery = jest.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('kleva_published_products')) return [publish];
      if (sql.includes('kleva_agent_tool_finish')) {
        finished.push(values);
        return [{ kleva_agent_tool_finish: true }];
      }
      if (sql.includes('kleva_agent_tool_qualification_save'))
        return [
          {
            result: {
              classification: 'SUCCESS',
              storedFieldIds: ['quantity'],
              missingFieldIds: [],
            },
          },
        ];
      if (sql.includes('kleva_agent_tool_handoff'))
        return [{ result: { classification: 'HANDOFF', controlVersion: 2 } }];
      if (sql.includes('SET LOCAL')) return [];
      throw new Error('Unexpected transactional query.');
    });
    const runner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      query: runnerQuery,
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      get isTransactionActive() {
        return true;
      },
    } as unknown as QueryRunner;
    const database = {
      query,
      createQueryRunner: jest.fn(() => runner),
    } as unknown as DataSource;
    return {
      service: new AgentToolExecutor(database),
      query,
      runner,
      runnerQuery,
      finished,
    };
  }

  const context = (customerMessage: string) => ({ ...ids, customerMessage });

  it('returns exact prices and published source ids using the tenant-bound catalog function', async () => {
    const { service, query, runnerQuery, finished } = fixture();
    const result = await service.execute(
      {
        name: 'search_published_offers',
        version: 1,
        arguments: { query: 'Samsung A15' },
      },
      context('How much is the Samsung A15?'),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('kleva_agent_tool_begin'),
      [
        ids.businessId,
        ids.conversationId,
        ids.aiRunId,
        'search_published_offers',
        1,
        ids.aiRunId,
        expect.any(String),
      ],
    );
    expect(runnerQuery).toHaveBeenCalledWith(
      expect.stringContaining('kleva_published_products'),
      [ids.businessId],
    );
    expect(result.result.offers).toEqual([
      expect.objectContaining({ price: '300000.00', currency: 'NGN' }),
    ]);
    expect(result.evidence?.[0]).toMatchObject({
      id: publish.product_id,
      revisionId: publish.published_revision_id,
    });
    expect(finished).toHaveLength(1);
  });

  it('rejects fabricated qualification values without writing and never accepts model supplied tenant IDs', async () => {
    const { service, query } = fixture({
      policyFields: [
        {
          id: 'product_interest',
          type: 'TEXT',
          required: true,
          consentRequired: false,
          validation: { maxLength: 120 },
        },
      ],
    });
    const result = await service.execute(
      {
        name: 'record_lead_qualification',
        version: 1,
        arguments: {
          fieldValues: {
            product_interest: {
              value: 'Gold necklace',
              sourceQuote: 'I want a gold necklace',
            },
          },
        },
      },
      context('I am interested in a watch.'),
    );
    expect(result.classification).toBe('REJECTED');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('simulates playground writes without touching a database', async () => {
    const { service, query } = fixture();
    const result = service.simulate(
      {
        name: 'record_lead_qualification',
        version: 1,
        arguments: {
          fieldValues: { quantity: { value: 3, sourceQuote: 'three units' } },
        },
      },
      {
        businessId: ids.businessId,
        message: 'I need three units.',
        evidence: [],
        fields: [
          {
            id: 'quantity',
            type: 'NUMBER',
            required: false,
            consentRequired: false,
          },
        ],
      },
    );
    expect(result).toMatchObject({
      simulatedOutcome: 'WOULD_RECORD_IN_PROGRESS',
      sideEffects: false,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('denies unsupported tool requests and unregistered tool names', async () => {
    const { service, query } = fixture();
    const result = await service.execute(
      {
        name: 'request_human_handoff',
        version: 1,
        arguments: { reasonCode: 'UNSUPPORTED_REQUEST' },
      },
      context('Can you tell me the store hours?'),
    );
    expect(result.classification).toBe('REJECTED');
    expect(query).not.toHaveBeenCalled();
    await expect(
      service.execute(
        { name: 'arbitrary_http', version: 1, arguments: {} },
        context('Hello'),
      ),
    ).resolves.toMatchObject({ classification: 'UNKNOWN_TOOL' });
  });
});
