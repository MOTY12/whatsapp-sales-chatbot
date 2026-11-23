import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { PublishedProduct } from '../catalog/product.service';
import type { EvidenceItem } from '../knowledge/unified-knowledge-retrieval.service';
import {
  agentToolRegistry,
  validateAgentToolCall,
  type AgentToolCall,
  type ToolExecutionContext,
  type ToolExecutionResult,
} from './tool-registry';

type PolicyContext = {
  lead_id: string;
  lead_status: string;
  lead_version: number | string;
  policy_version: number | string;
  policy_fields: Array<Record<string, unknown>>;
  current_values: Record<string, unknown>;
  source_fields: Record<string, unknown>;
};
type StartedExecution = {
  execution_id: string;
  status: 'STARTED' | 'COMPLETED' | 'FAILED';
  safe_result: Record<string, unknown>;
};

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const normalize = (value: string) =>
  value.toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
const safeClassification = (value: unknown, fallback: string) =>
  typeof value === 'string' ? value : fallback;

@Injectable()
export class AgentToolExecutor {
  private readonly logger = new Logger(AgentToolExecutor.name);

  constructor(@InjectDataSource() private readonly database: DataSource) {}

  registry() {
    return agentToolRegistry;
  }

  async qualificationFields(runId: string) {
    const [context] = await this.database.query<PolicyContext[]>(
      'SELECT * FROM public.kleva_agent_tool_qualification_context($1)',
      [runId],
    );
    return context?.policy_fields ?? [];
  }

