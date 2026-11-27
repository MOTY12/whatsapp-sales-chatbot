import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { seedTenant } from './fixtures';
import { applyMigrations, createIntegrationDatabase } from './postgres';

describe('commercial website pilot and manual billing', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let admin: DataSource;
  let runtime: DataSource;
  let merchant: DataSource;
  let operator: DataSource;
  let tenant: Awaited<ReturnType<typeof seedTenant>>;
  let foreignTenant: Awaited<ReturnType<typeof seedTenant>>;
  let businessOwnerId: string;
  const merchantDigest = 'commercial-owner-session';
  let offerId: string;
  let invoiceId: string;
  let originalCommercialDatabase: string | undefined;
  let originalCommercialPassword: string | undefined;

  beforeAll(async () => {
    originalCommercialDatabase = process.env.COMMERCIAL_OPERATOR_DATABASE_USER;
    originalCommercialPassword =
      process.env.COMMERCIAL_OPERATOR_DATABASE_PASSWORD;
    database = await createIntegrationDatabase();
    admin = await database.migrator();
    await applyMigrations(admin);
    tenant = await seedTenant(admin, 1);
    foreignTenant = await seedTenant(admin, 2);
    const merchantCredentials = await database.merchantCredentials(admin);
    const operatorCredentials = await database.commercialOperator(admin);
    await database.grantRuntimeAccess(admin);
    merchant = new DataSource({
      type: 'postgres',
      host: merchantCredentials.host,
      port: Number(merchantCredentials.port),
      username: merchantCredentials.username,
      password: merchantCredentials.password,
      database: merchantCredentials.database,
      synchronize: false,
    });
    await merchant.initialize();
    runtime = await database.runtime();
    operator = new DataSource({
      type: 'postgres',
      host: operatorCredentials.host,
      port: Number(operatorCredentials.port),
      username: operatorCredentials.username,
      password: operatorCredentials.password,
      database: operatorCredentials.database,
      synchronize: false,
    });
    await operator.initialize();
    const [owner] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.accounts(issuer,subject) VALUES ('https://commercial.test','owner') RETURNING id`,
    );
    businessOwnerId = owner.id;
    await admin.query(
      `INSERT INTO public.business_members("businessId","accountId",role,status) VALUES ($1,$2,'owner','active')`,
      [tenant.business.id, businessOwnerId],
    );
    await admin.query(
      `INSERT INTO public.merchant_sessions(token_digest,csrf_digest,account_id) VALUES ($1,'csrf',$2)`,
      [merchantDigest, businessOwnerId],
    );
  });

  afterAll(async () => {
    await operator?.destroy();
    await merchant?.destroy();
    await runtime?.destroy();
    await database?.close();
    if (originalCommercialDatabase === undefined)
      delete process.env.COMMERCIAL_OPERATOR_DATABASE_USER;
    else
      process.env.COMMERCIAL_OPERATOR_DATABASE_USER =
        originalCommercialDatabase;
    if (originalCommercialPassword === undefined)
      delete process.env.COMMERCIAL_OPERATOR_DATABASE_PASSWORD;
    else
      process.env.COMMERCIAL_OPERATOR_DATABASE_PASSWORD =
        originalCommercialPassword;
  });

  async function ownerCall<T>(query: string, values: unknown[] = []) {
    return merchant.transaction(async (manager) => {
      await manager.query(
        "SELECT set_config('kleva.business_id',$1,true),set_config('kleva.session_digest',$2,true)",
        [tenant.business.id, merchantDigest],
      );
      return manager.query<T>(query, values);
    });
  }

  it('accepts versioned website-only terms, reconciles partial payments, provisions quotas, and expires safely', async () => {
    await operator.query(
      'SELECT public.kleva_commercial_capacity_set(3,3,3,30,10000,10000,5000,1000)',
    );
    const [created] = await operator.query<
      { result: { packageId: string; versionId: string; version: number } }[]
    >(
      `SELECT public.kleva_commercial_create_package($1,$2,$3,$4::numeric,$5,$6,$7,$8::jsonb,$9,$10::jsonb) AS result`,
      [
        'website-starter',
        'Website Starter',
        'Website chat pilot',
        '12000.00',
        'PILOT',
        30,
        ['WEBSITE'],
        JSON.stringify({
          aiInputTokens: 1000,
          aiOutputTokens: 1000,
          embeddingTokens: 500,
          whatsappOutbound: 0,
        }),
        400,
        JSON.stringify({
          description:
            'Email support; hours and escalation contact to be confirmed.',
        }),
      ],
    );
    await operator.query('SELECT public.kleva_commercial_package_approve($1)', [
      created.result.versionId,
    ]);
    offerId = randomUUID();
    const [offer] = await operator.query<{ enrollment_id: string }[]>(
      'SELECT public.kleva_commercial_offer_create($1,$2,$3,$4,$5) AS enrollment_id',
      [
        tenant.business.id,
        created.result.versionId,
        offerId,
        'pilot-terms-draft-v1',
        'Support owner pending assignment',
      ],
    );
    offerId = offer.enrollment_id;

    const [accepted] = await ownerCall<
      { status: string; accepted_by: string; channels: string[] }[]
    >(
      "SELECT public.kleva_commercial_offer_accept($1,$2) AS status, (public.kleva_commercial_offer_accept($1,$2)->>'accepted_by')::uuid AS accepted_by",
      [offerId, randomUUID()],
    );
    expect(accepted.status).toBeDefined();
    const [commercial] = await ownerCall<
      {
        commercial: {
          enrollment: {
            status: string;
            channels: string[];
            package_version: number;
          };
        };
      }[]
    >('SELECT public.kleva_commercial_read() AS commercial');
    expect(commercial.commercial.enrollment.status).toBe('ACCEPTED');
    expect(commercial.commercial.enrollment.channels).toEqual(['WEBSITE']);
    expect(commercial.commercial.enrollment.package_version).toBe(1);
    await ownerCall('SELECT public.kleva_commercial_offer_accept($1,$2)', [
      offerId,
      randomUUID(),
    ]);
    const [agreementCount] = await admin.query<{ count: string }[]>(
      'SELECT count(*) FROM public.commercial_pilot_agreements WHERE business_id=$1 AND enrollment_id=$2',
      [tenant.business.id, offerId],
    );
    expect(Number(agreementCount.count)).toBe(1);

    await expect(
      ownerCall('SELECT public.kleva_commercial_offer_accept($1,$2)', [
        randomUUID(),
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ driverError: { code: '22023' } });
    const [versionTwo] = await operator.query<
      { result: { version: number } }[]
    >(
      `SELECT public.kleva_commercial_package_version_create($1,$2,$3,$4::numeric,$5,$6,$7,$8::jsonb,$9,$10::jsonb) AS result`,
      [
        created.result.packageId,
        'Website Starter v2',
        'Revised future terms',
        '15000',
        'PILOT',
        30,
        ['WEBSITE'],
        JSON.stringify({
          aiInputTokens: 1500,
          aiOutputTokens: 1500,
          embeddingTokens: 500,
          whatsappOutbound: 0,
        }),
        500,
        JSON.stringify({ description: 'Updated support coverage' }),
      ],
    );
    expect(versionTwo.result.version).toBe(2);
    const [snapshot] = await admin.query<
      { agreed_price: string; package_version: number }[]
    >(
      'SELECT agreed_price::text,package_version FROM public.commercial_pilot_enrollments WHERE id=$1',
      [offerId],
    );
    expect(snapshot).toEqual({ agreed_price: '12000.00', package_version: 1 });

    const [employee] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.accounts(issuer,subject) VALUES ('https://commercial.test','employee') RETURNING id`,
    );
    await admin.query(
      `INSERT INTO public.business_members("businessId","accountId",role,status) VALUES ($1,$2,'agent','active')`,
      [tenant.business.id, employee.id],
    );
    const employeeDigest = 'commercial-employee-session';
    await admin.query(
      `INSERT INTO public.merchant_sessions(token_digest,csrf_digest,account_id) VALUES ($1,'csrf',$2)`,
      [employeeDigest, employee.id],
    );
    await expect(
      merchant.transaction(async (manager) => {
        await manager.query(
          "SELECT set_config('kleva.business_id',$1,true),set_config('kleva.session_digest',$2,true)",
          [tenant.business.id, employeeDigest],
        );
        await manager.query(
          'SELECT public.kleva_commercial_offer_accept($1,$2)',
          [offerId, randomUUID()],
        );
      }),
    ).rejects.toMatchObject({ driverError: { code: '42501' } });

    await operator.query(
      'SELECT public.kleva_commercial_approve($1,$2::timestamptz)',
      [offerId, new Date(Date.now() - 1000).toISOString()],
    );
    const [invoice] = await operator.query<{ invoice_id: string }[]>(
      'SELECT public.kleva_commercial_invoice_create($1,$2,$3::timestamptz,$4) AS invoice_id',
      [
        offerId,
        `INV-${randomUUID()}`,
        new Date(Date.now() + 86400000).toISOString(),
        'Operational pilot invoice',
      ],
    );
    invoiceId = invoice.invoice_id;
    await operator.query('SELECT public.kleva_commercial_invoice_issue($1)', [
      invoiceId,
    ]);
    const [firstPayment] = await operator.query<{ payment_id: string }[]>(
      'SELECT public.kleva_commercial_payment_record($1,$2::numeric,$3,$4,$5,$6::timestamptz,$7) AS payment_id',
      [
        invoiceId,
        '4000',
        'BANK_TRANSFER',
        'test-bank',
        `TEST-${randomUUID()}`,
        new Date().toISOString(),
        'simulated-test-evidence',
      ],
    );
    await operator.query('SELECT public.kleva_commercial_payment_confirm($1)', [
      firstPayment.payment_id,
    ]);
    await expect(
      operator.query(
        'SELECT public.kleva_commercial_payment_record($1,$2::numeric,$3,$4,$5,$6::timestamptz,$7)',
        [
          invoiceId,
          '9000',
          'BANK_TRANSFER',
          'test-bank',
          `TEST-${randomUUID()}`,
          new Date().toISOString(),
          'simulated-test-evidence',
        ],
      ),
    ).rejects.toMatchObject({ code: '22023' });
    const [secondPayment] = await operator.query<{ payment_id: string }[]>(
      'SELECT public.kleva_commercial_payment_record($1,$2::numeric,$3,$4,$5,$6::timestamptz,$7) AS payment_id',
      [
        invoiceId,
        '8000',
        'BANK_TRANSFER',
        'test-bank',
        `TEST-${randomUUID()}`,
        new Date().toISOString(),
        'simulated-test-evidence',
      ],
    );
    await operator.query('SELECT public.kleva_commercial_payment_confirm($1)', [
      secondPayment.payment_id,
    ]);
    await expect(
      operator.query(
        'SELECT public.kleva_commercial_payment_record($1,$2::numeric,$3,$4,$5,$6::timestamptz,$7)',
        [
          invoiceId,
          '1',
          'BANK_TRANSFER',
          'test-bank',
          `TEST-${randomUUID()}`,
          new Date().toISOString(),
          'simulated-test-evidence',
        ],
      ),
    ).rejects.toMatchObject({ code: '22023' });
    const [paymentState] = await admin.query<
      { paid_amount: string; status: string }[]
    >(
      'SELECT paid_amount::text,status FROM public.commercial_pilot_invoices WHERE id=$1',
      [invoiceId],
    );
    expect(paymentState).toMatchObject({
      paid_amount: '12000.00',
      status: 'PAID',
    });

    const entitlementKey = randomUUID();
    await operator.query('SELECT public.kleva_commercial_provision($1,$2)', [
      offerId,
      entitlementKey,
    ]);
    await operator.query('SELECT public.kleva_commercial_provision($1,$2)', [
      offerId,
      entitlementKey,
    ]);
    const [events] = await admin.query<{ count: string }[]>(
      'SELECT count(*) FROM public.commercial_pilot_entitlement_events WHERE business_id=$1 AND idempotency_key=$2',
      [tenant.business.id, entitlementKey],
    );
    expect(Number(events.count)).toBe(1);
    const [commercialActivation] = await operator.query<
      { activated: boolean }[]
    >('SELECT public.kleva_commercial_activate($1) AS activated', [offerId]);
    expect(commercialActivation.activated).toBe(true);
    const [readiness] = await ownerCall<
      {
        readiness: { checklist: Record<string, boolean>; blockers: string[] };
      }[]
    >('SELECT public.kleva_commercial_readiness() AS readiness');
    expect(readiness.readiness.checklist.websiteOnly).toBe(true);
    expect(readiness.readiness.checklist.whatsappRequired).toBe(false);
    expect(readiness.readiness.blockers).toContain(
      'RELEASE_GATES_REQUIRE_QA_APPROVAL',
    );
    const [waActivation] = await admin.query<{ count: string }[]>(
      'SELECT count(*) FROM public.business_pilot_enrollments WHERE business_id=$1',
      [tenant.business.id],
    );
    expect(Number(waActivation.count)).toBe(0);
    const [limits] = await admin.query<{ monthly_whatsapp_messages: number }[]>(
      'SELECT monthly_whatsapp_messages FROM public.business_usage_limits WHERE business_id=$1',
      [tenant.business.id],
    );
    expect(limits.monthly_whatsapp_messages).toBe(0);
    await admin.query(
      "UPDATE public.commercial_pilot_enrollments SET pilot_start_at=now()-interval '2 days',pilot_end_at=now()-interval '1 day' WHERE id=$1",
      [offerId],
    );
    const [maintenance] = await runtime.query<
      { result: { expiredPilots: number } }[]
    >('SELECT public.kleva_commercial_invoice_status_refresh() AS result');
    expect(maintenance.result.expiredPilots).toBe(1);
    const [expired] = await admin.query<{ status: string }[]>(
      'SELECT status FROM public.commercial_pilot_enrollments WHERE id=$1',
      [offerId],
    );
    expect(expired.status).toBe('EXPIRED');
    await expect(
      merchant.transaction(async (manager) => {
        await manager.query(
          "SELECT set_config('kleva.business_id',$1,true),set_config('kleva.session_digest',$2,true)",
          [foreignTenant.business.id, merchantDigest],
        );
        await manager.query('SELECT public.kleva_commercial_read()');
      }),
    ).rejects.toMatchObject({ driverError: { code: '42501' } });
  });
});
