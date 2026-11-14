import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { usageConfig } from '../config/env';

export type UsageCategory =
  'whatsapp_outbound' | 'ai_input_tokens' | 'ai_output_tokens';
export type UsageStatus =
  | 'RESERVED'
  | 'COMMITTED'
  | 'RELEASED'
  | 'FAILED'
  | 'UNCERTAIN'
  | 'PROVIDER_ACCEPTED'
  | 'DELIVERED';

export interface UsageReservation {
  id: string;
  businessId: string;
  category: UsageCategory;
  periodStart: string;
  idempotencyKey: string;
  reservedAmount: number;
  consumedAmount: number;
  releasedAmount: number;
  status: UsageStatus;
}

export interface UsageLimitOverrides {
  monthlyWhatsAppMessages: number | null;
  monthlyAiInputTokens: number | null;
  monthlyAiOutputTokens: number | null;
  aiTokensPerRequest: number | null;
}

export interface UsageBucketSummary {
  category: UsageCategory;
  limit: number;
  consumed: number;
  reserved: number;
  remaining: number;
}

export interface UsageSummary {
  businessId: string;
  periodStart: string;
  categories: Record<UsageCategory, UsageBucketSummary>;
}

type ReservationRow = {
  id: string;
  business_id: string;
  category: UsageCategory;
  period_start: string | Date;
  idempotency_key: string;
  reserved_amount: number | string;
  consumed_amount: number | string;
  released_amount: number | string;
  status: UsageStatus;
};

type LimitRow = {
  monthly_whatsapp_messages: number | null;
  monthly_ai_input_tokens: number | null;
  monthly_ai_output_tokens: number | null;
  ai_tokens_per_request: number | null;
};

const categories: UsageCategory[] = [
  'ai_input_tokens',
  'ai_output_tokens',
  'whatsapp_outbound',
];
const defaultReservationSeconds = 15 * 60;
const maxReservationSeconds = 24 * 60 * 60;

export class UsageLimitExceededError extends Error {
  constructor(readonly category: UsageCategory) {
    super(`Usage allowance exceeded for ${category}.`);
  }
}

export class UsageIdempotencyConflictError extends Error {
  constructor() {
    super('The usage idempotency key is already bound to another reservation.');
  }
}

export class UsageReservationStateError extends Error {
  constructor() {
    super('The usage reservation is not in a state that permits this change.');
  }
}

export function usagePeriodStart(at: Date): string {
  if (!Number.isFinite(at.getTime()))
    throw new Error('Invalid usage period date.');
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function safeAmount(value: number, label: string, allowZero = true) {
  if (
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > 2_147_483_647
  ) {
    throw new Error(`${label} must be a valid non-negative integer amount.`);
  }
  return value;
}

function keyValue(value: string) {
  if (typeof value !== 'string' || !/^[\w.:/@+-]{1,200}$/.test(value)) {
    throw new Error('Usage idempotency key must be 1 to 200 safe characters.');
  }
  return value;
}

function numberOf(value: number | string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(
      `Usage ledger contains an invalid amount: ${String(value)}.`,
    );
  }
  return parsed;
}

@Injectable()
export class UsageService {
  private readonly defaults = usageConfig();

  constructor(@InjectDataSource() private readonly database: DataSource) {}

  async setBusinessLimits(
    businessId: string,
    limits: UsageLimitOverrides,
  ): Promise<void> {
    this.validateBusinessId(businessId);
    const values = [
      limits.monthlyWhatsAppMessages,
      limits.monthlyAiInputTokens,
      limits.monthlyAiOutputTokens,
      limits.aiTokensPerRequest,
    ];
    for (const value of values) {
      if (value !== null) safeAmount(value, 'Usage limit');
    }

    await this.database.transaction(async (manager) => {
      await this.lockLimitConfiguration(manager, businessId);
      await manager.query(
        `INSERT INTO public.business_usage_limits
           (business_id, monthly_whatsapp_messages, monthly_ai_input_tokens,
            monthly_ai_output_tokens, ai_tokens_per_request, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (business_id) DO UPDATE SET
           monthly_whatsapp_messages = EXCLUDED.monthly_whatsapp_messages,
           monthly_ai_input_tokens = EXCLUDED.monthly_ai_input_tokens,
           monthly_ai_output_tokens = EXCLUDED.monthly_ai_output_tokens,
           ai_tokens_per_request = EXCLUDED.ai_tokens_per_request,
           updated_at = now()`,
        [businessId, ...values],
      );
    });
  }