  async execute(
    proposed: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const validation = validateAgentToolCall(proposed);
    if (!validation.ok) {
      this.logger.warn({
        event: 'agent_tool.rejected',
        category: validation.classification,
        aiRunId: context.aiRunId,
      });
      return {
        toolName:
          record(proposed) && typeof proposed.name === 'string'
            ? proposed.name
            : 'unknown',
        classification: validation.classification,
        result: { reason: validation.message },
      };
    }
    const call = validation.call;
    const definition = agentToolRegistry.find(
      (tool) => tool.name === call.name,
    )!;
    if (call.name === 'request_human_handoff') {
      const reason = call.arguments.reasonCode as string;
      if (!this.handoffReasonSupported(reason, context.customerMessage))
        return {
          toolName: call.name,
          classification: 'REJECTED',
          result: {
            reason:
              'The customer message does not support this handoff reason.',
          },
        };
    }

    let args: Record<string, unknown> = call.arguments;
    let policy: PolicyContext | null = null;
    if (call.name === 'record_lead_qualification') {
      if (!context.leadId)
        return {
          toolName: call.name,
          classification: 'NEEDS_INPUT',
          result: { reason: 'No lead is attached to this conversation.' },
        };
      const [loaded] = await this.database.query<PolicyContext[]>(
        'SELECT * FROM public.kleva_agent_tool_qualification_context($1)',
        [context.aiRunId],
      );
      policy = loaded ?? null;
      if (!policy || policy.lead_id !== context.leadId)
        return {
          toolName: call.name,
          classification: 'CONFLICT',
          result: { reason: 'The lead or policy is no longer available.' },
        };
      const filtered = this.validateQualificationValues(
        call.arguments.fieldValues as Record<string, unknown>,
        policy,
        context.customerMessage,
      );
      args = {
        policyVersion: Number(policy.policy_version),
        fieldValues: filtered.values,
      };
      if (filtered.invalid.length || filtered.unknown.length) {
        this.logger.warn({
          event: 'agent_tool.rejected',
          category: 'INVALID_QUALIFICATION_EVIDENCE',
          aiRunId: context.aiRunId,
        });
        return {
          toolName: call.name,
          classification: 'REJECTED',
          result: {
            reason:
              'Some proposed values were not supported by the customer message or active policy.',
            rejectedFieldIds: [...filtered.invalid, ...filtered.unknown],
          },
        };
      }
      if (Object.keys(filtered.values).length === 0) {
        return {
          toolName: call.name,
          classification: 'NEEDS_INPUT',
          result: {
            reason:
              'No new policy fields were supported by the current customer message.',
          },
        };
      }
    }

    const argumentHash = createHash('sha256')
      .update(JSON.stringify(args))
      .digest('hex');
    const started = await this.begin(context, call, argumentHash);
    if (started.status === 'COMPLETED' || started.status === 'FAILED')
      return {
        toolName: call.name,
        classification: safeClassification(
          started.safe_result.classification,
          started.status,
        ),
        result: started.safe_result,
        ...(Array.isArray(started.safe_result.evidence)
          ? {
              evidence: started.safe_result
                .evidence as ToolExecutionResult['evidence'],
            }
          : {}),
      };

    const startTime = Date.now();
    if (call.name === 'search_published_offers') {
      const runner = this.database.createQueryRunner();
      try {
        await runner.connect();
        await runner.startTransaction();
        await runner.query(
          `SET LOCAL statement_timeout = '${definition.timeoutMs}ms'`,
        );
        const products = (await runner.query(
          'SELECT * FROM public.kleva_published_products($1)',
          [context.businessId],
        )) as PublishedProduct[];
        const offers = this.search(products, String(call.arguments.query));
        const evidence = offers.map((offer) => this.offerEvidence(offer));
        const result = {
          classification: offers.length ? 'SUCCESS' : 'NO_MATCH',
          offers: offers.map((offer) => ({
            productId: offer.product_id,
            revisionId: offer.published_revision_id,
            name: offer.name,
            description: offer.description.slice(0, 500),
            price: offer.price,
            currency: offer.currency,
            availability: offer.availability,
          })),
          evidence: evidence.map((item) => ({
            id: item.id,
            revisionId: item.revisionId,
            type: item.type,
            title: item.title,
            content: item.content.slice(0, 500),
            facts: item.facts,
          })),
        };
        await runner.query(
          'SELECT public.kleva_agent_tool_finish($1,$2,$3,$4::jsonb,$5)',
          [
            started.execution_id,
            'COMPLETED',
            result.classification,
            JSON.stringify(result),
            Math.min(definition.timeoutMs * 10, Date.now() - startTime),
          ],
        );
        await runner.commitTransaction();
        return {
          toolName: call.name,
          classification: result.classification,
          result,
          evidence,
        };
      } catch {
        if (runner.isTransactionActive)
          await runner.rollbackTransaction().catch(() => undefined);
        this.logger.warn({
          event: 'agent_tool.failed',
          toolName: call.name,
          category: 'UNAVAILABLE',
          aiRunId: context.aiRunId,
        });
        return {
          toolName: call.name,
          classification: 'UNAVAILABLE',
          result: { reason: 'Published offers are temporarily unavailable.' },
        };
      } finally {
        await runner.release();
      }
    }

    if (call.name === 'record_lead_qualification') {
      const fieldValues = args.fieldValues as Record<string, unknown>;
      const result = await this.atomicQuery<
        { result: Record<string, unknown> }[]
      >(
        2000,
        `SELECT public.kleva_agent_tool_qualification_save($1,$2,$3,$4::jsonb) AS result`,
        [
          started.execution_id,
          Number(args.policyVersion),
          Number(policy?.lead_version),
          JSON.stringify(fieldValues),
        ],
      );
      const output = result[0]?.result ?? { classification: 'UNAVAILABLE' };
      return {
        toolName: call.name,
        classification: safeClassification(output.classification, 'SUCCESS'),
        result: output,
      };
    }

    const result = await this.atomicQuery<
      { result: Record<string, unknown> }[]
    >(2000, 'SELECT public.kleva_agent_tool_handoff($1,$2::text) AS result', [
      started.execution_id,
      call.arguments.reasonCode,
    ]);
    return {
      toolName: call.name,
      classification: safeClassification(
        result[0]?.result?.classification,
        'UNAVAILABLE',
      ),
      result: result[0]?.result ?? { classification: 'UNAVAILABLE' },
    };
  }

