import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Business } from '../../src/database/entities/business.entity';
import { UsageService } from '../../src/metering/usage.service';
import { applyMigrations, createIntegrationDatabase } from './postgres';

describe('tenant usage metering with PostgreSQL', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let admin: DataSource;
  let runtime: DataSource;
  let usage: UsageService;
  let businessA: string;
  let businessB: string;

  beforeAll(async () => {
    database = await createIntegrationDatabase();
    admin = await database.migrator();
    await applyMigrations(admin);
    await database.grantRuntimeAccess(admin);
    runtime = await database.runtime();
    usage = new UsageService(runtime);
  });

  beforeEach(async () => {
    const businesses = admin.getRepository(Business);
    const [first, second] = await businesses.save([
      { name: 'Usage Shop A', phone: randomUUID() },
      { name: 'Usage Shop B', phone: randomUUID() },
    ]);
    businessA = first.id;
    businessB = second.id;
  });

  afterAll(async () => {
    await database?.close();
  });

  const limits = (
    monthlyWhatsAppMessages: number | null,
    monthlyAiInputTokens = 100,
    monthlyAiOutputTokens = 100,
    aiTokensPerRequest = 50,
  ) => ({
    monthlyWhatsAppMessages,
    monthlyAiInputTokens,
    monthlyAiOutputTokens,
    aiTokensPerRequest,
  });

  it('reserves inside quota, rejects excess, and serializes concurrent boundary requests', async () => {
    await usage.setBusinessLimits(businessA, limits(2));
    const first = await usage.reserveWhatsAppMessage(businessA, 'send-one');
    const second = await usage.reserveWhatsAppMessage(businessA, 'send-two');
    expect(first.status).toBe('RESERVED');
    expect(second.status).toBe('RESERVED');
    await expect(
      usage.reserveWhatsAppMessage(businessA, 'send-three'),
    ).rejects.toThrow('Usage allowance exceeded');

    await usage.setBusinessLimits(businessB, limits(3));
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        usage.reserveWhatsAppMessage(businessB, `boundary-${index}`),
      ),
    );
    expect(
      attempts.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(3);
    expect(
      attempts.filter((result) => result.status === 'rejected'),
    ).toHaveLength(5);
  });

  it('reuses duplicate reservations and prevents idempotency-key amount changes', async () => {
    await usage.setBusinessLimits(businessA, limits(10));
    const first = await usage.reserveWhatsAppMessage(
      businessA,
      'same-logical-send',
    );
    const retry = await usage.reserveWhatsAppMessage(
      businessA,
      'same-logical-send',
    );
    expect(retry.id).toBe(first.id);
    const ai = await usage.reserveAiTokens(
      businessA,
      'same-logical-send',
      2,
      3,
    );
    await expect(
      usage.reserveAiTokens(businessA, 'same-logical-send', 3, 3),
    ).rejects.toThrow('already bound');
    expect(
      await usage.getRemainingAllowance(businessA, 'whatsapp_outbound'),
    ).toBe(9);
    expect(ai.input.reservedAmount).toBe(2);
  });

  it('commits actual AI usage idempotently and handles absent metadata conservatively', async () => {
    await usage.setBusinessLimits(businessA, limits(10, 20, 20, 12));
    const reservation = await usage.reserveAiTokens(
      businessA,
      'ai-measured',
      5,
      4,
    );
    const committed = await usage.commitAiTokens(
      businessA,
      'ai-measured',
      3,
      2,
    );
    const repeated = await usage.commitAiTokens(businessA, 'ai-measured', 3, 2);
    expect(committed.input.consumedAmount).toBe(3);
    expect(committed.input.releasedAmount).toBe(2);
    expect(repeated.output.id).toBe(reservation.output.id);
    expect(
      await usage.getRemainingAllowance(businessA, 'ai_input_tokens'),
    ).toBe(17);

    const missing = await usage.reserveAiTokens(
      businessA,
      'ai-missing-usage',
      4,
      3,
    );
    const conservative = await usage.commitAiTokens(
      businessA,
      'ai-missing-usage',
    );
    expect(conservative.input.consumedAmount).toBe(
      missing.input.reservedAmount,
    );
    expect(conservative.output.consumedAmount).toBe(
      missing.output.reservedAmount,
    );
  });

  it('rejects requests above their ceiling and token overruns without freeing the hold', async () => {
    await usage.setBusinessLimits(businessA, limits(10, 20, 20, 8));
    await expect(
      usage.reserveAiTokens(businessA, 'too-large-request', 5, 4),
    ).rejects.toThrow('Usage allowance exceeded');
    await usage.reserveAiTokens(businessA, 'bounded-request', 5, 3);
    await expect(
      usage.commitAiTokens(businessA, 'bounded-request', 6, 3),
    ).rejects.toThrow('Usage allowance exceeded');
    const summary = await usage.getUsageSummary(businessA);
    expect(summary.categories.ai_input_tokens).toMatchObject({
      consumed: 0,
      reserved: 5,
      remaining: 15,
    });
  });

  it('releases only definitively failed WhatsApp sends and retains unknown outcomes', async () => {
    await usage.setBusinessLimits(businessA, limits(2));
    const failed = await usage.reserveWhatsAppMessage(businessA, 'send-failed');
    const uncertain = await usage.reconcileWhatsAppStatus(
      businessA,
      'send-failed',
      'provider-timeout',
    );
    expect(uncertain.status).toBe('UNCERTAIN');
    expect(
      await usage.getRemainingAllowance(businessA, 'whatsapp_outbound'),
    ).toBe(1);
    const released = await usage.reconcileWhatsAppStatus(
      businessA,
      'send-failed',
      'failed',
    );
    expect(released.status).toBe('FAILED');
    expect(released.id).toBe(failed.id);
    expect(
      await usage.getRemainingAllowance(businessA, 'whatsapp_outbound'),
    ).toBe(2);

    const accepted = await usage.reserveWhatsAppMessage(
      businessA,
      'send-accepted',
    );
    const committed = await usage.reconcileWhatsAppStatus(
      businessA,
      'send-accepted',
      'sent',
    );
    expect(committed.status).toBe('PROVIDER_ACCEPTED');
    expect(committed.consumedAmount).toBe(1);
    expect(
      await usage.reconcileWhatsAppStatus(
        businessA,
        'send-accepted',
        'delivered',
      ),
    ).toMatchObject({
      id: accepted.id,
      status: 'DELIVERED',
      consumedAmount: 1,
    });
    expect(
      await usage.reconcileWhatsAppStatus(
        businessA,
        'send-accepted',
        'unknown-provider-state',
      ),
    ).toMatchObject({ status: 'DELIVERED', consumedAmount: 1 });
  });

  it('isolates tenant totals, limits, and commit operations', async () => {
    await usage.setBusinessLimits(businessA, limits(1, 10, 10, 10));
    await usage.setBusinessLimits(businessB, limits(0, 10, 10, 10));
    const row = await usage.reserveAiTokens(businessA, 'tenant-a-ai', 2, 2);
    await expect(
      usage.commitAiTokens(businessB, 'tenant-a-ai', 1, 1),
    ).rejects.toThrow('not in a state');
    expect(
      (await usage.getUsageSummary(businessB)).categories.ai_input_tokens,
    ).toMatchObject({ consumed: 0, reserved: 0, remaining: 10 });
    await expect(
      usage.reserveWhatsAppMessage(businessB, 'tenant-b-blocked'),
    ).rejects.toThrow('Usage allowance exceeded');
    expect(row.input.businessId).toBe(businessA);
  });

  it('keeps the UTC calendar month on the reservation and rolls summary usage forward', async () => {
    await usage.setBusinessLimits(businessA, limits(10));
    const reservation = await usage.reserveWhatsAppMessage(
      businessA,
      'month-boundary-send',
    );
    const nextMonth = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 2),
    );
    const nextMonthSummary = await usage.getUsageSummary(businessA, nextMonth);
    expect(reservation.periodStart).not.toBe(nextMonthSummary.periodStart);
    expect(nextMonthSummary.categories.whatsapp_outbound).toMatchObject({
      consumed: 0,
      reserved: 0,
      remaining: 10,
    });
  });

  it('recovers expired reservations as uncertain and preserves their allowance hold', async () => {
    await usage.setBusinessLimits(businessA, limits(1));
    const reservation = await usage.reserveWhatsAppMessage(
      businessA,
      'expired-send',
      30,
    );
    await admin.query(
      `UPDATE public.usage_reservations SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [reservation.id],
    );
    expect(await usage.recoverExpiredReservations()).toBeGreaterThanOrEqual(1);
    const [recovered] = await admin.query<{ status: string }[]>(
      `SELECT status FROM public.usage_reservations WHERE id = $1`,
      [reservation.id],
    );
    expect(recovered.status).toBe('UNCERTAIN');
    expect(
      await usage.getRemainingAllowance(businessA, 'whatsapp_outbound'),
    ).toBe(0);
    expect(
      await usage.reconcileWhatsAppStatus(businessA, 'expired-send', 'failed'),
    ).toMatchObject({ status: 'FAILED', releasedAmount: 1 });
  });

  it('survives a service restart and rejects negative usage values', async () => {
    await usage.setBusinessLimits(businessA, limits(10, 20, 20, 20));
    const reservation = await usage.reserveAiTokens(
      businessA,
      'restart-retry',
      3,
      2,
    );
    const restarted = new UsageService(runtime);
    const retry = await restarted.reserveAiTokens(
      businessA,
      'restart-retry',
      3,
      2,
    );
    expect(retry.input.id).toBe(reservation.input.id);
    await expect(
      usage.reserveAiTokens(businessA, 'negative-token', -1, 1),
    ).rejects.toThrow('non-negative integer');
    await expect(
      usage.commitAiTokens(businessA, 'restart-retry', -1, 1),
    ).rejects.toThrow('non-negative integer');
  });

  it('denies tenant database roles access to limits and ledger tables', async () => {
    const credentials = await database.merchantCredentials(admin);
    const merchant = new DataSource({
      type: 'postgres',
      host: credentials.host,
      port: credentials.port,
      database: credentials.database,
      username: credentials.username,
      password: credentials.password,
    });
    try {
      await merchant.initialize();
      await expect(
        merchant.query('SELECT * FROM public.usage_reservations'),
      ).rejects.toMatchObject({ driverError: { code: '42501' } });
      await expect(
        merchant.query(
          `INSERT INTO public.business_usage_limits (business_id) VALUES ($1)`,
          [businessA],
        ),
      ).rejects.toMatchObject({ driverError: { code: '42501' } });
    } finally {
      if (merchant.isInitialized) await merchant.destroy();
    }
  });
});
