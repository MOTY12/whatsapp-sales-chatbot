import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MerchantPrincipal } from './auth.service';
import { MerchantAccess } from './merchant-access.service';

const fieldTypes = [
  'TEXT',
  'NUMBER',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'BOOLEAN',
  'DATE',
] as const;
type SalesField = {
  id: string;
  label: string;
  type: (typeof fieldTypes)[number];
  required: boolean;
  validation: Record<string, unknown>;
  order: number;
  purpose: string;
  consentRequired: boolean;
};
type QualificationRow = {
  id: string;
  lead_id: string;
  revision: number;
  policy_version: number;
  field_values: Record<string, unknown>;
  consent_evidence: Record<string, unknown>;
  qualification_status: 'IN_PROGRESS' | 'QUALIFIED';
  qualified_by: string | null;
  qualified_at: Date | string | null;
  created_at: Date | string;
};
type PolicyRow = {
  version: number | string;
  fields: SalesField[];
  changed_by: string;
  updated_at: Date | string;
};
type QualificationHistoryRow = {
  id: string;
  revision: number | string;
  policy_version: number | string;
  field_values: Record<string, unknown>;
  consent_evidence: Record<string, unknown>;
  qualification_status: 'IN_PROGRESS' | 'QUALIFIED';
  qualified_by: string | null;
  qualified_at: Date | string | null;
  created_at: Date | string;
};
type ConversionRow = {
  id: string;
  outcome: 'WON' | 'LOST';
  reference: string | null;
  conversion_value: string | null;
  currency: string | null;
  conversion_date: Date | string | null;
  loss_reason: string | null;
  converted_by: string;
  created_at: Date | string;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function validatePolicy(value: unknown): SalesField[] {
  if (!Array.isArray(value) || value.length > 20)
    throw new BadRequestException('Use at most 20 qualification fields.');
  const seen = new Set<string>();
  return value
    .map((raw) => {
      if (!object(raw))
        throw new BadRequestException(
          'Each qualification field must be an object.',
        );
      const {
        id,
        label,
        type,
        required,
        validation,
        order,
        purpose,
        consentRequired,
      } = raw;
      if (
        typeof id !== 'string' ||
        !/^[a-z][a-z0-9_]{0,39}$/.test(id) ||
        seen.has(id)
      )
        throw new BadRequestException(
          'Field IDs must be unique lowercase identifiers.',
        );
      seen.add(id);
      if (
        typeof label !== 'string' ||
        !label.trim() ||
        label.trim().length > 80
      )
        throw new BadRequestException('Field labels must be 1–80 characters.');
      if (
        typeof type !== 'string' ||
        !(fieldTypes as readonly string[]).includes(type)
      )
        throw new BadRequestException('Unsupported qualification field type.');
      if (typeof required !== 'boolean' || typeof consentRequired !== 'boolean')
        throw new BadRequestException(
          'Field required and consent settings must be boolean.',
        );
      if (
        !Number.isSafeInteger(order) ||
        Number(order) < 0 ||
        Number(order) > 1000
      )
        throw new BadRequestException('Field order is invalid.');
      if (typeof purpose !== 'string' || purpose.length > 240)
        throw new BadRequestException(
          'Field purpose must be 240 characters or less.',
        );
      if (!object(validation))
        throw new BadRequestException(
          'Field validation rules must be an object.',
        );
      const allowed =
        type === 'TEXT'
          ? ['minLength', 'maxLength']
          : type === 'NUMBER'
            ? ['min', 'max']
            : type === 'SINGLE_SELECT' || type === 'MULTI_SELECT'
              ? ['options']
              : [];
      if (Object.keys(validation).some((key) => !allowed.includes(key)))
        throw new BadRequestException(
          'Validation rule does not match the field type.',
        );
      if (
        type === 'TEXT' &&
        ((validation.minLength !== undefined &&
          (!Number.isInteger(validation.minLength) ||
            Number(validation.minLength) < 0 ||
            Number(validation.minLength) > 500)) ||
          (validation.maxLength !== undefined &&
            (!Number.isInteger(validation.maxLength) ||
              Number(validation.maxLength) < 1 ||
              Number(validation.maxLength) > 500)))
      )
        throw new BadRequestException(
          'Text length must be between 1 and 500 characters.',
        );
      if (
        type === 'TEXT' &&
        validation.minLength !== undefined &&
        validation.maxLength !== undefined &&
        Number(validation.minLength) > Number(validation.maxLength)
      )
        throw new BadRequestException(
          'Minimum text length must not exceed maximum length.',
        );
      if (
        type === 'NUMBER' &&
        ['min', 'max'].some(
          (k) =>
            validation[k] !== undefined &&
            (typeof validation[k] !== 'number' ||
              !Number.isFinite(validation[k])),
        )
      )
        throw new BadRequestException('Number bounds must be finite numbers.');
      if (
        type === 'NUMBER' &&
        validation.min !== undefined &&
        validation.max !== undefined &&
        Number(validation.min) > Number(validation.max)
      )
        throw new BadRequestException(
          'Minimum number must not exceed maximum number.',
        );
      if (
        ['SINGLE_SELECT', 'MULTI_SELECT'].includes(type) &&
        (!Array.isArray(validation.options) ||
          validation.options.length < 1 ||
          validation.options.length > 50 ||
          validation.options.some(
            (v) => typeof v !== 'string' || !v.trim() || v.length > 100,
          ) ||
          new Set(validation.options.map((v: string) => v.trim())).size !==
            validation.options.length)
      )
        throw new BadRequestException(
          'Select fields need 1–50 unique options.',
        );
      const normalizedValidation = { ...validation };
      if (Array.isArray(validation.options))
        normalizedValidation.options = validation.options.map((v: string) =>
          v.trim(),
        );
      return {
        id,
        label: label.trim(),
        type: type as SalesField['type'],
        required,
        validation: normalizedValidation,
        order: Number(order),
        purpose: purpose.trim(),
        consentRequired,
      };
    })
    .sort((a, b) => a.order - b.order);
}
function validateValues(
  fields: SalesField[],
  rawValues: unknown,
  rawConsent: unknown,
  complete: boolean,
) {
  if (!object(rawValues) || !object(rawConsent))
    throw new BadRequestException(
      'Qualification values and consent evidence must be objects.',
    );
  const known = new Map(fields.map((field) => [field.id, field]));
  if (
    Object.keys(rawValues).some((key) => !known.has(key)) ||
    Object.keys(rawConsent).some((key) => !known.has(key))
  )
    throw new BadRequestException(
      'Qualification contains a field that is not in the current policy.',
    );
  const values: Record<string, unknown> = {};
  const consent: Record<
    string,
    { consented: true; recordedAt: string; source: string }
  > = {};
  for (const [id, value] of Object.entries(rawValues)) {
    const field = known.get(id)!;
    if (value === null || value === '') continue;
    const fail = (): never => {
      throw new BadRequestException(`Invalid value for ${field.label}.`);
    };
    if (field.type === 'TEXT') {
      if (
        typeof value !== 'string' ||
        value.length > Number(field.validation.maxLength ?? 500) ||
        value.length < Number(field.validation.minLength ?? 0)
      )
        fail();
      values[id] = (value as string).trim();
    } else if (field.type === 'NUMBER') {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (field.validation.min !== undefined &&
          value < Number(field.validation.min)) ||
        (field.validation.max !== undefined &&
          value > Number(field.validation.max))
      )
        fail();
      values[id] = value;
    } else if (field.type === 'BOOLEAN') {
      if (typeof value !== 'boolean') fail();
      values[id] = value;
    } else if (field.type === 'DATE') {
      const parsedDate =
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? new Date(`${value}T00:00:00Z`)
          : null;
      if (
        typeof value !== 'string' ||
        !parsedDate ||
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== value
      )
        fail();
      values[id] = value;
    } else if (field.type === 'SINGLE_SELECT') {
      if (
        typeof value !== 'string' ||
        !(field.validation.options as string[]).includes(value)
      )
        fail();
      values[id] = value;
    } else {
      if (
        !Array.isArray(value) ||
        value.length > 50 ||
        value.some(
          (v) =>
            typeof v !== 'string' ||
            !(field.validation.options as string[]).includes(v),
        )
      )
        fail();
      values[id] = [...new Set(value as unknown[])];
    }
  }
  for (const field of fields) {
    const value = values[field.id];
    if (
      complete &&
      field.required &&
      (value === undefined || value === null || value === '')
    )
      throw new BadRequestException(
        `${field.label} is required before qualifying this lead.`,
      );
    if (field.consentRequired && value !== undefined) {
      const evidence = rawConsent[field.id];
      const recordedAt =
        object(evidence) && typeof evidence.recordedAt === 'string'
          ? new Date(evidence.recordedAt)
          : null;
      if (
        !object(evidence) ||
        evidence.consented !== true ||
        !recordedAt ||
        Number.isNaN(recordedAt.getTime()) ||
        !['CUSTOMER_CONFIRMED', 'MERCHANT_RECORDED'].includes(
          String(evidence.source),
        )
      )
        throw new BadRequestException(
          `Record explicit consent evidence for ${field.label}.`,
        );
      consent[field.id] = {
        consented: true,
        recordedAt: recordedAt.toISOString(),
        source: String(evidence.source),
      };
    } else if (rawConsent[field.id] !== undefined) {
      throw new BadRequestException(
        `Consent evidence is not configured for ${field.label}.`,
      );
    }
  }
  return { values, consent };
}

