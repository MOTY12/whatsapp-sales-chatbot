import { agentToolRegistry, validateAgentToolCall } from './tool-registry';

describe('controlled agent tool registry', () => {
  it('registers only the three explicitly approved pilot tools', () => {
    expect(agentToolRegistry.map(({ name }) => name)).toEqual([
      'search_published_offers',
      'record_lead_qualification',
      'request_human_handoff',
    ]);
    expect(
      agentToolRegistry.every((tool) => tool.version === 1 && tool.audit),
    ).toBe(true);
  });

  it('rejects arbitrary tool names and extra authority arguments', () => {
    expect(
      validateAgentToolCall({
        name: 'run_sql',
        version: 1,
        arguments: { sql: 'select 1' },
      }),
    ).toMatchObject({
      ok: false,
      classification: 'UNKNOWN_TOOL',
    });
    expect(
      validateAgentToolCall({
        name: 'search_published_offers',
        version: 1,
        arguments: { query: 'Samsung A15', businessId: 'another-tenant' },
      }),
    ).toMatchObject({ ok: false, classification: 'INVALID_ARGUMENTS' });
  });

  it('validates bounded lookup, quote-backed field intent and the enumerated handoff reason', () => {
    expect(
      validateAgentToolCall({
        name: 'search_published_offers',
        version: 1,
        arguments: { query: 'Samsung A15 price' },
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateAgentToolCall({
        name: 'record_lead_qualification',
        version: 1,
        arguments: {
          fieldValues: { quantity: { value: 3, sourceQuote: 'three units' } },
        },
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateAgentToolCall({
        name: 'request_human_handoff',
        version: 1,
        arguments: { reasonCode: 'DELETE_TENANT' },
      }),
    ).toMatchObject({ ok: false, classification: 'INVALID_ARGUMENTS' });
  });
});