  async reserveWhatsAppMessage(
    businessId: string,
    idempotencyKey: string,
    reservationSeconds = defaultReservationSeconds,
  ): Promise<UsageReservation> {
    const [reservation] = await this.reserve(
      businessId,
      idempotencyKey,
      { whatsapp_outbound: 1 },
      reservationSeconds,
    );
    return reservation;
  }

  async reserveAiTokens(
    businessId: string,
    idempotencyKey: string,
    inputTokens: number,
    outputTokens: number,
    reservationSeconds = defaultReservationSeconds,
  ): Promise<{ input: UsageReservation; output: UsageReservation }> {
    safeAmount(inputTokens, 'Input token reservation');
    safeAmount(outputTokens, 'Output token reservation');
    if (inputTokens + outputTokens < 1) {
      throw new Error(
        'An AI token reservation must reserve at least one token.',
      );
    }
    const key = keyValue(idempotencyKey);
    const [input, output] = await this.reserve(
      businessId,
      key,
      {
        ai_input_tokens: inputTokens,
        ai_output_tokens: outputTokens,
      },
      reservationSeconds,
    );
    return { input, output };
  }

  async commitAiTokens(
    businessId: string,
    idempotencyKey: string,
    actualInputTokens?: number,
    actualOutputTokens?: number,
  ): Promise<{ input: UsageReservation; output: UsageReservation }> {
    this.validateBusinessId(businessId);
    const key = keyValue(idempotencyKey);
    if (actualInputTokens !== undefined)
      safeAmount(actualInputTokens, 'Actual input tokens');
    if (actualOutputTokens !== undefined)
      safeAmount(actualOutputTokens, 'Actual output tokens');

    return this.database.transaction(async (manager) => {
      await this.lockLimitConfiguration(manager, businessId);
      await this.lockCategories(manager, businessId, [
        'ai_input_tokens',
        'ai_output_tokens',
      ]);
      const rows = await this.findAiReservations(
        manager,
        businessId,
        key,
        true,
      );
      const input = rows.find((row) => row.category === 'ai_input_tokens');
      const output = rows.find((row) => row.category === 'ai_output_tokens');
      if (!input || !output) throw new UsageReservationStateError();
      const actualInput = actualInputTokens ?? numberOf(input.reserved_amount);
      const actualOutput =
        actualOutputTokens ?? numberOf(output.reserved_amount);
      if (
        actualInput > numberOf(input.reserved_amount) ||
        actualOutput > numberOf(output.reserved_amount)
      ) {
        throw new UsageLimitExceededError(
          actualInput > numberOf(input.reserved_amount)
            ? 'ai_input_tokens'
            : 'ai_output_tokens',
        );
      }

      if (input.status === 'COMMITTED' && output.status === 'COMMITTED') {
        if (
          numberOf(input.consumed_amount) !== actualInput ||
          numberOf(output.consumed_amount) !== actualOutput
        ) {
          throw new UsageIdempotencyConflictError();
        }
        return {
          input: this.toReservation(input),
          output: this.toReservation(output),
        };
      }
      if (
        !['RESERVED', 'UNCERTAIN'].includes(input.status) ||
        !['RESERVED', 'UNCERTAIN'].includes(output.status)
      ) {
        throw new UsageReservationStateError();
      }

      const committedInput = await this.commitTokenRow(
        manager,
        input,
        actualInput,
      );
      const committedOutput = await this.commitTokenRow(
        manager,
        output,
        actualOutput,
      );
      return {
        input: this.toReservation(committedInput),
        output: this.toReservation(committedOutput),
      };
    });
  }

  async releaseAiTokens(
    businessId: string,
    idempotencyKey: string,
  ): Promise<{ input: UsageReservation; output: UsageReservation }> {
    this.validateBusinessId(businessId);
    const key = keyValue(idempotencyKey);
    return this.database.transaction(async (manager) => {
      await this.lockLimitConfiguration(manager, businessId);
      await this.lockCategories(manager, businessId, [
        'ai_input_tokens',
        'ai_output_tokens',
      ]);
      const rows = await this.findAiReservations(
        manager,
        businessId,
        key,
        true,
      );
      const input = rows.find((row) => row.category === 'ai_input_tokens');
      const output = rows.find((row) => row.category === 'ai_output_tokens');
      if (!input || !output) throw new UsageReservationStateError();
      const releasedInput = await this.releaseTokenRow(manager, input);
      const releasedOutput = await this.releaseTokenRow(manager, output);
      return {
        input: this.toReservation(releasedInput),
        output: this.toReservation(releasedOutput),
      };
    });
  }