type Cursor = { at: string; id: string };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = ['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST'] as const;
type LeadRow = {
  id: string;
  customer_id: string;
  conversation_id: string;
  customer_name: string;
  customer_whatsapp_id: string;
  source: string;
  status: (typeof statuses)[number];
  first_contact_at: Date | string;
  last_activity_at: Date | string;
  version: string | number;
  updated_at: Date | string;
};
const encode = (v: Cursor) =>
  Buffer.from(JSON.stringify(v)).toString('base64url');
function decode(value?: string): Cursor | undefined {
  if (!value) return;
  try {
    const v = JSON.parse(Buffer.from(value, 'base64url').toString()) as Cursor;
    if (!v || !uuid.test(v.id) || !Number.isFinite(Date.parse(v.at)))
      throw new Error('Invalid cursor');
    return { id: v.id, at: new Date(v.at).toISOString() };
  } catch {
    throw new BadRequestException('Invalid pagination cursor.');
  }
}
function lead(value: string) {
  if (!uuid.test(value)) throw new NotFoundException();
}
@Injectable()
export class MerchantLeadsService {
  constructor(private readonly access: MerchantAccess) {}
  async salesPolicy(actor: MerchantPrincipal, businessId: string) {
    return this.access.withBusiness(
      actor,
      businessId,
      'sales.manage',
      async (manager) => {
        const [current] = await manager.query<
          {
            version: number;
            fields: SalesField[];
            changed_by: string;
            updated_at: Date | string;
          }[]
        >('SELECT * FROM public.kleva_sales_policy_read()');
        const history = await manager.query<PolicyRow[]>(
          'SELECT * FROM public.kleva_sales_policy_history()',
        );
        return {
          policy: current
            ? { ...current, version: Number(current.version) }
            : { version: 0, fields: [], changed_by: null, updated_at: null },
          history: history.map((row) => ({
            ...row,
            version: Number(row.version),
          })),
          templates: {
            retail: [
              {
                id: 'product_interest',
                label: 'Product of interest',
                type: 'TEXT',
                required: true,
                validation: { maxLength: 240 },
                order: 10,
                purpose:
                  'Understand which product the customer is considering.',
                consentRequired: false,
              },
              {
                id: 'quantity',
                label: 'Quantity',
                type: 'NUMBER',
                required: false,
                validation: { min: 1, max: 100000 },
                order: 20,
                purpose: 'Record the quantity requested.',
                consentRequired: false,
              },
              {
                id: 'budget',
                label: 'Budget',
                type: 'NUMBER',
                required: false,
                validation: { min: 0, max: 1000000000 },
                order: 30,
                purpose: 'Record the customer-stated budget.',
                consentRequired: false,
              },
              {
                id: 'delivery_location',
                label: 'Delivery location',
                type: 'TEXT',
                required: false,
                validation: { maxLength: 240 },
                order: 40,
                purpose: 'Record a general delivery area when needed.',
                consentRequired: false,
              },
              {
                id: 'purchase_timeline',
                label: 'Purchase timeline',
                type: 'SINGLE_SELECT',
                required: false,
                validation: {
                  options: [
                    'Today',
                    'This week',
                    'This month',
                    'Later',
                    'Not sure',
                  ],
                },
                order: 50,
                purpose: 'Understand the expected purchase timing.',
                consentRequired: false,
              },
            ],
            service: [
              {
                id: 'service_required',
                label: 'Service required',
                type: 'TEXT',
                required: true,
                validation: { maxLength: 240 },
                order: 10,
                purpose: 'Understand the service requested.',
                consentRequired: false,
              },
              {
                id: 'preferred_date',
                label: 'Preferred appointment date',
                type: 'DATE',
                required: false,
                validation: {},
                order: 20,
                purpose:
                  'Record a preferred date; it is not a booking confirmation.',
                consentRequired: false,
              },
              {
                id: 'customer_location',
                label: 'Customer location',
                type: 'TEXT',
                required: false,
                validation: { maxLength: 240 },
                order: 30,
                purpose: 'Record a general service area when needed.',
                consentRequired: false,
              },
              {
                id: 'estimated_budget',
                label: 'Estimated budget',
                type: 'NUMBER',
                required: false,
                validation: { min: 0, max: 1000000000 },
                order: 40,
                purpose: 'Record the customer-stated budget.',
                consentRequired: false,
              },
              {
                id: 'urgency',
                label: 'Urgency',
                type: 'SINGLE_SELECT',
                required: false,
                validation: { options: ['Low', 'Normal', 'High', 'Urgent'] },
                order: 50,
                purpose: 'Record the customer-stated urgency.',
                consentRequired: false,
              },
            ],
          },
        };
      },
    );
  }
  async saveSalesPolicy(
    actor: MerchantPrincipal,
    businessId: string,
    body: unknown,
  ) {
    if (
      !object(body) ||
      !Number.isSafeInteger(body.expectedVersion) ||
      Number(body.expectedVersion) < 0
    )
      throw new BadRequestException('Invalid policy version.');
    const fields = validatePolicy(body.fields);
    return this.access.withBusiness(
      actor,
      businessId,
      'sales.manage',
      async (manager) => {
        try {
          const [row] = await manager.query<PolicyRow[]>(
            'SELECT * FROM public.kleva_sales_policy_save($1,$2::jsonb)',
            [body.expectedVersion, JSON.stringify(fields)],
          );
          if (!row)
            throw new ConflictException(
              'Qualification policy could not be saved.',
            );
          return { ...row, version: Number(row.version) };
        } catch (error) {
          if (
            ['40001', '23505'].includes((error as { code?: string }).code ?? '')
          )
            throw new ConflictException(
              'The qualification policy changed. Refresh and try again.',
            );
          throw error;
        }
      },
    );
  }
  async qualification(
    actor: MerchantPrincipal,
    businessId: string,
    leadId: string,
  ) {
    lead(leadId);
    return this.access.withBusiness(
      actor,
      businessId,
      'inbox.operate',
      async (manager) => {
        const [record] = await manager.query<QualificationRow[]>(
          'SELECT * FROM public.kleva_lead_qualification_read($1)',
          [leadId],
        );
        const history = await manager.query<QualificationHistoryRow[]>(
          'SELECT * FROM public.kleva_lead_qualification_history($1)',
          [leadId],
        );
        const conversions = await manager.query<ConversionRow[]>(
          'SELECT * FROM public.kleva_lead_conversion_history($1)',
          [leadId],
        );
        return {
          record: record
            ? {
                ...record,
                revision: Number(record.revision),
                policy_version: Number(record.policy_version),
              }
            : null,
          history: history.map((row) => ({
            ...row,
            revision: Number(row.revision),
            policy_version: Number(row.policy_version),
          })),
          conversions,
        };
      },
    );
  }
  async saveQualification(
    actor: MerchantPrincipal,
    businessId: string,
    leadId: string,
    body: unknown,
  ) {
    lead(leadId);
    if (
      !object(body) ||
      !Number.isSafeInteger(body.expectedLeadVersion) ||
      Number(body.expectedLeadVersion) < 1 ||
      !Number.isSafeInteger(body.policyVersion) ||
      Number(body.policyVersion) < 1 ||
      typeof body.markQualified !== 'boolean'
    )
      throw new BadRequestException('Invalid qualification update.');
    const complete = body.markQualified;
    return this.access.withBusiness(
      actor,
      businessId,
      'inbox.operate',
      async (manager) => {
        const [policy] = await manager.query<
          { version: number; fields: SalesField[] }[]
        >('SELECT * FROM public.kleva_sales_policy_read()');
        if (!policy || Number(policy.version) !== Number(body.policyVersion))
          throw new ConflictException(
            'The qualification policy changed. Refresh the lead and try again.',
          );
        const { values, consent } = validateValues(
          policy.fields,
          body.fieldValues,
          body.consentEvidence,
          complete,
        );
        try {
          const [row] = await manager.query<
            {
              lead_id: string;
              revision: number | string;
              policy_version: number | string;
              qualification_status: string;
              lead_status: string;
              lead_version: number | string;
              qualified_by: string | null;
              qualified_at: Date | string | null;
              created_at: Date | string;
            }[]
          >(
            'SELECT * FROM public.kleva_lead_qualification_save($1,$2,$3,$4::jsonb,$5::jsonb,$6)',
            [
              leadId,
              body.expectedLeadVersion,
              body.policyVersion,
              JSON.stringify(values),
              JSON.stringify(consent),
              complete,
            ],
          );
          if (!row) throw new NotFoundException();
          return {
            ...row,
            revision: Number(row.revision),
            policy_version: Number(row.policy_version),
            lead_version: Number(row.lead_version),
          };
        } catch (error) {
          if ((error as { code?: string }).code === '40001')
            throw new ConflictException(
              'The lead or qualification policy changed. Refresh and try again.',
            );
          if ((error as { code?: string }).code === '23514')
            throw new ConflictException(
              'This lead can no longer be qualified.',
            );
          throw error;
        }
      },
    );
  }
  async convert(
    actor: MerchantPrincipal,
    businessId: string,
    leadId: string,
    body: unknown,
  ) {
    lead(leadId);
    if (
      !object(body) ||
      !Number.isSafeInteger(body.expectedLeadVersion) ||
      Number(body.expectedLeadVersion) < 1 ||
      !['WON', 'LOST'].includes(String(body.outcome)) ||
      typeof body.idempotencyKey !== 'string' ||
      !uuid.test(body.idempotencyKey)
    )
      throw new BadRequestException('Invalid conversion request.');
    const outcome = body.outcome as 'WON' | 'LOST';
    const data = object(body.details) ? body.details : {};
    let details: Record<string, unknown>;
    if (outcome === 'WON') {
      const reference = data.reference;
      if (
        reference !== undefined &&
        (typeof reference !== 'string' || reference.length > 120)
      )
        throw new BadRequestException(
          'Conversion reference must be 120 characters or less.',
        );
      const amount = data.value;
      const currency = data.currency;
      if (
        amount !== undefined &&
        (typeof amount !== 'number' ||
          !Number.isFinite(amount) ||
          amount < 0 ||
          amount > 999999999999.99 ||
          Math.round(amount * 100) !== amount * 100)
      )
        throw new BadRequestException(
          'Conversion value must be a non-negative amount.',
        );
      if (
        (amount === undefined) !== (currency === undefined) ||
        (currency !== undefined &&
          (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)))
      )
        throw new BadRequestException(
          'Provide a three-letter currency with the conversion value.',
        );
      const date = data.conversionDate ?? new Date().toISOString().slice(0, 10);
      const parsedDate =
        typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
          ? new Date(`${date}T00:00:00Z`)
          : null;
      if (
        typeof date !== 'string' ||
        !parsedDate ||
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== date
      )
        throw new BadRequestException('Conversion date must use YYYY-MM-DD.');
      details = {
        reference: reference ?? null,
        value: amount ?? null,
        currency: currency ?? null,
        conversionDate: date,
        lossReason: null,
      };
    } else {
      const reason = data.lossReason;
      if (
        reason !== undefined &&
        (typeof reason !== 'string' || reason.length > 500)
      )
        throw new BadRequestException(
          'Loss reason must be 500 characters or less.',
        );
      details = {
        reference: null,
        value: null,
        currency: null,
        conversionDate: null,
        lossReason: reason?.trim() || null,
      };
    }
    return this.access.withBusiness(
      actor,
      businessId,
      'inbox.operate',
      async (manager) => {
        try {
          const [row] = await manager.query<
            {
              lead_id: string;
              outcome: 'WON' | 'LOST';
              lead_version: number | string;
              conversion_id: string;
              created_at: Date | string;
              changed: boolean;
            }[]
          >('SELECT * FROM public.kleva_lead_convert($1,$2,$3,$4::jsonb,$5)', [
            leadId,
            body.expectedLeadVersion,
            outcome,
            JSON.stringify(details),
            body.idempotencyKey,
          ]);
          if (!row) throw new NotFoundException();
          return { ...row, lead_version: Number(row.lead_version) };
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code === '40001')
            throw new ConflictException(
              'The lead changed. Refresh and try again.',
            );
          if (code === '23505')
            throw new ConflictException(
              'This lead has already been converted.',
            );
          if (code === '23514')
            throw new ConflictException(
              'Only qualified leads can be marked won.',
            );
          throw error;
        }
      },
    );
  }
  list(
    actor: MerchantPrincipal,
    businessId: string,
    limit?: string,
    cursor?: string,
    status?: string,
  ) {
    const size =
      limit === undefined
        ? 30
        : /^\d{1,3}$/.test(limit)
          ? Math.min(100, Math.max(1, Number(limit)))
          : NaN;
    if (!Number.isFinite(size))
      throw new BadRequestException('Invalid page size.');
    if (status && !(statuses as readonly string[]).includes(status))
      throw new BadRequestException('Invalid lead status.');
    const page = decode(cursor);
    return this.access.withBusiness(
      actor,
      businessId,
      'inbox.operate',
      async (manager) => {
        const rows = await manager.query<LeadRow[]>(
          'SELECT * FROM public.kleva_leads_list($1,$2,$3,$4)',
          [size + 1, page?.at ?? null, page?.id ?? null, status ?? null],
        );
        const hasMore = rows.length > size,
          items = rows.slice(0, size).map((row) => this.serialize(row));
        return {
          items,
          nextCursor:
            hasMore && items.length
              ? encode({
                  at: new Date(items.at(-1)!.last_activity_at).toISOString(),
                  id: items.at(-1)!.id,
                })
              : null,
        };
      },
    );
  }
  detail(actor: MerchantPrincipal, businessId: string, leadId: string) {
    lead(leadId);
    return this.access.withBusiness(
      actor,
      businessId,
      'inbox.operate',
      async (manager) => {
        const [row] = await manager.query<LeadRow[]>(
          'SELECT * FROM public.kleva_lead_detail($1)',
          [leadId],
        );
        if (!row) throw new NotFoundException();
        return this.serialize(row);
      },
    );
  }
  async update(
    actor: MerchantPrincipal,
    businessId: string,
    leadId: string,
    body: unknown,
  ) {
    lead(leadId);
    if (!body || typeof body !== 'object')
      throw new BadRequestException('Invalid status update.');
    const { status, expectedVersion } = body as {
      status?: unknown;
      expectedVersion?: unknown;
    };
    if (
      typeof status !== 'string' ||
      !(['NEW', 'CONTACTED'] as readonly string[]).includes(status) ||
      !Number.isSafeInteger(expectedVersion) ||
      Number(expectedVersion) < 1
    )
      throw new BadRequestException('Invalid status update.');
    return this.access.withBusiness(
      actor,
      businessId,
      'inbox.operate',
      async (manager) => {
        try {
          const [row] = await manager.query<
            {
              id: string;
              status: string;
              version: string;
              updated_at: Date | string;
              changed: boolean;
            }[]
          >('SELECT * FROM public.kleva_lead_change_status($1,$2,$3)', [
            leadId,
            status,
            expectedVersion,
          ]);
          if (!row) throw new NotFoundException();
          return {
            leadId: row.id,
            status: row.status,
            version: Number(row.version),
            updatedAt: row.updated_at,
            changed: row.changed,
          };
        } catch (error) {
          if ((error as { code?: string }).code === '40001')
            throw new ConflictException('Lead changed. Refresh and try again.');
          if ((error as { code?: string }).code === '23514')
            throw new BadRequestException(
              'Lead status must follow the sales lifecycle. Use qualification or conversion actions for later stages.',
            );
          throw error;
        }
      },
    );
  }
  private serialize(this: void, row: LeadRow) {
    return { ...row, version: Number(row.version) };
  }
}
