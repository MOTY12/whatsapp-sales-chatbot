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

  function change(asset: string, id: string, sender = '2348011112222') {
    return {
      field: 'messages',
      value: {
        businessId: other,
        metadata: { phone_number_id: asset },
        messages: [{ id, from: sender, type: 'text', text: { body: 'hello' } }],
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
        processed_at: Date | null;
        processing_outcome: string | null;
      }[]
    >(
      "SELECT id, business_id, event_type, handed_off_at, processed_at, processing_outcome FROM public.webhook_receipts WHERE payload->>'messageId' = $1",
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

  it('processes durable receipts once and resumes work after Redis recovery', async () => {
    const raw = body(change('111', 'handoff'));
    await post(raw, sign(raw)).expect(200);
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
      while (Date.now() < deadline) {
        const statuses = await Promise.all(
          rows.map(({ id }) => recovered.status(tenant, id)),
        );
        if (statuses.every((status) => status?.status === 'COMPLETED')) break;
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
      const processed = await receipts('handoff');
      expect(processed.every((row) => row.processed_at instanceof Date)).toBe(
        true,
      );
      expect(
        processed.find((row) => row.event_type === 'message')
          ?.processing_outcome,
      ).toBe('customer_inquiry');
      expect(
        await admin.query(
          `SELECT m.id, m."businessId", m."whatsappMessageId", m.metadata,
                c."businessId" AS customer_business, v."businessId" AS conversation_business
           FROM public.messages m
           JOIN public.conversations v ON v.id = m."conversationId"
           JOIN public.customers c ON c.id = v."customerId"
          WHERE m."whatsappMessageId" = 'handoff'`,
        ),
      ).toMatchObject([
        {
          businessId: tenant,
          whatsappMessageId: 'handoff',
          customer_business: tenant,
          conversation_business: tenant,
        },
      ]);
      expect(
        await admin.query(
          `SELECT id FROM public.customers WHERE "businessId" = $1 AND "whatsappId" = $2`,
          [tenant, '2348011112222'],
        ),
      ).toHaveLength(1);
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });

  it('recognizes only a verified tenant owner and defers the response durably', async () => {
    const accountId = randomUUID();
    const verifiedOwner = '2348200000099';
    await admin.query(
      `INSERT INTO public.accounts (id, issuer, subject) VALUES ($1, 'integration', $2)`,
      [accountId, randomUUID()],
    );
    await admin.query(
      `INSERT INTO public.business_members
         ("businessId", "accountId", role, status, "verifiedWhatsappId")
       VALUES ($1, $2, 'owner', 'active', $3)`,
      [tenant, accountId, verifiedOwner],
    );

    const raw = body(change('111', 'verified-owner-command', verifiedOwner));
    await post(raw, sign(raw)).expect(200);
    const messageReceipt = (await receipts('verified-owner-command')).find(
      ({ event_type }) => event_type === 'message',
    );
    if (!messageReceipt) throw new Error('Expected a durable owner receipt.');

    await admin.query(
      `UPDATE public.outbox_operations SET status = 'DISPATCHED', "dueAt" = now() WHERE id = $1`,
      [messageReceipt.id],
    );
    const store = new OutboxStore(runtime);
    const job = await store.begin(messageReceipt.id, 0);
    if (!job) throw new Error('Expected a claimable owner receipt.');
    await store.complete(job, handoffWhatsAppReceipt);

    const [message] = await admin.query<
      { metadata: Record<string, unknown> }[]
    >(`SELECT metadata FROM public.messages WHERE "whatsappMessageId" = $1`, [
      'verified-owner-command',
    ]);
    expect(message.metadata.classification).toBe('owner_command');
    expect(
      await admin.query(
        `SELECT response_kind, status FROM public.whatsapp_response_intents WHERE receipt_id = $1`,
        [messageReceipt.id],
      ),
    ).toEqual([{ response_kind: 'owner_command', status: 'PENDING' }]);
  });

  it('reuses an existing tenant customer and conversation', async () => {
    const sender = '2348300000000';
    const before = await admin.query<{ id: string }[]>(
      `SELECT id FROM public.customers WHERE "businessId" = $1 AND phone = $2`,
      [tenant, sender],
    );
    expect(before).toHaveLength(1);
    const raw = body(change('111', 'existing-customer-message', sender));
    await post(raw, sign(raw)).expect(200);
    const receipt = (await receipts('existing-customer-message')).find(
      ({ event_type }) => event_type === 'message',
    );
    if (!receipt) throw new Error('Expected a customer message receipt.');
    await processReceipt(receipt.id);
    const [stored] = await admin.query<{ customerId: string; id: string }[]>(
      `SELECT c.id, v."customerId" FROM public.messages m
         JOIN public.conversations v ON v.id = m."conversationId"
         JOIN public.customers c ON c.id = v."customerId"
        WHERE m."whatsappMessageId" = $1 AND c."businessId" = $2`,
      ['existing-customer-message', tenant],
    );
    expect(stored.id).toBe(before[0].id);
    expect(
      await admin.query(
        `SELECT id FROM public.customers WHERE "businessId" = $1 AND phone = $2`,
        [tenant, sender],
      ),
    ).toHaveLength(1);
  });

  it('keeps legacy onboarding separate and stores a pending response intent', async () => {
    const sender = '2348999999911';
    await admin.query(
      `INSERT INTO public.onboarding_sessions ("whatsappId", step) VALUES ($1, 'ASK_REGISTER')`,
      [sender],
    );
    const raw = body(change('111', 'legacy-onboarding-message', sender));
    await post(raw, sign(raw)).expect(200);
    const receipt = (await receipts('legacy-onboarding-message')).find(
      ({ event_type }) => event_type === 'message',
    );
    if (!receipt) throw new Error('Expected a legacy onboarding receipt.');
    await processReceipt(receipt.id);
    const [stored] = await admin.query<{ metadata: Record<string, unknown> }[]>(
      `SELECT metadata FROM public.messages WHERE "whatsappMessageId" = $1`,
      ['legacy-onboarding-message'],
    );
    expect(stored.metadata.classification).toBe('legacy_onboarding');
    expect(
      await admin.query(
        `SELECT response_kind, status FROM public.whatsapp_response_intents WHERE receipt_id = $1`,
        [receipt.id],
      ),
    ).toEqual([{ response_kind: 'legacy_onboarding', status: 'PENDING' }]);
  });

  it('reconciles only matching outbound messages and retains unmatched statuses', async () => {
    const [conversation] = await admin.query<{ id: string }[]>(
      `SELECT id FROM public.conversations WHERE "businessId" = $1 LIMIT 1`,
      [tenant],
    );
    const outboundId = randomUUID();
    await admin.query(
      `INSERT INTO public.messages
         (id, "businessId", "conversationId", direction, content, status, "whatsappMessageId")
       VALUES ($1, $2, $3, 'outbound', 'hello', 'sent', 'outbound-status-fixture')`,
      [outboundId, tenant, conversation.id],
    );
    const delivery = (messageId: string, status: string) =>
      JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'account',
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: '111' },
                  statuses: [{ id: messageId, status }],
                },
              },
            ],
          },
        ],
      });
    const acceptStatus = async (messageId: string, status: string) => {
      const raw = delivery(messageId, status);
      await post(raw, sign(raw)).expect(200);
      const [receipt] = await admin.query<{ id: string }[]>(
        `SELECT id FROM public.webhook_receipts
          WHERE payload->>'messageId' = $1 AND payload->>'status' = $2
            AND processed_at IS NULL ORDER BY received_at DESC LIMIT 1`,
        [messageId, status],
      );
      if (!receipt) throw new Error('Expected a delivery status receipt.');
      await processReceipt(receipt.id);
      return receipts(messageId);
    };

    await acceptStatus('outbound-status-fixture', 'delivered');
    await acceptStatus('outbound-status-fixture', 'read');
    const [outbound] = await admin.query<{ status: string }[]>(
      `SELECT status FROM public.messages WHERE id = $1 AND "businessId" = $2`,
      [outboundId, tenant],
    );
    expect(outbound.status).toBe('read');
    const unmatched = await acceptStatus(
      'unknown-outbound-fixture',
      'delivered',
    );
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].processing_outcome).toBe('unmatched_delivery');
    expect(
      await admin.query(
        `SELECT id FROM public.messages WHERE "whatsappMessageId" = 'unknown-outbound-fixture'`,
      ),
    ).toHaveLength(0);
  });

  it('rolls back partial writes on failure and exposes terminal retry state', async () => {
    const raw = body(change('111', 'terminal-failure', '2348999999922'));
    await post(raw, sign(raw)).expect(200);
    const receipt = (await receipts('terminal-failure')).find(
      ({ event_type }) => event_type === 'message',
    );
    if (!receipt) throw new Error('Expected a failing receipt.');
    await admin.query(`ALTER TABLE public.messages ADD CONSTRAINT test_fail_inbound
      CHECK ("whatsappMessageId" <> 'terminal-failure') NOT VALID`);
    try {
      const processor = new OutboxProcessor(
        new OutboxStore(runtime),
        new Map([[whatsappReceiptOperation, handoffWhatsAppReceipt]]),
      );
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await admin.query(
          `UPDATE public.outbox_operations SET status = 'DISPATCHED', "dueAt" = now() WHERE id = $1`,
          [receipt.id],
        );
        await processor.process({ id: receipt.id }, `${receipt.id}-${attempt}`);
      }
      expect(
        await new OutboxStore(runtime).status(tenant, receipt.id),
      ).toMatchObject({
        status: 'FAILED',
        attempts: 5,
        lastError: 'HANDLER_FAILED',
      });
      expect(
        await admin.query(
          `SELECT id FROM public.customers WHERE "businessId" = $1 AND phone = '2348999999922'`,
          [tenant],
        ),
      ).toHaveLength(0);
      expect(
        (await receipts('terminal-failure')).find(
          ({ id }) => id === receipt.id,
        ),
      ).toMatchObject({ processed_at: null });
    } finally {
      await admin.query(
        'ALTER TABLE public.messages DROP CONSTRAINT test_fail_inbound',
      );
    }
  });

  async function processReceipt(id: string) {
    await admin.query(
      `UPDATE public.outbox_operations SET status = 'DISPATCHED', "dueAt" = now() WHERE id = $1`,
      [id],
    );
    const store = new OutboxStore(runtime);
    const job = await store.begin(id, 0);
    if (!job) throw new Error('Expected a claimable receipt.');
    await store.complete(job, handoffWhatsAppReceipt);
  }
});
