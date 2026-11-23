export const agentToolRegistry = [
  {
    name: 'search_published_offers',
    version: 1,
    permission: 'catalog.read',
    scope: 'active_business',
    timeoutMs: 1000,
    sideEffect: 'READ_ONLY',
    idempotency: 'SAFE_RETRY',
    audit: true,
    safeErrors: ['INVALID', 'FORBIDDEN', 'UNAVAILABLE', 'STALE'] as const,
    description:
      'Search the active business published product and service offers for a customer request. Returns exact published price, currency, availability state and source IDs. Never infer discounts or variants.',
    input: { query: 'string, 1 to 120 characters' },
  },
  {
    name: 'record_lead_qualification',
    version: 1,
    permission: 'lead.write',
    scope: 'active_conversation_lead',
    timeoutMs: 2000,
    sideEffect: 'DATABASE_WRITE',
    idempotency: 'RUN_KEYED',
    audit: true,
    safeErrors: ['INVALID', 'FORBIDDEN', 'CONFLICT', 'UNAVAILABLE'] as const,
    description:
      'Record only sales qualification values directly supported by a quoted portion of the latest customer message and by the active qualification policy. Never mark a lead qualified or WON.',
    input: {
      fieldValues:
        'object keyed by active policy field IDs; each value has only value and sourceQuote',
    },
  },
  {
    name: 'request_human_handoff',
    version: 1,
    permission: 'inbox.handoff',
    scope: 'active_conversation',
    timeoutMs: 2000,
    sideEffect: 'DATABASE_WRITE',
    idempotency: 'RUN_KEYED',
    audit: true,
    safeErrors: ['INVALID', 'FORBIDDEN', 'CONFLICT', 'UNAVAILABLE'] as const,
    description:
      'Request a human when the customer explicitly asks for one, asks for an unapproved discount/payment action, or a required approval is missing.',
    input: {
      reasonCode: 'CUSTOMER_REQUEST | UNSUPPORTED_REQUEST | POLICY_APPROVAL',
    },
  },
] as const;

export type AgentToolName = (typeof agentToolRegistry)[number]['name'];
export type AgentToolCall = {
  name: AgentToolName;
  version: 1;
  arguments: Record<string, unknown>;
};
export type ToolValidation =
  | { ok: true; call: AgentToolCall }
  | {
      ok: false;
      classification: 'UNKNOWN_TOOL' | 'INVALID_ARGUMENTS';
      message: string;
    };

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateAgentToolCall(value: unknown): ToolValidation {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) => !['name', 'version', 'arguments'].includes(key),
    )
  )
    return {
      ok: false,
      classification: 'INVALID_ARGUMENTS',
      message: 'Tool call shape is invalid.',
    };
  const { name, version, arguments: args } = value;
  const definition = agentToolRegistry.find((tool) => tool.name === name);
  if (!definition)
    return {
      ok: false,
      classification: 'UNKNOWN_TOOL',
      message: 'This tool is not registered.',
    };
  if (version !== definition.version || !object(args))
    return {
      ok: false,
      classification: 'INVALID_ARGUMENTS',
      message: 'Tool version or arguments are invalid.',
    };
  if (name === 'search_published_offers') {
    if (
      Object.keys(args).length !== 1 ||
      typeof args.query !== 'string' ||
      !args.query.trim() ||
      args.query.length > 120
    )
      return {
        ok: false,
        classification: 'INVALID_ARGUMENTS',
        message: 'Offer search arguments are invalid.',
      };
  } else if (name === 'record_lead_qualification') {
    if (
      Object.keys(args).length !== 1 ||
      !object(args.fieldValues) ||
      Object.keys(args.fieldValues).length > 20
    )
      return {
        ok: false,
        classification: 'INVALID_ARGUMENTS',
        message: 'Qualification arguments are invalid.',
      };
    for (const [fieldId, proposed] of Object.entries(args.fieldValues)) {
      if (
        !/^[a-z][a-z0-9_]{0,39}$/.test(fieldId) ||
        !object(proposed) ||
        Object.keys(proposed).some(
          (key) => !['value', 'sourceQuote'].includes(key),
        ) ||
        !('value' in proposed) ||
        typeof proposed.sourceQuote !== 'string' ||
        !proposed.sourceQuote.trim() ||
        proposed.sourceQuote.length > 300
      )
        return {
          ok: false,
          classification: 'INVALID_ARGUMENTS',
          message: 'Qualification field evidence is invalid.',
        };
    }
  } else if (
    Object.keys(args).length !== 1 ||
    !['CUSTOMER_REQUEST', 'UNSUPPORTED_REQUEST', 'POLICY_APPROVAL'].includes(
      String(args.reasonCode),
    )
  ) {
    return {
      ok: false,
      classification: 'INVALID_ARGUMENTS',
      message: 'Handoff reason is invalid.',
    };
  }
  return {
    ok: true,
    call: { name, version: 1, arguments: args } as AgentToolCall,
  };
}

export type ToolExecutionContext = {
  businessId: string;
  conversationId: string;
  aiRunId: string;
  leadId: string | null;
  customerMessage: string;
};

export type ToolExecutionResult = {
  toolName: string;
  classification: string;
  result: Record<string, unknown>;
  evidence?: Array<{
    id: string;
    revisionId: string;
    type: 'PRODUCT';
    title: string;
    content: string;
    facts: { price: string | null; currency: string; availability: string };
  }>;
};