  async reconcileWhatsAppStatus(
    businessId: string,
    idempotencyKey: string,
    providerStatus: string,
  ): Promise<UsageReservation> {
    this.validateBusinessId(businessId);
    const key = keyValue(idempotencyKey);
    return this.database.transaction(async (manager) => {
      await this.lockLimitConfiguration(manager, businessId);
      await this.lockCategories(manager, businessId, ['whatsapp_outbound']);
      const [row] = await this.findReservations(
        manager,
        businessId,
        'whatsapp_outbound',
        key,
        true,
      );
      if (!row) throw new UsageReservationStateError();

      if (providerStatus === 'sent' || providerStatus === 'accepted') {
        if (row.status === 'DELIVERED') return this.toReservation(row);
        if (row.status === 'RELEASED' || row.status === 'FAILED')
          throw new UsageReservationStateError();
        return this.consumeWhatsAppRow(manager, row, 'PROVIDER_ACCEPTED');
      }
      if (providerStatus === 'delivered' || providerStatus === 'read') {
        if (row.status === 'RELEASED' || row.status === 'FAILED')
          throw new UsageReservationStateError();
        return this.consumeWhatsAppRow(manager, row, 'DELIVERED');
      }
      if (providerStatus === 'failed') {
        if (row.status === 'PROVIDER_ACCEPTED' || row.status === 'DELIVERED')
          return this.toReservation(row);
        return this.releaseWhatsAppRow(manager, row, 'FAILED');
      }
      if (row.status !== 'RESERVED') return this.toReservation(row);
      const [uncertain] = await manager.query<ReservationRow[]>(
        `UPDATE public.usage_reservations SET status = 'UNCERTAIN', updated_at = now()
          WHERE id = $1 RETURNING *, period_start::text AS period_start`,
        [row.id],
      );
      return this.toReservation(uncertain);
    });
  }

  async recoverExpiredReservations(limit = 100): Promise<number> {
    safeAmount(limit, 'Recovery batch size', false);
    if (limit > 1000)
      throw new Error('Recovery batch size cannot exceed 1000.');
    const rows = await this.database.query<{ id: string }[]>(
      `WITH expired AS (
         SELECT id FROM public.usage_reservations
          WHERE status = 'RESERVED' AND expires_at <= now()
          ORDER BY expires_at, id LIMIT $1 FOR UPDATE SKIP LOCKED
       )
       UPDATE public.usage_reservations u SET status = 'UNCERTAIN', updated_at = now()
        FROM expired WHERE u.id = expired.id RETURNING u.id`,
      [limit],
    );
    return rows.length;
  }

  async getUsageSummary(
    businessId: string,
    at = new Date(),
  ): Promise<UsageSummary> {
    this.validateBusinessId(businessId);
    const period = usagePeriodStart(at);
    const limits = await this.getLimits(businessId);
    const totals = await this.database.query<
      {
        category: UsageCategory;
        consumed: number | string;
        reserved: number | string;
      }[]
    >(
      `SELECT category, COALESCE(sum(consumed_amount), 0)::bigint AS consumed,
              COALESCE(sum(reserved_amount - consumed_amount - released_amount), 0)::bigint AS reserved
         FROM public.usage_reservations
        WHERE business_id = $1 AND period_start = $2::date
        GROUP BY category`,
      [businessId, period],
    );
    const byCategory = new Map(totals.map((row) => [row.category, row]));
    const caps: Record<UsageCategory, number> = {
      whatsapp_outbound: limits.monthlyWhatsAppMessages,
      ai_input_tokens: limits.monthlyAiInputTokens,
      ai_output_tokens: limits.monthlyAiOutputTokens,
    };
    const summaries = Object.fromEntries(
      categories.map((category) => {
        const row = byCategory.get(category);
        const consumed = row ? numberOf(row.consumed) : 0;
        const reserved = row ? numberOf(row.reserved) : 0;
        return [
          category,
          {
            category,
            limit: caps[category],
            consumed,
            reserved,
            remaining: Math.max(0, caps[category] - consumed - reserved),
          },
        ];
      }),
    ) as Record<UsageCategory, UsageBucketSummary>;
    return { businessId, periodStart: period, categories: summaries };
  }

