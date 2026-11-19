import { databaseMigrations } from '../../src/database/schema';
import { applyMigrations, createIntegrationDatabase } from './postgres';

const expectedTables = [
  'accounts',
  'ai_response_runs',
  'assistant_sessions',
  'audit_logs',
  'business_members',
  'business_pilot_enrollments',
  'business_usage_limits',
  'businesses',
  'channel_connections',
  'conversation_control_audit',
  'conversations',
  'customers',
  'follow_ups',
  'knowledge_faq_events',
  'knowledge_faq_revisions',
  'knowledge_faqs',
  'merchant_auth_identities',
  'merchant_auth_profiles',
  'merchant_auth_rate_limits',
  'merchant_auth_tokens',
  'merchant_business_requests',
  'merchant_email_deliveries',
  'merchant_lead_events',
  'merchant_leads',
  'merchant_login_attempts',
  'merchant_onboarding_progress',
  'merchant_password_credentials',
  'merchant_product_events',
  'merchant_product_revisions',
  'merchant_products',
  'merchant_sessions',
  'messages',
  'notifications',
  'onboarding_sessions',
  'outbox_operations',
  'pipeline_stages',
  'sales',
  'tasks',
  'usage_reservations',
  'users',
  'webhook_receipts',
  'whatsapp_credentials',
  'whatsapp_signup_attempts',
  'whatsapp_outbound_messages',
  'whatsapp_response_intents',
  'whatsapp_unmatched_statuses',
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
        'FK_conversation_takeover_actor',
        'FK_business_usage_limits_business',
        'FK_channel_connections_business',
        'FK_whatsapp_credentials_tenant',
        'FK_webhook_connection_tenant',
        'FK_webhook_outbox_tenant',
        'FK_whatsapp_response_receipt_tenant',
        'FK_whatsapp_response_message_tenant',
        'business_pilot_enrollments_business_id_fkey',
        'business_pilot_enrollments_connection_id_fkey',
        'business_pilot_enrollments_merchant_account_id_fkey',
        'business_pilot_enrollments_revoked_by_account_id_fkey',
        'conversation_control_audit_business_id_conversation_id_fkey',
        'conversation_control_audit_actor_account_id_fkey',
        'FK_conversations_customer',
        'FK_customers_business',
        'FK_customers_owner',
        'FK_follow_ups_business',
        'FK_follow_ups_customer',
        'FK_follow_ups_owner',
        'FK_merchant_sessions_account',
        'merchant_business_requests_account_id_fkey',
        'merchant_business_requests_business_id_fkey',
        'fk_merchant_leads_customer',
        'fk_merchant_leads_conversation',
        'fk_ai_response_message',
        'fk_ai_response_conversation',
        'fk_ai_response_lead',
        'fk_ai_response_outbound',
        'merchant_lead_events_business_id_lead_id_fkey',
        'merchant_lead_events_actor_account_id_fkey',
        'FK_messages_conversation',
        'FK_outbox_operations_business',
        'FK_knowledge_faq_business',
        'FK_knowledge_faq_created_by',
        'FK_knowledge_faq_updated_by',
        'FK_knowledge_faq_draft_revision',
        'FK_knowledge_faq_published_revision',
        'FK_knowledge_revision_faq',
        'FK_knowledge_revision_actor',
        'knowledge_faq_events_business_id_faq_id_fkey',
        'knowledge_faq_events_revision_id_business_id_faq_id_fkey',
        'knowledge_faq_events_actor_account_id_fkey',
        'merchant_auth_identities_account_id_fkey',
        'merchant_auth_profiles_account_id_fkey',
        'merchant_auth_tokens_account_id_fkey',
        'merchant_login_attempts_link_account_id_fkey',
        'merchant_onboarding_progress_account_id_fkey',
        'merchant_password_credentials_account_id_fkey',
        'FK_merchant_product_business',
        'FK_merchant_product_created_by',
        'FK_merchant_product_updated_by',
        'FK_merchant_product_revision_product',
        'FK_merchant_product_revision_actor',
        'FK_merchant_product_draft_revision',
        'FK_merchant_product_published_revision',
        'merchant_product_events_business_id_product_id_fkey',
        'merchant_product_events_revision_id_business_id_product_id_fkey',
        'merchant_product_events_actor_account_id_fkey',
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
        'FK_usage_reservations_business',
        'FK_wa_outbound_business',
        'FK_wa_outbound_connection_tenant',
        'FK_wa_outbound_conversation_tenant',
        'FK_wa_outbound_message_tenant',
        'FK_wa_outbound_outbox_tenant',
        'FK_wa_outbound_response_tenant',
        'whatsapp_unmatched_statuses_connection_id_business_id_fkey',
        'whatsapp_unmatched_statuses_receipt_id_business_id_fkey',
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

  it('preserves text UUID defaults, data, and legacy indexes across tenant conversion and rollback', async () => {
    const prefix = await database.migrator(databaseMigrations.slice(0, 4));
    await applyMigrations(prefix);
    const [business] = await prefix.query<{ id: string }[]>(`
      INSERT INTO businesses (name, phone, "whatsappNumber", "phoneNumberId", "accessToken")
      VALUES ('Default Shop', '2348000000011', '2348000000011', 'default-phone', 'fixture')
      RETURNING id
    `);
    const [owner] = await prefix.query<{ id: string }[]>(`
      INSERT INTO users (email, password, "firstName", "businessId", roles)
      VALUES ('default-owner@example.test', 'fixture', 'Owner', '${business.id}', 'owner')
      RETURNING id
    `);
    const [customer] = await prefix.query<{ id: string }[]>(`
      INSERT INTO customers (name, phone, "whatsappId", "businessId", "ownerId")
      VALUES ('Fixture Customer', '2348000000012', '2348000000012', '${business.id}', '${owner.id}')
      RETURNING id
    `);
    const [conversation] = await prefix.query<{ id: string }[]>(`
      INSERT INTO conversations ("businessId", "customerId")
      VALUES ('${business.id}', '${customer.id}') RETURNING id
    `);
    // Reproduce the deployed schema drift while preserving the existing
    // conversationId -> conversations.id UUID foreign key and business index.
    await prefix.query(
      'ALTER TABLE messages ALTER COLUMN "businessId" TYPE varchar USING "businessId"::varchar',
    );
    const [message] = await prefix.query<{ id: string }[]>(`
      INSERT INTO messages ("businessId", "conversationId", direction, content)
      VALUES ('${business.id}', '${conversation.id}', 'inbound', 'fixture') RETURNING id
    `);
    for (const table of [
      'notifications',
      'messages',
      'onboarding_sessions',
      'pipeline_stages',
    ]) {
      await prefix.query(
        `ALTER TABLE ${table} ALTER COLUMN "businessId" SET DEFAULT '${business.id}'`,
      );
    }
    await prefix.query(
      `ALTER TABLE onboarding_sessions ALTER COLUMN "ownerId" SET DEFAULT '${owner.id}'`,
    );
    const reproducer = prefix.createQueryRunner();
    await reproducer.connect();
    await reproducer.startTransaction();
    await expect(
      reproducer.query(
        'ALTER TABLE notifications ALTER COLUMN "businessId" TYPE uuid USING "businessId"::uuid',
      ),
    ).rejects.toMatchObject({ code: '42804' });
    await reproducer.rollbackTransaction();
    await reproducer.release();
    await prefix.query(
      `INSERT INTO notifications ("businessId", "recipientPhone", type, title, body)
       VALUES (DEFAULT, '2348000000011', 'test', 'fixture', 'fixture')`,
    );
    await prefix.query(
      `INSERT INTO pipeline_stages ("businessId", name) VALUES (DEFAULT, 'Fixture')`,
    );
    await prefix.query(
      `INSERT INTO onboarding_sessions ("whatsappId", "businessId", "ownerId")
       VALUES ('2348000000011', DEFAULT, DEFAULT)`,
    );
    const fkReproducer = prefix.createQueryRunner();
    await fkReproducer.connect();
    await fkReproducer.startTransaction();
    await fkReproducer.query(
      'ALTER TABLE conversations ADD CONSTRAINT test_conversations_tenant_key UNIQUE ("businessId", id)',
    );
    await expect(
      fkReproducer.query(`
        ALTER TABLE messages ADD CONSTRAINT "FK_messages_conversationId_tenant"
          FOREIGN KEY ("businessId", "conversationId")
          REFERENCES conversations ("businessId", id) ON DELETE CASCADE NOT VALID
      `),
    ).rejects.toMatchObject({ code: '42804' });
    await fkReproducer.rollbackTransaction();
    await fkReproducer.release();
    const originalIndexes = await prefix.query<{ indexname: string }[]>(`
      SELECT indexname FROM pg_indexes WHERE schemaname='public'
        AND tablename IN ('messages','notifications','onboarding_sessions','pipeline_stages')
      ORDER BY indexname
    `);
    await prefix.destroy();

    const source = await database.migrator(databaseMigrations.slice(0, 5));
    expect((await applyMigrations(source)).map(({ name }) => name)).toEqual([
      databaseMigrations[4].name,
    ]);
    const converted = await source.query<
      {
        table_name: string;
        column_name: string;
        data_type: string;
        column_default: string | null;
      }[]
    >(`
      SELECT table_name, column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND
        ((table_name IN ('messages','notifications','pipeline_stages') AND column_name='businessId') OR
         (table_name='onboarding_sessions' AND column_name IN ('businessId','ownerId')))
      ORDER BY table_name,column_name
    `);
    expect(converted).toHaveLength(5);
    expect(converted.every(({ data_type }) => data_type === 'uuid')).toBe(true);
    expect(
      converted.every(({ column_default }) => column_default?.includes('uuid')),
    ).toBe(true);
    const convertedIndexes = await source.query<{ indexname: string }[]>(`
      SELECT indexname FROM pg_indexes WHERE schemaname='public'
        AND tablename IN ('messages','notifications','onboarding_sessions','pipeline_stages')
      ORDER BY indexname
    `);
    expect(convertedIndexes.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining(originalIndexes.map(({ indexname }) => indexname)),
    );
    expect(
      await source.query<{ table_name: string; count: number }[]>(`
        SELECT 'notifications' AS table_name, count(*)::int AS count FROM notifications
        UNION ALL SELECT 'pipeline_stages', count(*)::int FROM pipeline_stages
        UNION ALL SELECT 'onboarding_sessions', count(*)::int FROM onboarding_sessions
        UNION ALL SELECT 'messages', count(*)::int FROM messages
        ORDER BY table_name
      `),
    ).toEqual([
      { table_name: 'messages', count: 1 },
      { table_name: 'notifications', count: 1 },
      { table_name: 'onboarding_sessions', count: 1 },
      { table_name: 'pipeline_stages', count: 1 },
    ]);
    expect(
      await source.query<{ business_id: string; owner_id: string }[]>(`
        SELECT "businessId"::text AS business_id, "ownerId"::text AS owner_id
        FROM onboarding_sessions
      `),
    ).toEqual([{ business_id: business.id, owner_id: owner.id }]);
    expect(
      await source.query<
        { id: string; business_id: string; conversation_id: string }[]
      >(`
        SELECT id::text AS id, "businessId"::text AS business_id,
          "conversationId"::text AS conversation_id FROM messages
      `),
    ).toEqual([
      {
        id: message.id,
        business_id: business.id,
        conversation_id: conversation.id,
      },
    ]);
    const [sameTenantMessage] = await source.query<
      { id: string; business_id: string; conversation_id: string }[]
    >(`
      INSERT INTO messages ("businessId", "conversationId", direction, content)
      VALUES ('${business.id}', '${conversation.id}', 'inbound', 'same-tenant fixture')
      RETURNING id::text AS id, "businessId"::text AS business_id,
        "conversationId"::text AS conversation_id
    `);
    expect(sameTenantMessage).toMatchObject({
      business_id: business.id,
      conversation_id: conversation.id,
    });
    const compositeFk = await source.query<
      { convalidated: boolean; definition: string }[]
    >(`
      SELECT convalidated, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conname='FK_messages_conversationId_tenant'
    `);
    expect(compositeFk).toHaveLength(1);
    expect(compositeFk[0].convalidated).toBe(true);
    expect(compositeFk[0].definition).toContain(
      'FOREIGN KEY ("businessId", "conversationId") REFERENCES conversations("businessId", id)',
    );
    const [otherBusiness] = await source.query<{ id: string }[]>(`
      INSERT INTO businesses (name, phone, "whatsappNumber", "phoneNumberId", "accessToken")
      VALUES ('Other Shop', '2348000000013', '2348000000013', 'other-phone', 'fixture')
      RETURNING id
    `);
    await expect(
      source.query(
        `INSERT INTO messages ("businessId", "conversationId", direction, content)
         VALUES ('${otherBusiness.id}', '${conversation.id}', 'inbound', 'cross-tenant fixture')`,
      ),
    ).rejects.toMatchObject({ code: '23503' });
    expect(await applyMigrations(source)).toEqual([]);
    expect(
      await source.query<{ count: number }[]>(`
        SELECT count(*)::int AS count FROM pg_constraint
        WHERE conname='FK_messages_conversationId_tenant'
      `),
    ).toEqual([{ count: 1 }]);

    await source.undoLastMigration();
    const restored = await source.query<
      { data_type: string; column_default: string | null }[]
    >(`
      SELECT data_type,column_default FROM information_schema.columns
      WHERE table_schema='public' AND
        ((table_name IN ('messages','notifications','pipeline_stages') AND column_name='businessId') OR
         (table_name='onboarding_sessions' AND column_name IN ('businessId','ownerId')))
      ORDER BY table_name,column_name
    `);
    expect(restored).toHaveLength(5);
    expect(
      restored.every(({ data_type }) => data_type === 'character varying'),
    ).toBe(true);
    expect(
      restored.every(({ column_default }) => column_default !== null),
    ).toBe(true);
    expect(
      await source.query<{ business_id: string; owner_id: string }[]>(`
        SELECT "businessId" AS business_id, "ownerId" AS owner_id FROM onboarding_sessions
      `),
    ).toEqual([{ business_id: business.id, owner_id: owner.id }]);
    expect(
      await source.query<{ table_name: string; count: number }[]>(`
        SELECT 'notifications' AS table_name, count(*)::int AS count FROM notifications
        UNION ALL SELECT 'pipeline_stages', count(*)::int FROM pipeline_stages
        UNION ALL SELECT 'onboarding_sessions', count(*)::int FROM onboarding_sessions
        UNION ALL SELECT 'messages', count(*)::int FROM messages
        ORDER BY table_name
      `),
    ).toEqual([
      { table_name: 'messages', count: 2 },
      { table_name: 'notifications', count: 1 },
      { table_name: 'onboarding_sessions', count: 1 },
      { table_name: 'pipeline_stages', count: 1 },
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
