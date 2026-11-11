import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AssistantCommandParserService } from '../../src/assistant/assistant-command-parser.service';
import { AssistantService } from '../../src/assistant/assistant.service';
import { CustomerService } from '../../src/assistant/customer.service';
import { ReminderService } from '../../src/assistant/reminder.service';
import { SalesService } from '../../src/assistant/sales.service';
import { Conversation, Message } from '../../src/database/entities';
import { applyMigrations, createIntegrationDatabase } from './postgres';
import { fixtureDueDate, repositories, seedTenant } from './fixtures';

describe('PostgreSQL repository baseline', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let runtime: DataSource;
  let repo: ReturnType<typeof repositories>;
  let first: Awaited<ReturnType<typeof seedTenant>>;
  let second: Awaited<ReturnType<typeof seedTenant>>;

  beforeAll(async () => {
    database = await createIntegrationDatabase();
    const migrator = await database.migrator();
    await applyMigrations(migrator);
    await database.grantRuntimeAccess(migrator);
    await migrator.destroy();

    runtime = await database.runtime();
    repo = repositories(runtime);
    first = await seedTenant(runtime, 1);
    second = await seedTenant(runtime, 2);
  });

  afterAll(async () => {
    await database?.close();
  });

  it('runs repositories with a non-owner role without migration privileges', async () => {
    const [permissions] = await runtime.query<unknown[]>(`
      SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS "canCreate",
             has_table_privilege(current_user, 'public.migrations', 'SELECT') AS "canReadMigrations",
             has_table_privilege(current_user, 'public.customers', 'TRUNCATE') AS "canTruncate",
             pg_has_role(current_user, relowner, 'MEMBER') AS "isTableOwner"
      FROM pg_class WHERE oid = 'public.customers'::regclass
    `);
    expect(permissions).toEqual({
      canCreate: false,
      canReadMigrations: false,
      canTruncate: false,
      isTableOwner: false,
    });
    await expect(
      runtime.query('CREATE TABLE forbidden (id int)'),
    ).rejects.toMatchObject({
      driverError: { code: '42501' },
    });
  });

  it('separates customers with colliding names and phone numbers in scoped queries', async () => {
    expect(first.customer.phone).toBe(second.customer.phone);
    expect(first.customer.whatsappId).toBe(second.customer.whatsappId);
    expect(first.customer.name).toBe(second.customer.name);

    await expect(
      repo.customers.findByPhoneAndBusiness(
        first.customer.phone,
        first.business.id,
      ),
    ).resolves.toMatchObject({ id: first.customer.id });
    await expect(
      repo.customers.findByWhatsappIdAndBusiness(
        first.customer.whatsappId,
        second.business.id,
      ),
    ).resolves.toMatchObject({ id: second.customer.id });
    await expect(
      repo.customers.findByNameForOwner(
        'ada customer',
        first.business.id,
        first.owner.id,
      ),
    ).resolves.toMatchObject({ id: first.customer.id });
    await expect(
      repo.customers.findByBusinessAndOwner(first.business.id, second.owner.id),
    ).resolves.toEqual([]);
  });

  it.each(['phone', 'whatsappId'] as const)(
    'rejects a duplicate customer %s within one tenant',
    async (field) => {
      await expect(
        repo.customers.create({
          businessId: first.business.id,
          ownerId: first.owner.id,
          name: 'Duplicate customer',
          phone: '2348300000003',
          whatsappId: '2348300000003',
          [field]: first.customer[field],
        }),
      ).rejects.toMatchObject({
        driverError: {
          code: '23505',
          constraint: `IDX_customers_businessId_${field}`,
        },
      });
    },
  );

  it('rejects duplicate inbound provider IDs across conversations and tenants', async () => {
    for (const tenant of [first, second]) {
      await expect(
        repo.messages.create({
          businessId: tenant.business.id,
          conversationId: tenant.conversation.id,
          direction: 'inbound',
          content: 'Retry',
          whatsappMessageId: first.message.whatsappMessageId,
        }),
      ).rejects.toMatchObject({
        driverError: {
          code: '23505',
          constraint: 'IDX_messages_whatsappMessageId',
        },
      });
    }
    await expect(
      repo.messages.findByProviderId(first.message.whatsappMessageId!),
    ).resolves.toMatchObject({
      id: first.message.id,
      content: first.message.content,
    });
  });

  it('loads conversations and messages through their persisted relationships', async () => {
    await expect(
      repo.conversations.findLatestForCustomer(
        first.business.id,
        first.customer.id,
      ),
    ).resolves.toMatchObject({ id: first.conversation.id });
    await expect(
      repo.conversations.findLatestForCustomer(
        first.business.id,
        second.customer.id,
      ),
    ).resolves.toBeNull();
    await expect(
      runtime.getRepository(Conversation).findOne({
        where: { id: first.conversation.id },
        relations: { customer: true, messages: true },
      }),
    ).resolves.toMatchObject({
      customer: { id: first.customer.id },
      messages: [{ id: first.message.id }],
    });
  });

  it('enforces parent existence and cascades deletion of a conversation to its messages', async () => {
    await expect(
      repo.conversations.create({
        businessId: first.business.id,
        customerId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      driverError: { code: '23503', constraint: 'FK_conversations_customer' },
    });
    await expect(
      repo.messages.create({
        businessId: first.business.id,
        conversationId: randomUUID(),
        direction: 'inbound',
        content: 'Orphan',
      }),
    ).rejects.toMatchObject({
      driverError: { code: '23503', constraint: 'FK_messages_conversation' },
    });

    const conversation = await repo.conversations.create({
      businessId: first.business.id,
      customerId: first.customer.id,
    });
    const message = await repo.messages.create({
      businessId: first.business.id,
      conversationId: conversation.id,
      direction: 'inbound',
      content: 'Cascade fixture',
    });
    await runtime.getRepository(Conversation).delete(conversation.id);
    await expect(
      runtime.getRepository(Message).findOneBy({ id: message.id }),
    ).resolves.toBeNull();
  });

  it('scopes follow-ups and sales to the owner and business', async () => {
    const day = new Date('2030-06-01T00:00:00Z');
    const nextDay = new Date('2030-06-02T00:00:00Z');
    await expect(
      repo.followUps.findDueForBusinessAndOwnerInRange(
        first.business.id,
        first.owner.id,
        day,
        nextDay,
      ),
    ).resolves.toMatchObject([
      { id: first.followUp.id, dueDate: fixtureDueDate },
    ]);
    await expect(
      repo.followUps.findDueForBusinessAndOwnerInRange(
        first.business.id,
        second.owner.id,
        day,
        nextDay,
      ),
    ).resolves.toEqual([]);
    const start = new Date(second.sale.createdAt.getTime() - 1000);
    const end = new Date(second.sale.createdAt.getTime() + 1000);
    await expect(
      repo.sales.findByBusinessAndOwnerForDateRange(
        second.business.id,
        second.owner.id,
        start,
        end,
      ),
    ).resolves.toMatchObject([{ id: second.sale.id }]);
    await expect(
      repo.sales.findByBusinessAndOwnerForDateRange(
        second.business.id,
        first.owner.id,
        start,
        end,
      ),
    ).resolves.toEqual([]);
  });

  it('resumes the owner create-customer command across connections without consuming another owner’s state', async () => {
    const assistant = (dependencies: ReturnType<typeof repositories>) =>
      new AssistantService(
        new AssistantCommandParserService(),
        dependencies.assistantState,
        new CustomerService(dependencies.customers),
        new SalesService(dependencies.sales),
        new ReminderService(dependencies.followUps),
      );
    const ownerContext = {
      businessId: first.business.id,
      ownerId: first.owner.id,
      timezone: 'Africa/Lagos',
    };
    const otherContext = {
      ...ownerContext,
      businessId: second.business.id,
      ownerId: second.owner.id,
    };
    const command = {
      from: 'fixture-owner',
      type: 'text' as const,
      message: 'Create customer',
    };
    const original = assistant(repo);
    await original.handleIncomingMessage(command, ownerContext);
    await original.handleIncomingMessage(command, otherContext);
    await original.handleIncomingMessage(
      { ...command, message: 'Bola' },
      ownerContext,
    );

    const newConnection = await database.runtime();
    try {
      const fresh = repositories(newConnection);
      const { assistantState } = fresh;
      await expect(
        assistantState.get(first.business.id, first.owner.id),
      ).resolves.toEqual({
        type: 'create_customer',
        step: 2,
        draft: { name: 'Bola' },
      });
      await expect(
        assistantState.get(first.business.id, second.owner.id),
      ).resolves.toBeUndefined();
      await expect(
        assistant(fresh).handleIncomingMessage(
          { ...command, message: '+234 830 000 0004' },
          ownerContext,
        ),
      ).resolves.toMatchObject({ message: 'Customer Bola created.' });
      await expect(
        fresh.customers.findByPhoneForOwner(
          '2348300000004',
          first.business.id,
          first.owner.id,
        ),
      ).resolves.toMatchObject({ name: 'Bola' });
      await expect(
        assistantState.get(first.business.id, first.owner.id),
      ).resolves.toBeUndefined();
      await expect(
        assistantState.get(second.business.id, second.owner.id),
      ).resolves.toEqual({ type: 'create_customer', step: 1, draft: {} });
    } finally {
      await newConnection.destroy();
    }
  });

  // Update this characterization when TENANT-001 adds same-tenant constraints.
  it('documents that foreign keys currently permit a conversation or message to reference another tenant', async () => {
    const conversation = await repo.conversations.create({
      businessId: first.business.id,
      customerId: second.customer.id,
    });
    try {
      expect(conversation).toMatchObject({
        businessId: first.business.id,
        customerId: second.customer.id,
      });
      await expect(
        repo.messages.create({
          businessId: second.business.id,
          conversationId: conversation.id,
          direction: 'inbound',
          content: 'Cross-tenant constraint fixture',
        }),
      ).resolves.toMatchObject({
        businessId: second.business.id,
        conversationId: conversation.id,
      });
    } finally {
      await runtime.getRepository(Conversation).delete(conversation.id);
    }
  });
});
