import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { workerConfig } from '../../src/config/env';
import { createQueue, createWorker } from '../../src/jobs/queue';
import { OutboxRelay } from '../../src/jobs/outbox.relay';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { WhatsAppChannelAdapter } from '../../src/channels/adapters/whatsapp/whatsapp.adapter';
import { ChannelConnectionService } from '../../src/channels/channel-connection.service';
import { ChannelConnection } from '../../src/database/entities/channel-connection.entity';
import { OutboxProcessor } from '../../src/jobs/outbox.processor';
import { OutboxStore } from '../../src/jobs/outbox.store';
import { WhatsAppWebhookController } from '../../src/whatsapp/whatsapp-webhook.controller';
import { WhatsAppWebhookIntake } from '../../src/whatsapp/webhook-intake.service';
import {
  handoffWhatsAppReceipt,
  whatsappReceiptOperation,
} from '../../src/whatsapp/webhook-receipt.handler';
import { seedTenant } from './fixtures';
import { applyMigrations, createIntegrationDatabase } from './postgres';

describe('durable signed WhatsApp intake', () => {
  const secret = 'webhook-fixture-only';
  const path = '/webhooks/whatsapp';
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let app: NestExpressApplication;
  let admin: DataSource;
  let runtime: DataSource;
  let tenant: string;
  let other: string;

  async function start(appSecret: string) {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      META_APP_SECRET: appSecret,
      WHATSAPP_VERIFY_TOKEN: 'challenge-fixture',
    });
    const module = await Test.createTestingModule({
      controllers: [WhatsAppWebhookController],
      providers: [
        { provide: DataSource, useValue: runtime },
        WhatsAppWebhookIntake,
        ChannelConnectionService,
        WhatsAppChannelAdapter,
        OutboxStore,
      ],
    }).compile();
    const application = module.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    application.useBodyParser('raw', {
      limit: '256kb',
      inflate: false,
      type: (request) =>
        request.method === 'POST' &&
        /^\/webhooks\/whatsapp\/?(?:\?|$)/i.test(request.url ?? ''),
    });
    await application.init();
    return application;
  }

  beforeAll(async () => {
    database = await createIntegrationDatabase();
    admin = await database.migrator();
    await applyMigrations(admin);
    tenant = (await seedTenant(admin, 1)).business.id;
    other = (await seedTenant(admin, 2)).business.id;
    const rows = admin.getRepository(ChannelConnection);
    const base = {
      provider: 'whatsapp',
      externalAccountId: 'account',
      status: 'active' as const,
      verifiedAt: new Date(),
    };
    await rows.save({ ...base, businessId: tenant, externalAssetId: '111' });
    await rows.insert([
      { ...base, businessId: other, externalAssetId: '222' },
      {
        ...base,
        businessId: other,
        externalAssetId: '333',
        status: 'inactive',
      },
    ]);
    await database.grantRuntimeAccess(admin);
    runtime = await database.runtime();
    app = await start(secret);
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await database?.close();
      jest.restoreAllMocks();
    }
  });

  function change(asset: string, id: string) {
    return {
      field: 'messages',
      value: {
        businessId: other,
        metadata: { phone_number_id: asset },
        messages: [
          { id, from: '2348011112222', type: 'text', text: { body: 'hello' } },
        ],
        statuses: [
          { id, status: 'delivered' },
          { id, status: 'delivered' },
          { id, status: 'read' },
        ],
      },
    };
  }
  function body(...changes: ReturnType<typeof change>[]) {
    return JSON.stringify(
      {
        object: 'whatsapp_business_account',
        entry: changes.map((item) => ({ id: 'account', changes: [item] })),
      },
      null,
      2,
    );
  }
  function sign(raw: string) {
    return 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  }
  function post(raw: string, signature?: string, application = app) {
    const call = request(application.getHttpServer()).post(path).type('json');
    if (signature) call.set('X-Hub-Signature-256', signature);
    return call.send(raw);
  }
  function receipts(id: string) {
    return admin.query<
      {
        id: string;
        business_id: string;
        event_type: string;
        handed_off_at: Date | null;
      }[]
    >(
      "SELECT id, business_id, event_type, handed_off_at FROM public.webhook_receipts WHERE payload->>'messageId' = $1",
      [id],
    );
  }

  it('keeps GET verification and rejects absent, malformed, tampered or oversized requests', async () => {
    await request(app.getHttpServer())
      .get(path)
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'challenge-fixture',
        'hub.challenge': '42',
      })
      .expect(200, '42');
    const raw = body(change('111', 'signature'));
    await post(raw).expect(403);
    await post(raw, sign(raw) + 'ff').expect(403);
    await post(raw, sign('wrong')).expect(403);
    await post(raw + ' ', sign(raw)).expect(403);
    await post('{', sign(raw)).expect(403);
    await post('{', sign('{')).expect(400);
    const large = raw + ' '.repeat(256 * 1024);
    await post(large, sign(large)).expect(413);
    const unconfigured = await start('');
    try {
      await post(raw, sign(raw), unconfigured).expect(403);
    } finally {
      await unconfigured.close();
    }
    expect(await receipts('signature')).toEqual([]);
  });

  it('atomically deduplicates concurrent batches and routes each asset independently', async () => {
    const raw = body(
      change('111', 'batch'),
      change('222', 'batch'),
      change('333', 'inactive'),
      change('444', 'unknown'),
    );
    await Promise.all(
      Array.from({ length: 4 }, () => post(raw, sign(raw)).expect(200)),
    );
    const rows = await receipts('batch');
    expect(rows).toHaveLength(6);
    expect(rows.filter((row) => row.business_id === tenant)).toHaveLength(3);
    expect(rows.filter((row) => row.business_id === other)).toHaveLength(3);
    expect(await receipts('inactive')).toEqual([]);
    expect(await receipts('unknown')).toEqual([]);
    const mismatch = body(change('111', 'wrong-waba')).replace(
      '"id": "account"',
      '"id": "another-account"',
    );
    await post(mismatch, sign(mismatch)).expect(200);
    expect(await receipts('wrong-waba')).toEqual([]);
    expect(
      await admin.query(
        'SELECT metadata FROM public.outbox_operations WHERE id = ANY($1) AND operation = $2',
        [rows.map((row) => row.id), whatsappReceiptOperation],
      ),
    ).toHaveLength(6);
  });

  it('returns 503 when an intent fails and rolls back its receipt', async () => {
    const raw = body(change('111', 'rollback'));
    await admin.query(`ALTER TABLE public.outbox_operations ADD CONSTRAINT test_block_receipt
      CHECK (operation <> 'whatsapp.receipt') NOT VALID`);
    try {
      await post(raw, sign(raw)).expect(503);
      expect(await receipts('rollback')).toEqual([]);
    } finally {
      await admin.query(
        'ALTER TABLE public.outbox_operations DROP CONSTRAINT test_block_receipt',
      );
    }
    await post(raw, sign(raw)).expect(200);
    expect(await receipts('rollback')).toHaveLength(3);
  });

  it('hands off durable intents on replay without running downstream effects', async () => {
    const raw = body(change('111', 'handoff'));
    await post(raw, sign(raw)).expect(200);
    const rows = await receipts('handoff');
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.handed_off_at === null)).toBe(true);
    const store = new OutboxStore(runtime);
    const redisUrl = new URL(process.env.KLEVA_TEST_REDIS_URL ?? '');
    if (
      redisUrl.protocol !== 'redis:' ||
      redisUrl.hostname !== '127.0.0.1' ||
      !redisUrl.port
    ) {
      throw new Error('Expected disposable loopback Redis.');
    }
    const config = workerConfig({
      NODE_ENV: 'test',
      REDIS_URL: redisUrl.href,
      JOBS_QUEUE_PREFIX: 'kleva-test-' + randomUUID(),
    });
    const unavailable = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      unavailable.once('error', reject);
      unavailable.listen(0, '127.0.0.1', resolve);
    });
    const address = unavailable.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected fixture address.');
    const brokenQueue = createQueue({
      ...config,
      redis: {
        ...config.redis,
        url: 'redis://127.0.0.1:' + String(address.port),
      },
    });
    brokenQueue.on('error', () => undefined);
    try {
      await new OutboxRelay(store, brokenQueue).dispatch();
      expect(await store.status(tenant, rows[0].id)).toMatchObject({
        status: 'RETRY_PENDING',
        lastError: 'REDIS_UNAVAILABLE',
      });
    } finally {
      await brokenQueue.close();
      await new Promise<void>((resolve) => unavailable.close(() => resolve()));
    }
    await admin.query(
      'UPDATE public.outbox_operations SET "dueAt" = now() WHERE id = ANY($1)',
      [rows.map(({ id }) => id)],
    );
    const recovered = new OutboxStore(runtime);
    const processor = new OutboxProcessor(
      recovered,
      new Map([[whatsappReceiptOperation, handoffWhatsAppReceipt]]),
    );
    const queue = createQueue(config);
    const worker = createWorker(config, (data, id) =>
      processor.process(data, id),
    );
    worker.on('error', () => undefined);
    try {
      void worker.run().catch(() => undefined);
      await worker.waitUntilReady();
      await new OutboxRelay(recovered, queue).dispatch();
      const deadline = Date.now() + 5000;
      while (
        (await recovered.status(tenant, rows[0].id))?.status !== 'COMPLETED' &&
        Date.now() < deadline
      ) {
        await delay(20);
      }
      await processor.process({ id: rows[0].id }, rows[0].id + '-0');
      expect(await recovered.status(tenant, rows[0].id)).toMatchObject({
        status: 'COMPLETED',
        attempts: 1,
      });
      expect(
        (await receipts('handoff')).find(({ id }) => id === rows[0].id)
          ?.handed_off_at,
      ).toBeInstanceOf(Date);
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });
});