  async getRemainingAllowance(
    businessId: string,
    category: UsageCategory,
    at = new Date(),
  ): Promise<number> {
    return (await this.getUsageSummary(businessId, at)).categories[category]
      .remaining;
  }

  private async reserve(
    businessId: string,
    idempotencyKey: string,
    amounts: Partial<Record<UsageCategory, number>>,
    reservationSeconds: number,
  ): Promise<UsageReservation[]> {
    this.validateBusinessId(businessId);
    const key = keyValue(idempotencyKey);
    safeAmount(reservationSeconds, 'Reservation lifetime', false);
    if (reservationSeconds > maxReservationSeconds)
      throw new Error('Reservation lifetime cannot exceed 24 hours.');
    const entries = Object.entries(amounts) as [UsageCategory, number][];
    if (!entries.length)
      throw new Error('At least one usage category is required.');
    for (const [, amount] of entries) safeAmount(amount, 'Reserved amount');
    const period = usagePeriodStart(new Date());
    const expiresAt = new Date(Date.now() + reservationSeconds * 1000);

    return this.database.transaction(async (manager) => {
      await this.lockLimitConfiguration(manager, businessId);
      await this.lockCategories(
        manager,
        businessId,
        entries.map(([category]) => category),
      );
      const existing: ReservationRow[] = [];
      for (const [category, amount] of entries) {
        const [row] = await this.findReservations(
          manager,
          businessId,
          category,
          key,
          true,
        );
        if (row) {
          if (numberOf(row.reserved_amount) !== amount)
            throw new UsageIdempotencyConflictError();
          existing.push(row);
        }
      }
      if (existing.length && existing.length !== entries.length)
        throw new UsageIdempotencyConflictError();
      if (existing.length === entries.length)
        return existing.map((row) => this.toReservation(row));

      const limits = await this.getLimits(businessId, manager);
      const current = period;
      if (
        entries.some(([category]) => category.startsWith('ai_')) &&
        entries.reduce((total, [, amount]) => total + amount, 0) >
          limits.aiTokensPerRequest
      ) {
        throw new UsageLimitExceededError('ai_output_tokens');
      }
      const summary = await manager.query<
        { category: UsageCategory; used: number | string }[]
      >(
        `SELECT category, COALESCE(sum(reserved_amount - released_amount), 0)::bigint AS used
           FROM public.usage_reservations
          WHERE business_id = $1 AND period_start = $2::date
          GROUP BY category`,
        [businessId, current],
      );
      const used = new Map(
        summary.map((row) => [row.category, numberOf(row.used)]),
      );
      const caps: Record<UsageCategory, number> = {
        whatsapp_outbound: limits.monthlyWhatsAppMessages,
        ai_input_tokens: limits.monthlyAiInputTokens,
        ai_output_tokens: limits.monthlyAiOutputTokens,
      };
      for (const [category, amount] of entries) {
        if ((used.get(category) ?? 0) + amount > caps[category])
          throw new UsageLimitExceededError(category);
      }

      const rows: ReservationRow[] = [];
      for (const [category, amount] of entries) {
        const [row] = await manager.query<ReservationRow[]>(
          `INSERT INTO public.usage_reservations
             (id, business_id, category, period_start, idempotency_key,
              reserved_amount, expires_at)
           VALUES ($1, $2, $3, $4::date, $5, $6, $7)
           RETURNING *, period_start::text AS period_start`,
          [randomUUID(), businessId, category, current, key, amount, expiresAt],
        );
        rows.push(row);
      }
      return rows.map((row) => this.toReservation(row));
    });
  }

  private async getLimits(businessId: string, manager?: EntityManager) {
    const sql = `SELECT monthly_whatsapp_messages, monthly_ai_input_tokens,
                       monthly_ai_output_tokens, ai_tokens_per_request
                  FROM public.business_usage_limits WHERE business_id = $1`;
    const rows = manager
      ? await manager.query<LimitRow[]>(sql, [businessId])
      : await this.database.query<LimitRow[]>(sql, [businessId]);
    const [row] = rows;
    return {
      monthlyWhatsAppMessages:
        row?.monthly_whatsapp_messages ?? this.defaults.monthlyWhatsAppMessages,
      monthlyAiInputTokens:
        row?.monthly_ai_input_tokens ?? this.defaults.monthlyAiInputTokens,
      monthlyAiOutputTokens:
        row?.monthly_ai_output_tokens ?? this.defaults.monthlyAiOutputTokens,
      aiTokensPerRequest:
        row?.ai_tokens_per_request ?? this.defaults.aiTokensPerRequest,
    };
  }

