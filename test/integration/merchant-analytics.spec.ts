import { randomUUID, createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { MerchantAccess } from '../../src/Auth/merchant-access.service';
import { MerchantDatabase } from '../../src/Auth/merchant-database';
import { merchantAuthConfig } from '../../src/config/env';
import { Business } from '../../src/database/entities/business.entity';
import { grantMerchantAccess } from '../../src/database/merchant-access';
import { UsageService } from '../../src/metering/usage.service';
import { applyMigrations, createIntegrationDatabase } from './postgres';

type TestAnalyticsReport = {
  engagement: { inboundConversations: number; inboundMessages: number };
  responses: { medianFirstResponseSeconds: number | null; unanswered: number };
  sales: { recordedValuesByCurrency: unknown[]; revenueAvailability: string };
  ai: { failedGenerations: number };
};

describe('merchant analytics PostgreSQL integration', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let admin: DataSource;
  let runtime: DataSource;
  let merchantDb: MerchantDatabase;
  let businessId: string;
  let accountId: string;
  let sessionDigest: string;

  beforeAll(async () => {
    database = await createIntegrationDatabase();
    admin = await database.migrator();
    await applyMigrations(admin);
    await admin.undoLastMigration();
    await applyMigrations(admin);
    const credentials = await database.merchantCredentials(admin);
    await grantMerchantAccess(
      admin,
      credentials.username,
      credentials.identityUsername,
    );
    await database.grantRuntimeAccess(admin);
    runtime = await database.runtime();
    const auth = merchantAuthConfig({
      NODE_ENV: 'test',
      DATABASE_HOST: credentials.host,
      DATABASE_PORT: String(credentials.port),
      DATABASE_NAME: credentials.database,
      DATABASE_USER: 'postgres',
      DATABASE_PASSWORD: 'kleva_test_local_only',
      DATABASE_SSL: 'false',
      MERCHANT_DATABASE_USER: credentials.username,
      MERCHANT_DATABASE_PASSWORD: credentials.password,
      IDENTITY_DATABASE_USER: credentials.identityUsername,
      IDENTITY_DATABASE_PASSWORD: credentials.identityPassword,
      EMAIL_AUTH_ENABLED: 'true',
      OIDC_ISSUER: 'http://localhost:9999',
      OIDC_CLIENT_ID: 'test-client',
      OIDC_CLIENT_SECRET: 'test-secret',
      OIDC_REDIRECT_URI: 'http://localhost:3000/auth/callback',
      DASHBOARD_PUBLIC_ORIGIN: 'http://localhost:3001',
    });
    if (!auth) throw new Error('Test merchant auth config was not created.');
    merchantDb = new MerchantDatabase(auth);
    await merchantDb.onModuleInit();
    const business = await admin.getRepository(Business).save({
      name: 'Analytics Fixture',
      phone: '2348100000000',
      timezone: 'UTC',
    });
    businessId = business.id;
    const token = randomUUID();
    const csrf = randomUUID();
    sessionDigest = createHash('sha256').update(token).digest('hex');
    const [account] = await admin.query<{ id: string }[]>(
      `SELECT public.kleva_issue_session($1,$2,$3,$4,NULL) AS id`,
      [
        'https://analytics.fixture',
        randomUUID(),
        sessionDigest,
        createHash('sha256').update(csrf).digest('hex'),
      ],
    );
    accountId = account.id;
    await admin.query(
      `INSERT INTO public.business_members("businessId","accountId",role,status)
       VALUES($1,$2,'owner','active')`,
      [businessId, accountId],
    );
  });

  afterAll(async () => {
    await merchantDb?.onApplicationShutdown();
    if (runtime?.isInitialized) await runtime.destroy();
    await database?.close();
  });

  it('returns real empty-state aggregates to the authorized tenant only', async () => {
    const access = new MerchantAccess(merchantDb);
    const report = await access.withBusiness(
      { accountId, sessionDigest },
      businessId,
      'analytics.read',
      async (manager) => {
        const [row] = await manager.query<{ report: TestAnalyticsReport }[]>(
          `SELECT public.kleva_merchant_analytics($1,$2,'ALL','UTC') report`,
          [new Date('2026-01-01T00:00:00Z'), new Date('2026-01-02T00:00:00Z')],
        );
        return row.report;
      },
    );
    expect(report.engagement.inboundConversations).toBe(0);
    expect(report.engagement.inboundMessages).toBe(0);
    expect(report.responses.medianFirstResponseSeconds).toBeNull();
    expect(report.sales.recordedValuesByCurrency).toEqual([]);
    expect(report.sales.revenueAvailability).toBe(
      'UNAVAILABLE_NO_RECORDED_VALUES',
    );
    await expect(
      access.withBusiness(
        { accountId, sessionDigest },
        randomUUID(),
        'analytics.read',
        async () => 'must not run',
      ),
    ).rejects.toThrow();
  });

  it('labels newly reserved playground tokens separately without changing quota accounting', async () => {
    const usage = new UsageService(runtime);
    const key = randomUUID();
    const reservation = await usage.reserveAiTokens(
      businessId,
      key,
      31,
      7,
      undefined,
      'PLAYGROUND',
    );
    expect(reservation.input.reservedAmount).toBe(31);
    const [row] = await admin.query<
      { usage_purpose: string; reserved_amount: number }[]
    >(
      `SELECT usage_purpose,reserved_amount FROM public.usage_reservations
       WHERE business_id=$1 AND idempotency_key=$2 AND category='ai_input_tokens'`,
      [businessId, key],
    );
    expect(row).toEqual({ usage_purpose: 'PLAYGROUND', reserved_amount: 31 });
  });

  it('counts distinct conversations, excludes failed AI runs from answers, and retains no message text', async () => {
    const customerId = randomUUID();
    const conversationId = randomUUID();
    const firstMessageId = randomUUID();
    const secondMessageId = randomUUID();
    const failedRunId = randomUUID();
    await admin.query(
      `INSERT INTO public.customers(id,name,phone,"whatsappId","businessId")
       VALUES($1,'Analytics Customer',$2,$2,$3)`,
      [customerId, `234${Date.now()}`, businessId],
    );
    await admin.query(
      `INSERT INTO public.conversations(id,"businessId","customerId",status,channel)
       VALUES($1,$2,$3,'open','WHATSAPP')`,
      [conversationId, businessId, customerId],
    );
    await admin.query(
      `INSERT INTO public.messages(id,"conversationId","businessId",direction,content,status,channel,"createdAt")
       VALUES($1,$2,$3,'inbound','private test question','received','WHATSAPP',now()-interval '2 minutes'),
             ($4,$2,$3,'inbound','another private question','received','WHATSAPP',now()-interval '1 minute')`,
      [firstMessageId, conversationId, businessId, secondMessageId],
    );
    await admin.query(
      `INSERT INTO public.messages("conversationId","businessId",direction,content,status,channel,"createdAt")
       SELECT $1,$2,'inbound','fixture message '||n,'received','WHATSAPP',now()-(n||' seconds')::interval
       FROM generate_series(1,998) n`,
      [conversationId, businessId],
    );
    await admin.query(
      `INSERT INTO public.ai_response_runs(id,business_id,inbound_message_id,conversation_id,authorized_control_version,status,evidence,error_category)
       VALUES($1,$2,$3,$4,1,'FAILED','[]'::jsonb,'MODEL_ERROR')`,
      [failedRunId, businessId, firstMessageId, conversationId],
    );
    const access = new MerchantAccess(merchantDb);
    const report = await access.withBusiness(
      { accountId, sessionDigest },
      businessId,
      'analytics.read',
      async (manager) => {
        const [row] = await manager.query<{ report: TestAnalyticsReport }[]>(
          `SELECT public.kleva_merchant_analytics($1,$2,'ALL','UTC') report`,
          [new Date(Date.now() - 86_400_000), new Date(Date.now() + 1000)],
        );
        const [explain] = await manager.query<
          {
            'QUERY PLAN': Array<{ 'Execution Time': number }>;
          }[]
        >(
          `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
           SELECT public.kleva_merchant_analytics($1,$2,'ALL','UTC')`,
          [new Date(Date.now() - 86_400_000), new Date(Date.now() + 1000)],
        );
        expect(
          explain['QUERY PLAN'][0]['Execution Time'],
        ).toBeGreaterThanOrEqual(0);
        console.info(
          'Analytics EXPLAIN ANALYZE, 1,000 inbound messages (ms):',
          explain['QUERY PLAN'][0]['Execution Time'],
        );
        return row.report;
      },
    );
    expect(report.engagement.inboundConversations).toBe(1);
    expect(report.engagement.inboundMessages).toBe(1000);
    expect(report.responses.unanswered).toBe(1);
    expect(report.ai.failedGenerations).toBe(1);
    expect(JSON.stringify(report)).not.toContain('private test question');
  });

  it('keeps raw content inaccessible and rejects membership immediately after revocation', async () => {
    await expect(
      merchantDb.connection().query('SELECT content FROM public.messages'),
    ).rejects.toMatchObject({ driverError: { code: '42501' } });
    await admin.query(
      `UPDATE public.business_members SET status='inactive' WHERE "businessId"=$1 AND "accountId"=$2`,
      [businessId, accountId],
    );
    await expect(
      new MerchantAccess(merchantDb).withBusiness(
        { accountId, sessionDigest },
        businessId,
        'analytics.read',
        async () => 'should not run',
      ),
    ).rejects.toThrow();
  });
});