  simulate(
    proposed: unknown,
    context: {
      businessId: string;
      message: string;
      evidence: EvidenceItem[];
      fields: Array<Record<string, unknown>>;
    },
  ) {
    const checked = validateAgentToolCall(proposed);
    if (!checked.ok)
      return {
        requestedTool:
          record(proposed) && typeof proposed.name === 'string'
            ? proposed.name.slice(0, 48)
            : 'unknown',
        validation: checked.classification,
        simulatedOutcome: 'REJECTED',
        reason: checked.message,
      };
    const call = checked.call;
    if (call.name === 'search_published_offers') {
      const products = context.evidence.filter(
        (item) => item.sourceType === 'PRODUCT',
      );
      const query = normalize(String(call.arguments.query));
      const terms = query.split(/\W+/).filter(Boolean);
      const matches = products
        .filter((item) =>
          terms.some((term) =>
            normalize(`${item.title} ${item.content}`).includes(term),
          ),
        )
        .slice(0, 5);
      return {
        requestedTool: call.name,
        validation: 'VALID',
        simulatedOutcome: matches.length
          ? 'PUBLISHED_OFFERS_FOUND'
          : 'NO_PUBLISHED_MATCH',
        sourceIds: matches.map((item) => item.sourceId),
        sideEffects: false,
      };
    }
    if (call.name === 'record_lead_qualification') {
      const values = call.arguments.fieldValues as Record<string, unknown>;
      const allowed = new Map(
        context.fields.map((field) => [String(field.id), field]),
      );
      const accepted: string[] = [];
      const rejected: string[] = [];
      const consent: string[] = [];
      for (const [id, item] of Object.entries(values)) {
        const field = allowed.get(id);
        if (
          !field ||
          !record(item) ||
          typeof item.sourceQuote !== 'string' ||
          !normalize(context.message).includes(normalize(item.sourceQuote))
        )
          rejected.push(id);
        else if (field.consentRequired === true) consent.push(id);
        else accepted.push(id);
      }
      const required = context.fields
        .filter(
          (field) =>
            field.required === true && !accepted.includes(String(field.id)),
        )
        .map((field) => String(field.id));
      return {
        requestedTool: call.name,
        validation: rejected.length ? 'PARTIALLY_REJECTED' : 'VALID',
        simulatedOutcome: consent.length
          ? 'CONSENT_REQUIRED'
          : required.length
            ? 'NEEDS_INPUT'
            : 'WOULD_RECORD_IN_PROGRESS',
        acceptedFieldIds: accepted,
        missingFieldIds: required,
        consentRequiredFieldIds: consent,
        rejectedFieldIds: rejected,
        sideEffects: false,
      };
    }
    const reason = String(call.arguments.reasonCode);
    const safe = this.handoffReasonSupported(reason, context.message);
    return {
      requestedTool: call.name,
      validation: safe ? 'VALID' : 'REJECTED',
      simulatedOutcome: safe ? 'WOULD_HAND_OFF' : 'REJECTED',
      reasonCode: reason,
      sideEffects: false,
    };
  }

  private async begin(
    context: ToolExecutionContext,
    call: AgentToolCall,
    hash: string,
  ) {
    const rows = await this.database.query<StartedExecution[]>(
      `SELECT * FROM public.kleva_agent_tool_begin($1,$2,$3,$4,$5,$6,$7)`,
      [
        context.businessId,
        context.conversationId,
        context.aiRunId,
        call.name,
        call.version,
        context.aiRunId,
        hash,
      ],
    );
    if (!rows[0]) throw new Error('Tool execution could not be started.');
    return rows[0];
  }

  private async atomicQuery<T>(
    timeoutMs: number,
    sql: string,
    parameters: unknown[],
  ) {
    const runner = this.database.createQueryRunner();
    try {
      await runner.connect();
      await runner.startTransaction();
      await runner.query(`SET LOCAL statement_timeout = '${timeoutMs}ms'`);
      const result = (await runner.query(sql, parameters)) as T;
      await runner.commitTransaction();
      return result;
    } catch (error) {
      if (runner.isTransactionActive)
        await runner.rollbackTransaction().catch(() => undefined);
      throw error;
    } finally {
      await runner.release();
    }
  }

  private handoffReasonSupported(reason: string, message: string) {
    if (reason === 'CUSTOMER_REQUEST')
      return /\b(?:speak|talk|chat)\b.{0,32}\b(?:human|person|manager|agent|representative|someone)\b|\b(?:human|manager|agent|representative)\b.{0,32}\b(?:please|now|help)\b/i.test(
        message,
      );
    if (reason === 'UNSUPPORTED_REQUEST')
      return /\b(?:discount|refund|confirm(?:ing)? (?:my )?payment|mark (?:it )?paid)\b/i.test(
        message,
      );
    return /\b(?:approve|approval|authorize|authorise)\b/i.test(message);
  }