  private async lockLimitConfiguration(
    manager: EntityManager,
    businessId: string,
  ) {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`usage:${businessId}:limits`],
    );
  }

  private async lockCategories(
    manager: EntityManager,
    businessId: string,
    values: UsageCategory[],
  ) {
    for (const category of [...new Set(values)].sort()) {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`usage:${businessId}:${category}`],
      );
    }
  }

  private async findReservations(
    manager: EntityManager,
    businessId: string,
    category: UsageCategory,
    key: string,
    lock: boolean,
  ) {
    return manager.query<ReservationRow[]>(
      `SELECT *, period_start::text AS period_start FROM public.usage_reservations
        WHERE business_id = $1 AND category = $2 AND idempotency_key = $3
        ${lock ? 'FOR UPDATE' : ''}`,
      [businessId, category, key],
    );
  }

  private async findAiReservations(
    manager: EntityManager,
    businessId: string,
    key: string,
    lock: boolean,
  ) {
    return manager.query<ReservationRow[]>(
      `SELECT *, period_start::text AS period_start FROM public.usage_reservations
        WHERE business_id = $1 AND category IN ('ai_input_tokens', 'ai_output_tokens')
          AND idempotency_key = $2
        ORDER BY category ${lock ? 'FOR UPDATE' : ''}`,
      [businessId, key],
    );
  }

  private async commitTokenRow(
    manager: EntityManager,
    row: ReservationRow,
    consumed: number,
  ) {
    const [result] = await manager.query<ReservationRow[]>(
      `UPDATE public.usage_reservations SET consumed_amount = $2,
          released_amount = reserved_amount - $2, status = 'COMMITTED', updated_at = now()
          WHERE id = $1 RETURNING *, period_start::text AS period_start`,
      [row.id, consumed],
    );
    return result;
  }

  private async releaseTokenRow(manager: EntityManager, row: ReservationRow) {
    if (row.status === 'RELEASED' || row.status === 'FAILED') return row;
    if (!['RESERVED', 'UNCERTAIN'].includes(row.status))
      throw new UsageReservationStateError();
    const [result] = await manager.query<ReservationRow[]>(
      `UPDATE public.usage_reservations SET released_amount = reserved_amount,
          status = 'FAILED', updated_at = now()
        WHERE id = $1 RETURNING *, period_start::text AS period_start`,
      [row.id],
    );
    return result;
  }

  private async consumeWhatsAppRow(
    manager: EntityManager,
    row: ReservationRow,
    status: 'PROVIDER_ACCEPTED' | 'DELIVERED',
  ) {
    if (row.status === 'DELIVERED') return this.toReservation(row);
    const [result] = await manager.query<ReservationRow[]>(
      `UPDATE public.usage_reservations SET consumed_amount = 1,
          released_amount = 0, status = $2, updated_at = now()
        WHERE id = $1 RETURNING *, period_start::text AS period_start`,
      [row.id, status],
    );
    return this.toReservation(result);
  }

  private async releaseWhatsAppRow(
    manager: EntityManager,
    row: ReservationRow,
    status: 'FAILED',
  ) {
    if (row.status === 'RELEASED' || row.status === 'FAILED')
      return this.toReservation(row);
    if (row.status !== 'RESERVED' && row.status !== 'UNCERTAIN')
      throw new UsageReservationStateError();
    const [result] = await manager.query<ReservationRow[]>(
      `UPDATE public.usage_reservations SET released_amount = reserved_amount,
          status = $2, updated_at = now()
        WHERE id = $1 RETURNING *, period_start::text AS period_start`,
      [row.id, status],
    );
    return this.toReservation(result);
  }

  private toReservation(row: ReservationRow): UsageReservation {
    if (row.reserved_amount === undefined) {
      throw new Error(`Usage ledger row missing fields: ${Object.keys(row).join(',')}`);
    }
    return {
      id: row.id,
      businessId: row.business_id,
      category: row.category,
      periodStart: String(row.period_start).slice(0, 10),
      idempotencyKey: row.idempotency_key,
      reservedAmount: numberOf(row.reserved_amount),
      consumedAmount: numberOf(row.consumed_amount),
      releasedAmount: numberOf(row.released_amount),
      status: row.status,
    };
  }

  private validateBusinessId(businessId: string) {
    if (
      typeof businessId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        businessId,
      )
    ) {
      throw new Error('A valid business ID is required for usage metering.');
    }
  }
}
