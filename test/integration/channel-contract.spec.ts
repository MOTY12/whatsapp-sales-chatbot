import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ChannelConnectionService } from '../../src/channels/channel-connection.service';
import { WhatsAppChannelAdapter } from '../../src/channels/adapters/whatsapp/whatsapp.adapter';
import { Business } from '../../src/database/entities/business.entity';
import { ChannelConnection } from '../../src/database/entities/channel-connection.entity';
import { AddChannelConnections1760000000006 } from '../../src/database/migrations/1760000000006-AddChannelConnections';
import { databaseMigrations } from '../../src/database/schema';
import { seedTenant } from './fixtures';
import { applyMigrations, createIntegrationDatabase } from './postgres';

describe('channel connection contract', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let source: DataSource;
  let runtime: DataSource;
  let first: Awaited<ReturnType<typeof seedTenant>>;
  let second: Awaited<ReturnType<typeof seedTenant>>;

  const connected = {
    phoneNumberId: 'phone-asset',
    wabaId: 'whatsapp-account',
    accessToken: 'legacy-private-token',
    displayPhoneNumber: '+2348012345678',
    connectedAt: new Date('2026-11-01T12:00:00Z'),
  };
  const active = {
    provider: 'whatsapp',
    externalAccountId: connected.wabaId,
    status: 'active' as const,
    verifiedAt: connected.connectedAt,
  };

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
    source = await database.migrator();
    await applyMigrations(source);
    await database.grantRuntimeAccess(source);
    runtime = await database.runtime();
  }

  function resolve(externalAssetId: string) {
    return new ChannelConnectionService(runtime).resolve({
      provider: 'whatsapp',
      externalAssetId,
    });
  }

  it('backfills a complete legacy connection, preserves linked records and repeats safely', async () => {
    await source.getRepository(Business).update(first.business.id, connected);
    await upgrade();
    const connections = source.getRepository(ChannelConnection);
    const entry = await connections.findOneByOrFail({
      businessId: first.business.id,
    });

    await expect(resolve(connected.phoneNumberId)).resolves.toEqual({
      provider: 'whatsapp',
      externalAssetId: connected.phoneNumberId,
      externalAccountId: connected.wabaId,
      connectionId: entry.id,
      businessId: first.business.id,
      source: 'connection',
    });
    await expect(resolve(connected.displayPhoneNumber)).resolves.toBeNull();
    await expect(resolve('unknown')).resolves.toBeNull();
    await expect(resolve(first.customer.whatsappId)).resolves.toBeNull();
    await expect(
      source.getRepository(Business).findOneByOrFail({ id: first.business.id }),
    ).resolves.toMatchObject(connected);

    await expect(
      runtime.query(
        'SELECT "businessId" FROM public.conversations WHERE id = $1',
        [first.conversation.id],
      ),
    ).resolves.toEqual([{ businessId: first.business.id }]);
    await expect(
      runtime.query('SELECT "businessId" FROM public.users WHERE id = $1', [
        first.owner.id,
      ]),
    ).resolves.toEqual([{ businessId: first.business.id }]);

    const runner = source.createQueryRunner();
    try {
      const migration = new AddChannelConnections1760000000006();
      await migration.backfill(runner);
      await expect(connections.find()).resolves.toEqual([entry]);
      await expect(applyMigrations(source)).resolves.toEqual([]);
    } finally {
      await runner.release();
    }

    await source
      .getRepository(Business)
      .update(first.business.id, { phoneNumberId: 'rotated-phone' });
    await expect(resolve(connected.phoneNumberId)).resolves.toBeNull();
    await expect(resolve('rotated-phone')).resolves.toMatchObject({
      businessId: first.business.id,
      connectionId: null,
      source: 'legacy',
    });
  });

  it('blocks ambiguous or incomplete legacy mappings and disagreement with an explicit route', async () => {
    const businesses = source.getRepository(Business);
    await businesses.update(first.business.id, connected);
    await businesses.update(second.business.id, {
      ...connected,
      phoneNumberId: ' phone-asset ',
    });
    await upgrade();
    const connections = source.getRepository(ChannelConnection);
    const current = source.getRepository(Business);
    await expect(connections.count()).resolves.toBe(0);
    await expect(resolve('phone-asset')).resolves.toBeNull();
    await expect(
      connections.insert({
        ...active,
        businessId: first.business.id,
        externalAssetId: 'phone-asset',
      }),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });

    await current.update(second.business.id, {
      phoneNumberId: 'incomplete',
      connectedAt: null,
    });
    await expect(resolve('incomplete')).resolves.toBeNull();
    await expect(resolve('phone-asset')).resolves.toMatchObject({
      source: 'legacy',
    });
    await connections.insert({
      ...active,
      businessId: first.business.id,
      externalAssetId: 'phone-asset',
    });
    await current.update(second.business.id, {
      phoneNumberId: ' phone-asset ',
    });
    await expect(resolve('phone-asset')).resolves.toBeNull();
  });

  it('denies fallback for explicit pending and inactive routes and suspended businesses', async () => {
    await upgrade();
    const businesses = source.getRepository(Business);
    const connections = source.getRepository(ChannelConnection);
    await businesses.update(first.business.id, connected);
    const connection = await connections.save({
      provider: 'whatsapp',
      businessId: first.business.id,
      externalAssetId: 'phone-asset',
    });
    await expect(resolve('phone-asset')).resolves.toBeNull();
    await expect(
      connections.update(connection.id, { status: 'active' }),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    await connections.update(connection.id, active);
    await expect(resolve('phone-asset')).resolves.toMatchObject({
      connectionId: connection.id,
    });
    await businesses.update(first.business.id, { status: 'suspended' });
    await expect(resolve('phone-asset')).resolves.toBeNull();
    await businesses.update(first.business.id, { status: 'active' });
    await connections.update(connection.id, { status: 'inactive' });
    await expect(resolve('phone-asset')).resolves.toBeNull();
    await expect(
      connections.update(connection.id, { businessId: second.business.id }),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });

    const credentials = await database.merchantCredentials(source);
    const merchant = new DataSource({
      ...runtime.options,
      username: credentials.username,
      password: credentials.password,
    } as typeof runtime.options);
    await merchant.initialize();
    try {
      await expect(
        merchant.query('SELECT * FROM public.channel_connections'),
      ).rejects.toMatchObject({ driverError: { code: '42501' } });
    } finally {
      await merchant.destroy();
    }
  });

  it('enforces exclusive asset ownership across concurrent inserts', async () => {
    await upgrade();
    const connections = runtime.getRepository(ChannelConnection);
    const externalAssetId = randomUUID();
    const results = await Promise.allSettled(
      [first, second].map(({ business }) =>
        connections.insert({
          ...active,
          businessId: business.id,
          externalAssetId,
        }),
      ),
    );
    const failures = results.filter((result) => result.status === 'rejected');
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toMatchObject({
      driverError: { code: '23505' },
    });
    const [row] = await connections.findBy({ externalAssetId });
    expect(await resolve(externalAssetId)).toMatchObject({
      businessId: row.businessId,
    });
    await expect(
      connections.insert({
        ...active,
        businessId: randomUUID(),
        externalAssetId: 'orphan',
      }),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
  });

  it('normalizes verified Meta text and delivery events using only receiving metadata for routing', async () => {
    await upgrade();
    await runtime.getRepository(ChannelConnection).insert({
      ...active,
      businessId: first.business.id,
      externalAssetId: 'phone-asset',
    });
    const events = new WhatsAppChannelAdapter().normalize({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                businessId: second.business.id,
                metadata: {
                  phone_number_id: 'phone-asset',
                  display_phone_number: 'other',
                },
                messages: [
                  {
                    type: 'text',
                    id: 'wamid.in',
                    from: 'sender',
                    text: { body: 'Hello' },
                    timestamp: '1700000000',
                    businessId: second.business.id,
                  },
                  { type: 'image', id: 'unsupported', from: 'sender' },
                ],
                statuses: [
                  {
                    id: 'wamid.out',
                    status: 'failed',
                    errors: [{ code: 131000, message: 'private' }],
                  },
                ],
              },
            },
            {
              field: 'messages',
              value: {
                messages: [
                  {
                    type: 'text',
                    id: 'no-asset',
                    from: 'sender',
                    text: { body: 'Hello' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(events).toEqual([
      {
        provider: 'whatsapp',
        externalAssetId: 'phone-asset',
        externalMessageId: 'wamid.in',
        kind: 'message',
        externalSenderId: 'sender',
        text: 'Hello',
        occurredAt: new Date(1700000000000),
      },
      {
        provider: 'whatsapp',
        externalAssetId: 'phone-asset',
        externalMessageId: 'wamid.out',
        kind: 'delivery',
        status: 'failed',
        error: { code: '131000' },
        occurredAt: undefined,
      },
    ]);
    await expect(
      new ChannelConnectionService(runtime).resolve(events[0]),
    ).resolves.toMatchObject({ businessId: first.business.id });
  });
});