  private search(products: PublishedProduct[], query: string) {
    const words = normalize(query)
      .split(/\W+/)
      .filter((word) => word.length > 1);
    return products
      .map((product) => ({
        product,
        score: words.reduce(
          (score, word) =>
            score +
            (normalize(
              `${product.name} ${product.description} ${product.sku ?? ''}`,
            ).includes(word)
              ? 1
              : 0),
          0,
        ),
      }))
      .filter((entry) => words.length === 0 || entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score || a.product.name.localeCompare(b.product.name),
      )
      .slice(0, 5)
      .map(({ product }) => product);
  }

  private offerEvidence(
    product: PublishedProduct,
  ): NonNullable<ToolExecutionResult['evidence']>[number] {
    return {
      id: product.product_id,
      revisionId: product.published_revision_id,
      type: 'PRODUCT',
      title: product.name,
      content: product.description,
      facts: {
        price: product.price,
        currency: product.currency,
        availability: product.availability,
      },
    };
  }

  private validateQualificationValues(
    proposed: Record<string, unknown>,
    policy: PolicyContext,
    message: string,
  ) {
    const values: Record<string, unknown> = {};
    const invalid: string[] = [];
    const unknown: string[] = [];
    const consentRequired: string[] = [];
    const fields = new Map(
      policy.policy_fields.map((field) => [String(field.id), field]),
    );
    for (const [id, wrapped] of Object.entries(proposed)) {
      const field = fields.get(id);
      if (!field) {
        unknown.push(id);
        continue;
      }
      if (!record(wrapped)) {
        invalid.push(id);
        continue;
      }
      const sourceQuote = wrapped.sourceQuote;
      if (
        typeof sourceQuote !== 'string' ||
        !normalize(message).includes(normalize(sourceQuote))
      ) {
        invalid.push(id);
        continue;
      }
      if (field.consentRequired === true) {
        consentRequired.push(id);
        values[id] = wrapped.value;
        continue;
      }
      if (!this.fieldValueValid(field, wrapped.value, sourceQuote)) {
        invalid.push(id);
        continue;
      }
      values[id] = wrapped.value;
    }
    return { values, invalid, unknown, consentRequired };
  }

  private fieldValueValid(
    field: Record<string, unknown>,
    value: unknown,
    quote: string,
  ) {
    const validation = record(field.validation) ? field.validation : {};
    if (field.type === 'TEXT') {
      if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.length > Number(validation.maxLength ?? 500)
      )
        return false;
      return normalize(quote).includes(normalize(value));
    }
    if (field.type === 'NUMBER') {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (validation.min !== undefined && value < Number(validation.min)) ||
        (validation.max !== undefined && value > Number(validation.max))
      )
        return false;
      const compactQuote = quote.replace(/,/g, '');
      return (
        compactQuote.includes(String(value)) ||
        (Number.isInteger(value) &&
          value >= 0 &&
          value <= 20 &&
          this.smallNumberWords(value).some((word) =>
            new RegExp(`\\b${word}\\b`, 'i').test(quote),
          ))
      );
    }
    if (field.type === 'BOOLEAN')
      return (
        typeof value === 'boolean' &&
        (value
          ? /\b(yes|yeah|yep|true)\b/i.test(quote)
          : /\b(no|nope|false)\b/i.test(quote))
      );
    if (field.type === 'SINGLE_SELECT')
      return (
        typeof value === 'string' &&
        Array.isArray(validation.options) &&
        validation.options.includes(value) &&
        normalize(quote).includes(normalize(value))
      );
    if (field.type === 'MULTI_SELECT') {
      const options = Array.isArray(validation.options)
        ? validation.options
        : [];
      return (
        Array.isArray(value) &&
        value.every(
          (item) =>
            typeof item === 'string' &&
            options.includes(item) &&
            normalize(quote).includes(normalize(item)),
        )
      );
    }
    if (field.type === 'DATE')
      return (
        typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        quote.includes(value)
      );
    return false;
  }

  private smallNumberWords(value: number) {
    const words = [
      'zero',
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
      'eleven',
      'twelve',
      'thirteen',
      'fourteen',
      'fifteen',
      'sixteen',
      'seventeen',
      'eighteen',
      'nineteen',
      'twenty',
    ];
    return [words[value]];
  }
}
