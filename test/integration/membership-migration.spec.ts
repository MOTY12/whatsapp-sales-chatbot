import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Account } from '../../src/database/entities/account.entity';
import { BusinessMember } from '../../src/database/entities/business-member.entity';
import {
  Business,
  Customer,
  OnboardingSession,
  User,
} from '../../src/database/entities';
import { BusinessRepository } from '../../src/database/repositories/business.repository';
import { UserRepository } from '../../src/database/repositories/user.repository';
import { databaseMigrations } from '../../src/database/schema';
import { inspectTenantIntegrity } from '../../src/database/tenant-integrity';
import { WebhookLeadCaptureService } from '../../src/whatsapp/webhook-lead-capture.service';
import { repositories, seedTenant } from './fixtures';
import { applyMigrations, createIntegrationDatabase } from './postgres';

describe('tenant integrity migration', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let source: DataSource;
  let first: Awaited<ReturnType<typeof seedTenant>>;
  let second: Awaited<ReturnType<typeof seedTenant>>;

  beforeEach(async () => {
    database = await createIntegrationDatabase();
    source = await database.migrator(databaseMigrations.slice(0, -1));
    await applyMigrations(source);
    first = await seedTenant(source, 1);
    second = await seedTenant(source, 2);
  });

  afterEach(async () => {
    await database?.close();
  });

  async function upgrade() {
    await source.destroy();
    source = await database.migrator();
    await applyMigrations(source);
  }

  it('preserves populated records, backfills unclaimed memberships and supports verified accounts across businesses', async () => {
    const staff = await source.getRepository(User).save({
      businessId: first.business.id,
      email: 'staff@example.test',
      password: 'fixture',
      firstName: 'Staff',
      roles: ['user'],
      status: 'inactive',
    });
    const onboarding = await source.getRepository(OnboardingSession).save({
      whatsappId: first.owner.whatsappId!,
      businessId: first.business.id,
      ownerId: first.owner.id,
    });
    await upgrade();
    expect(await source.getRepository(Account).count()).toBe(0);
    const members = source.getRepository(BusinessMember);
    expect(await members.count()).toBe(3);
    await expect(
      members.findOneBy({ legacyUserId: first.owner.id }),
    ).resolves.toMatchObject({
      businessId: first.business.id,
      role: 'owner',
      accountId: null,
      verifiedWhatsappId: null,
    });
    await expect(
      members.findOneBy({ legacyUserId: staff.id }),
    ).resolves.toMatchObject({
      role: 'staff',
      status: 'inactive',
      accountId: null,
    });
    const repo = repositories(source);
    await expect(
      repo.customers.findByPhoneAndBusiness(
        first.customer.phone,
        first.business.id,
      ),
    ).resolves.toMatchObject({ id: first.customer.id });
    await expect(
      repo.customers.findByPhoneAndBusiness(
        first.customer.phone,
        second.business.id,
      ),
    ).resolves.toMatchObject({ id: second.customer.id });
    await expect(
      repo.conversations.findLatestForCustomer(
        first.business.id,
        first.customer.id,
      ),
    ).resolves.toMatchObject({ id: first.conversation.id });
    await expect(
      repo.messages.findByProviderId('fixture-message-1'),
    ).resolves.toMatchObject({ id: first.message.id });
    await expect(
      repo.followUps.findByBusinessId(first.business.id),
    ).resolves.toMatchObject([{ id: first.followUp.id }]);
    await expect(
      source.query('SELECT id FROM sales WHERE id = $1', [first.sale.id]),
    ).resolves.toEqual([{ id: first.sale.id }]);
    await expect(
      source.getRepository(OnboardingSession).findOneBy({ id: onboarding.id }),
    ).resolves.toMatchObject({
      businessId: first.business.id,
      ownerId: first.owner.id,
    });
    await expect(applyMigrations(source)).resolves.toEqual([]);
    expect(await members.count()).toBe(3);

    const account = await source
      .getRepository(Account)
      .save({ issuer: 'https://id.example.test', subject: 'fixture-user' });
    await members.update(
      { legacyUserId: first.owner.id },
      { accountId: account.id },
    );
    await members.insert({
      businessId: second.business.id,
      accountId: account.id,
      role: 'agent',
    });
    expect(await members.countBy({ accountId: account.id })).toBe(2);
    await expect(
      members.insert({
        businessId: second.business.id,
        accountId: account.id,
        role: 'editor',
      }),
    ).rejects.toMatchObject({
      driverError: { code: '23505', constraint: 'UQ_business_members_account' },
    });
    await expect(
      members.insert({
        businessId: second.business.id,
        legacyUserId: second.owner.id,
        role: 'staff',
      }),
    ).rejects.toMatchObject({
      driverError: {
        code: '23505',
        constraint: 'UQ_business_members_legacy_user',
      },
    });
    await expect(
      members.insert({
        businessId: second.business.id,
        legacyUserId: staff.id,
        role: 'staff',
      }),
    ).rejects.toMatchObject({
      driverError: {
        code: '23505',
        constraint: 'UQ_business_members_legacy_user',
      },
    });
    await expect(
      members.update(
        { legacyUserId: staff.id },
        { businessId: second.business.id },
      ),
    ).rejects.toMatchObject({
      driverError: { code: '23503', constraint: 'FK_members_legacy_tenant' },
    });
    await expect(source.undoLastMigration()).rejects.toThrow(
      'account data exists',
    );
  });

  it('reports ambiguous and invalid legacy data, then allows a reviewed repair and rollback', async () => {
    const duplicate = await source.getRepository(User).save({
      businessId: first.business.id,
      email: 'private@example.test',
      password: 'private-fixture',
      firstName: 'Legacy duplicate owner',
      roles: ['owner'],
    });
    const notificationId = randomUUID();
    await source.query(
      `
      INSERT INTO notifications (id, "businessId", "recipientPhone", type, title, body)
      VALUES ($1, 'legacy-invalid-value', 'fixture-phone', 'update', 'private-title', 'private-message')
    `,
      [notificationId],
    );
    await source
      .getRepository(Customer)
      .update(first.customer.id, { ownerId: second.owner.id });
    expect(await inspectTenantIntegrity(source)).toEqual([
      {
        issue: 'businesses.multiple_active_legacy_owners',
        count: 1,
        blocking: true,
      },
      { issue: 'customers.ownerId.cross_tenant', count: 1, blocking: true },
      {
        issue: 'notifications.businessId.missing_or_invalid',
        count: 1,
        blocking: true,
      },
    ]);
    jest
      .spyOn(source.logger, 'logMigration')
      .mockImplementation(() => undefined);
    await expect(upgrade()).rejects.toThrow(
      'Tenant integrity preflight blocked migration',
    );
    await expect(
      source.query("SELECT to_regclass('business_members') AS relation"),
    ).resolves.toEqual([{ relation: null }]);
    await expect(
      source.getRepository(Customer).findOneBy({ id: first.customer.id }),
    ).resolves.toMatchObject({ ownerId: second.owner.id });

    // Fixture records have known provenance. A real operator must verify it.
    await source.getRepository(User).update(duplicate.id, { roles: ['user'] });
    await source
      .getRepository(Customer)
      .update(first.customer.id, { ownerId: first.owner.id });
    await source.query(
      'UPDATE notifications SET "businessId" = $1 WHERE id = $2',
      [first.business.id, notificationId],
    );
    await expect(inspectTenantIntegrity(source)).resolves.toEqual([]);
    await applyMigrations(source);
    expect(await source.getRepository(BusinessMember).count()).toBe(3);

    await source.undoLastMigration();
    await expect(
      source.query("SELECT to_regclass('business_members') AS relation"),
    ).resolves.toEqual([{ relation: null }]);
    await expect(
      source.getRepository(Customer).findOneBy({ id: first.customer.id }),
    ).resolves.toMatchObject({ ownerId: first.owner.id });
    await expect(
      source.query('SELECT id FROM notifications WHERE id = $1', [
        notificationId,
      ]),
    ).resolves.toEqual([{ id: notificationId }]);
    await applyMigrations(source);
    expect(await source.getRepository(BusinessMember).count()).toBe(3);
  });

  it('enforces CRM tenant links, preserves nullable deletion behavior, and accepts legacy registration and capture', async () => {
    await upgrade();
    await database.grantRuntimeAccess(source);
    const runtime = await database.runtime();
    const users = new UserRepository(runtime.getRepository(User));
    const owner = await users.create({
      businessId: first.business.id,
      firstName: 'New staff',
      email: 'new@example.test',
      password: 'fixture',
      roles: ['user'],
    });
    await expect(
      runtime
        .getRepository(BusinessMember)
        .findOneBy({ legacyUserId: owner.id }),
    ).resolves.toMatchObject({
      accountId: null,
      businessId: first.business.id,
      role: 'staff',
    });
    const repo = repositories(runtime);
    await expect(
      repo.followUps.create({
        businessId: first.business.id,
        customerId: second.customer.id,
        ownerId: first.owner.id,
        dueDate: new Date(),
        title: 'Invalid tenant fixture',
      }),
    ).rejects.toMatchObject({
      driverError: {
        code: '23503',
        constraint: 'FK_follow_ups_customerId_tenant',
      },
    });
    await expect(
      repo.sales.create({
        businessId: first.business.id,
        ownerId: second.owner.id,
      }),
    ).rejects.toMatchObject({
      driverError: { code: '23503', constraint: 'FK_sales_ownerId_tenant' },
    });
    await expect(
      runtime.getRepository(OnboardingSession).save({
        businessId: first.business.id,
        ownerId: second.owner.id,
        whatsappId: 'onboarding-fixture',
      }),
    ).rejects.toMatchObject({
      driverError: {
        code: '23503',
        constraint: 'FK_onboarding_sessions_ownerId_tenant',
      },
    });

    await runtime
      .getRepository(Customer)
      .update(first.customer.id, { ownerId: owner.id });
    await users.delete(owner.id);
    await expect(
      runtime.getRepository(Customer).findOneBy({ id: first.customer.id }),
    ).resolves.toMatchObject({
      businessId: first.business.id,
      ownerId: null,
    });

    await runtime
      .getRepository(Business)
      .update(first.business.id, { phoneNumberId: 'tenant-capture-fixture' });
    const capture = new WebhookLeadCaptureService(
      new BusinessRepository(runtime.getRepository(Business)),
      users,
      repo.customers,
      repo.conversations,
      repo.messages,
    );
    await expect(
      capture.capture({
        from: first.owner.whatsappId!,
        message: 'Show pipeline',
        type: 'text',
        providerMessageId: 'owner-command-fixture',
        phoneNumberId: 'tenant-capture-fixture',
      }),
    ).resolves.toMatchObject({
      kind: 'owner_command',
      ownerId: first.owner.id,
    });
    await expect(
      capture.capture({
        from: second.owner.whatsappId!,
        message: 'Hello',
        type: 'text',
        providerMessageId: 'customer-fixture',
        phoneNumberId: 'tenant-capture-fixture',
      }),
    ).resolves.toMatchObject({ kind: 'customer_message', isNewLead: true });
    await expect(
      repo.customers.findByWhatsappIdAndBusiness(
        second.owner.whatsappId!,
        first.business.id,
      ),
    ).resolves.toMatchObject({ ownerId: null, businessId: first.business.id });
  });
});
