import { databaseMigrations } from '../../src/database/schema';
import { applyMigrations, createIntegrationDatabase } from './postgres';

const expectedTables = [
  'accounts',
  'assistant_sessions',
  'audit_logs',
  'business_members',
  'businesses',
  'channel_connections',
  'conversations',
  'customers',
  'follow_ups',
  'merchant_business_requests',
  'merchant_login_attempts',
  'merchant_sessions',
  'messages',
  'notifications',
  'onboarding_sessions',
  'outbox_operations',
  'pipeline_stages',
  'sales',
  'tasks',
  'users',
  'webhook_receipts',
  'whatsapp_credentials',
];

type IntegrationDatabase = Awaited<
  ReturnType<typeof createIntegrationDatabase>
>;

describe('PostgreSQL migration baseline', () => {
  let database: IntegrationDatabase;

  beforeEach(async () => {
    database = await createIntegrationDatabase();
  });

  afterEach(async () => {
    await database?.close();
  });

  it('applies every migration, checks tables and foreign keys, reverts, and reapplies', async () => {
    const source = await database.migrator();
    const tableNames = async () => {
      const tables = await source.query<{ tablename: string }[]>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations' ORDER BY tablename",
      );
      return tables.map(({ tablename }) => tablename);
    };

    expect(await tableNames()).toEqual([]);
    const expectedMigrations = databaseMigrations.map(({ name }) => name);
    expect((await applyMigrations(source)).map(({ name }) => name)).toEqual(
      expectedMigrations,
    );
    expect(await tableNames()).toEqual(expectedTables);

    const foreignKeys = await source.query<{ constraint_name: string }[]>(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE constraint_schema = 'public' AND constraint_type = 'FOREIGN KEY'
      ORDER BY constraint_name
    `);
    expect(
      foreignKeys.map(({ constraint_name }) => constraint_name).sort(),
    ).toEqual(
      [
        'FK_assistant_sessions_business',
        'FK_assistant_sessions_owner',
        'FK_audit_logs_business',
        'FK_audit_logs_user',
        'FK_conversations_business',
        'FK_channel_connections_business',
        'FK_whatsapp_credentials_tenant',
        'FK_webhook_connection_tenant',
        'FK_webhook_outbox_tenant',
        'FK_conversations_customer',
        'FK_customers_business',
        'FK_customers_owner',
        'FK_follow_ups_business',
        'FK_follow_ups_customer',
        'FK_follow_ups_owner',
        'FK_merchant_sessions_account',
        'merchant_business_requests_account_id_fkey',
        'merchant_business_requests_business_id_fkey',
        'FK_messages_conversation',
        'FK_outbox_operations_business',
        'FK_sales_business',
        'FK_sales_customer',
        'FK_sales_owner',
        'FK_tasks_business',
        'FK_tasks_owner',
        'FK_users_business',
        'FK_assistant_sessions_ownerId_tenant',
        'FK_audit_logs_userId_tenant',
        'FK_conversations_customerId_tenant',
        'FK_customers_ownerId_tenant',
        'FK_follow_ups_customerId_tenant',
        'FK_follow_ups_ownerId_tenant',
        'FK_members_account',
        'FK_members_business',
        'FK_members_legacy_tenant',
        'FK_messages_conversationId_tenant',
        'FK_messages_tenant_business',
        'FK_notifications_tenant_business',
        'FK_onboarding_sessions_ownerId_tenant',
        'FK_onboarding_sessions_tenant_business',
        'FK_pipeline_stages_tenant_business',
        'FK_sales_customerId_tenant',
        'FK_sales_ownerId_tenant',
        'FK_tasks_ownerId_tenant',
      ].sort(),
    );

    const { username } = await database.merchantCredentials(source);
    for (const name of [...expectedMigrations].reverse()) {
      const [latest] = await source.query<{ name: string }[]>(
        'SELECT name FROM migrations ORDER BY id DESC LIMIT 1',
      );
      expect(latest.name).toBe(name);
      await source.undoLastMigration();
      if (name === 'AddMerchantAuth1760000000004') {
        const [acl] = await source.query<{ canRead: boolean }[]>(
          `SELECT has_column_privilege($1, 'public.businesses', 'name', 'SELECT') AS "canRead"`,
          [username],
        );
        expect(acl.canRead).toBe(false);
      }
    }
    expect(await tableNames()).toEqual([]);
    expect((await applyMigrations(source)).map(({ name }) => name)).toEqual(
      expectedMigrations,
    );
    expect(await tableNames()).toEqual(expectedTables);
    expect(await source.showMigrations()).toBe(false);
  });

  async function seedInitialSchema() {
    // Use SQL so the seed only references columns available at this version.
    const source = await database.migrator(databaseMigrations.slice(0, 1));
    await applyMigrations(source);
    const [business] = await source.query<{ id: string }[]>(`
      INSERT INTO businesses (name, phone, "whatsappNumber", "phoneNumberId", "accessToken")
      VALUES ('Legacy Shop', '2348000000001', '2348000000001', 'legacy-phone', 'fixture')
      RETURNING id
    `);
    const [owner] = await source.query<{ id: string }[]>(
      `
      INSERT INTO users (email, password, "firstName", "businessId", roles)
      VALUES ('owner@example.test', 'fixture', 'Owner', $1, 'owner')
      RETURNING id
    `,
      [business.id],
    );
    const [customer] = await source.query<{ id: string }[]>(
      `
      INSERT INTO customers (name, phone, "whatsappId", "businessId", "ownerId")
      VALUES ('Legacy Customer', '2348000000002', '2348000000002', $1, $2)
      RETURNING id
    `,
      [business.id, owner.id],
    );
    const [conversation] = await source.query<{ id: string }[]>(
      `
      INSERT INTO conversations ("businessId", "customerId")
      VALUES ($1, $2) RETURNING id
    `,
      [business.id, customer.id],
    );
    const [message] = await source.query<{ id: string }[]>(
      `
      INSERT INTO messages ("businessId", "conversationId", direction, content, "whatsappMessageId")
      VALUES ($1, $2, 'inbound', 'Legacy text', 'legacy-message') RETURNING id
    `,
      [business.id, conversation.id],
    );
    return { source, business, owner, customer, conversation, message };
  }

  it('preserves legacy rows through the seeded upgrade', async () => {
    const {
      source: initial,
      business,
      owner,
      customer,
      conversation,
      message,
    } = await seedInitialSchema();
    await initial.destroy();

    const source = await database.migrator();
    expect((await applyMigrations(source)).map(({ name }) => name)).toEqual(
      databaseMigrations.slice(1).map(({ name }) => name),
    );
    const rows = await source.query<unknown[]>(`
      SELECT b.id AS business, u.id AS owner, c.id AS customer,
        t.id AS conversation, m.id AS message, m.content,
        m."whatsappMessageId", b."phoneNumberId"
      FROM businesses b
      JOIN users u ON u."businessId" = b.id
      JOIN customers c ON c."ownerId" = u.id
      JOIN conversations t ON t."customerId" = c.id
      JOIN messages m ON m."conversationId" = t.id
    `);
    expect(rows).toEqual([
      {
        business: business.id,
        owner: owner.id,
        customer: customer.id,
        conversation: conversation.id,
        message: message.id,
        content: 'Legacy text',
        whatsappMessageId: 'legacy-message',
        phoneNumberId: 'legacy-phone',
      },
    ]);
  });

  it('identifies duplicate legacy provider IDs that prevent an upgrade and rolls back', async () => {
    const {
      source: initial,
      business,
      conversation,
    } = await seedInitialSchema();
    await initial.query(
      `
      INSERT INTO messages ("businessId", "conversationId", direction, content, "whatsappMessageId")
      VALUES ($1, $2, 'inbound', 'Duplicate', 'legacy-message')
    `,
      [business.id, conversation.id],
    );
    await initial.destroy();

    const source = await database.migrator();
    // TypeORM logs the underlying failure even with normal query logging off.
    jest
      .spyOn(source.logger, 'logMigration')
      .mockImplementation(() => undefined);
    jest
      .spyOn(source.logger, 'logQueryError')
      .mockImplementation(() => undefined);
    await expect(applyMigrations(source)).rejects.toMatchObject({
      message: expect.stringMatching(
        /Migration failed in kleva_integration_.*IDX_messages_whatsappMessageId/,
      ),
      cause: expect.objectContaining({
        driverError: expect.objectContaining({ code: '23505' }),
      }),
    });
    expect(
      await source.query<unknown[]>('SELECT name FROM migrations'),
    ).toEqual([{ name: databaseMigrations[0].name }]);
    expect(
      await source.query<unknown[]>(
        'SELECT count(*)::int AS count FROM messages',
      ),
    ).toEqual([{ count: 2 }]);
  });
});
