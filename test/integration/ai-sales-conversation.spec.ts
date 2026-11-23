import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ChannelConnection } from '../../src/database/entities/channel-connection.entity';
import {
  AiResponseService,
  whatsappAiResponseOperation,
} from '../../src/assistant/ai-response.service';
import { FakeGroundedModel } from '../../src/assistant/grounded-model.provider';
import { UnifiedKnowledgeRetrievalService } from '../../src/knowledge/unified-knowledge-retrieval.service';
import { UsageService } from '../../src/metering/usage.service';
import { WhatsAppChannelAdapter } from '../../src/channels/adapters/whatsapp/whatsapp.adapter';
import { ChannelConnectionService } from '../../src/channels/channel-connection.service';
import { OutboxProcessor } from '../../src/jobs/outbox.processor';
import { OutboxStore, type OutboxHandler } from '../../src/jobs/outbox.store';
import {
  whatsappOutboundOperation,
  OutboundMessageService,
} from '../../src/whatsapp/outbound-message.service';
import {
  handoffWhatsAppReceipt,
  whatsappReceiptOperation,
} from '../../src/whatsapp/webhook-receipt.handler';
import { WhatsAppWebhookController } from '../../src/whatsapp/whatsapp-webhook.controller';
import { WhatsAppWebhookIntake } from '../../src/whatsapp/webhook-intake.service';
import { seedTenant } from './fixtures';
import { applyMigrations, createIntegrationDatabase } from './postgres';

describe('first complete grounded WhatsApp sales conversation', () => {
  const appSecret = 'sales-conversation-webhook-fixture';
  const phoneNumberId = '15550000001';
  const wabaId = '15559999999';
  const sender = '2348012345678';
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let admin: DataSource;
  let runtime: DataSource;
  let app: NestExpressApplication;
  let processor: OutboxProcessor;
  let cloud: { sendTextMessage: jest.Mock };
  let businessId: string;
  let conversationId: string;
  let productId: string;
  const originalEnv: Record<string, string | undefined> = {};

  async function startWebhook() {
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
    app = module.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    app.useBodyParser('raw', {
      limit: '256kb',
      inflate: false,
      type: (request) =>
        request.method === 'POST' &&
        /^\/webhooks\/whatsapp\/?(?:\?|$)/i.test(request.url ?? ''),
    });
    await app.init();
  }

  function sign(raw: string) {
    return `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}`;
  }

  function messageEvent(id: string, text: string) {
    return JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: wabaId,
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: phoneNumberId },
                messages: [
                  {
                    id,
                    from: sender,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: text },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
  }

  function deliveryEvent(id: string, status: 'sent' | 'delivered' | 'read') {
    return JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: wabaId,
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: phoneNumberId },
                statuses: [
                  {
                    id,
                    status,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                  },
                ],
              },
            },
          ],
        },
      ],
    });
  }

  async function submitWebhook(raw: string) {
    await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('X-Hub-Signature-256', sign(raw))
      .type('json')
      .send(raw)
      .expect(200);
  }

  async function processOperation(id: string) {
    await admin.query(
      `UPDATE public.outbox_operations SET status='DISPATCHED', "dueAt"=now()
        WHERE id=$1 AND status IN ('PENDING','RETRY_PENDING','DISPATCHED')`,
      [id],
    );
    await processor.process({ id }, `${id}-0`);
  }

  beforeAll(async () => {
    for (const key of [
      'META_APP_SECRET',
      'WHATSAPP_VERIFY_TOKEN',
      'AI_RESPONSES_ENABLED',
      'OPENAI_API_KEY',
    ])
      originalEnv[key] = process.env[key];
    process.env.META_APP_SECRET = appSecret;
    process.env.WHATSAPP_VERIFY_TOKEN = 'fixture-verify-token';
    process.env.AI_RESPONSES_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'integration-grounded-model-fixture';

    database = await createIntegrationDatabase();
    admin = await database.migrator();
    await applyMigrations(admin);
    await database.grantRuntimeAccess(admin);
    runtime = await database.runtime();
    const tenant = await seedTenant(admin, 1);
    businessId = tenant.business.id;
    conversationId = tenant.conversation.id;
    await admin.query(
      `UPDATE public.businesses SET status='active' WHERE id=$1`,
      [businessId],
    );

    const connectionId = randomUUID();
    await admin.getRepository(ChannelConnection).save({
      id: connectionId,
      businessId,
      provider: 'whatsapp',
      externalAccountId: wabaId,
      externalAssetId: phoneNumberId,
      status: 'active',
      verifiedAt: new Date(),
    });
    await admin.query(
      `INSERT INTO public.whatsapp_credentials(business_id,connection_id,envelope)
       VALUES ($1,$2,'{}'::jsonb)`,
      [businessId, connectionId],
    );
    const [account] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.accounts(issuer,subject) VALUES ('https://fixture.example',$1) RETURNING id`,
      [randomUUID()],
    );
    await admin.query(
      `INSERT INTO public.business_pilot_enrollments(business_id,connection_id,merchant_account_id,
        consent_version,ai_provider_disclosed_at,escalation_acknowledged_at,status,activated_at,activated_by,activation_reference)
       VALUES ($1,$2,$3,'pilot-merchant-v1',now(),now(),'ACTIVE',now(),'integration-fixture','ticket:fixture')`,
      [businessId, connectionId, account.id],
    );
    await admin.query(
      `UPDATE public.conversations SET control_mode='AUTO',control_version=1 WHERE id=$1 AND "businessId"=$2`,
      [conversationId, businessId],
    );

    productId = randomUUID();
    const revisionId = randomUUID();
    await admin.query(
      `INSERT INTO public.merchant_products(id,business_id,creation_key,creation_fingerprint)
       VALUES ($1,$2,$3,'first-pilot-product')`,
      [productId, businessId, randomUUID()],
    );
    await admin.query(
      `INSERT INTO public.merchant_product_revisions
        (id,business_id,product_id,revision,name,description,sku,price,currency,availability)
       VALUES ($1,$2,$3,1,'Product A','Product A costs NGN 15,000. High quality blender.','PA-01',15000,'NGN','IN_STOCK')`,
      [revisionId, businessId, productId],
    );
    await admin.query(
      `UPDATE public.merchant_products SET draft_revision_id=$2,published_revision_id=$2,published_at=now()
        WHERE id=$1 AND business_id=$3`,
      [productId, revisionId, businessId],
    );

    const usage = new UsageService(runtime);
    await usage.setBusinessLimits(businessId, {
      monthlyWhatsAppMessages: 20,
      monthlyAiInputTokens: 10000,
      monthlyAiOutputTokens: 10000,
      aiTokensPerRequest: 4000,
    });
    cloud = {
      sendTextMessage: jest.fn().mockResolvedValue(`wamid.${randomUUID()}`),
    };
    const outbound = new OutboundMessageService(
      runtime,
      new OutboxStore(runtime),
      usage,
      cloud,
    );
    const model = new FakeGroundedModel({
      reply: 'Product A costs ₦15,000.',
      evidenceIds: [productId],
      canAnswer: true,
      needsHuman: false,
      inputTokens: 120,
      outputTokens: 12,
    });
    const ai = new AiResponseService(
      runtime,
      new UnifiedKnowledgeRetrievalService(runtime),
      usage,
      outbound,
      model,
    );
    processor = new OutboxProcessor(
      new OutboxStore(runtime),
      new Map<string, OutboxHandler>([
        [whatsappReceiptOperation, handoffWhatsAppReceipt],
        [
          whatsappAiResponseOperation,
          { execute: (operation) => ai.execute(operation) },
        ],
        [
          whatsappOutboundOperation,
          { execute: (operation) => outbound.execute(operation) },
        ],
      ]),
    );
    await startWebhook();
  }, 30000);

  afterAll(async () => {
    await app?.close();
    await runtime?.destroy();
    await database?.close();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('processes a signed customer price inquiry once, replies from published knowledge, and reconciles delivery', async () => {
    const inboundId = `wamid.in.${randomUUID()}`;
    const raw = messageEvent(inboundId, 'How much is Product A?');
    await submitWebhook(raw);
    await submitWebhook(raw);

    const [receipt] = await admin.query<{ id: string }[]>(
      `SELECT id FROM public.webhook_receipts WHERE payload->>'messageId'=$1 AND business_id=$2 AND event_type='message'`,
      [inboundId, businessId],
    );
    expect(receipt).toBeTruthy();
    await processOperation(receipt.id);

    const [inbound] = await admin.query<
      { id: string; conversation_id: string }[]
    >(
      `SELECT m.id, m."conversationId" AS conversation_id FROM public.messages m
        WHERE m."whatsappMessageId"=$1 AND m."businessId"=$2`,
      [inboundId, businessId],
    );
    expect(inbound.conversation_id).toBeTruthy();
    const [lead] = await admin.query<{ id: string }[]>(
      `SELECT id FROM public.merchant_leads WHERE business_id=$1 AND conversation_id=$2`,
      [businessId, inbound.conversation_id],
    );
    expect(lead).toBeTruthy();
    const [run] = await admin.query<
      { id: string; status: string; lead_id: string }[]
    >(
      `SELECT id,status,lead_id FROM public.ai_response_runs WHERE business_id=$1 AND inbound_message_id=$2`,
      [businessId, inbound.id],
    );
    expect(run).toMatchObject({ status: 'PENDING', lead_id: lead.id });
    await processOperation(run.id);

    const [completedRun] = await admin.query<
      {
        status: string;
        outbound_message_id: string | null;
        evidence: Array<{ sourceId: string; revisionId: string }>;
      }[]
    >(
      `SELECT status,outbound_message_id,evidence FROM public.ai_response_runs WHERE id=$1 AND business_id=$2`,
      [run.id, businessId],
    );
    expect(completedRun).toMatchObject({
      status: 'QUEUED',
      evidence: [{ sourceId: productId }],
    });
    expect(completedRun.outbound_message_id).toBeTruthy();
    await processOperation(completedRun.outbound_message_id!);
    await processOperation(completedRun.outbound_message_id!);
    expect(cloud.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(cloud.sendTextMessage).toHaveBeenCalledWith(
      { to: sender, message: 'Product A costs ₦15,000.' },
      businessId,
    );

    const [outbound] = await admin.query<
      {
        status: string;
        provider_message_id: string;
        content: string;
        conversation_id: string;
      }[]
    >(
      `SELECT o.status,o.provider_message_id,o.content,o.conversation_id
         FROM public.whatsapp_outbound_messages o WHERE o.id=$1 AND o.business_id=$2`,
      [completedRun.outbound_message_id, businessId],
    );
    expect(outbound).toMatchObject({
      status: 'ACCEPTED',
      content: 'Product A costs ₦15,000.',
      conversation_id: inbound.conversation_id,
    });

    const statusRaw = deliveryEvent(outbound.provider_message_id, 'delivered');
    await submitWebhook(statusRaw);
    const [delivery] = await admin.query<{ id: string }[]>(
      `SELECT id FROM public.webhook_receipts WHERE payload->>'messageId'=$1 AND business_id=$2 AND event_type='delivery'`,
      [outbound.provider_message_id, businessId],
    );
    expect(delivery).toBeTruthy();
    await processOperation(delivery.id);
    const [delivered] = await admin.query<
      { status: string; message_status: string }[]
    >(
      `SELECT o.status,m.status AS message_status FROM public.whatsapp_outbound_messages o
         JOIN public.messages m ON m.id=o.message_id AND m."businessId"=o.business_id
        WHERE o.id=$1 AND o.business_id=$2`,
      [completedRun.outbound_message_id, businessId],
    );
    expect(delivered).toEqual({
      status: 'DELIVERED',
      message_status: 'delivered',
    });
    expect(
      await admin.query(
        `SELECT id FROM public.ai_response_runs WHERE business_id=$1 AND inbound_message_id=$2`,
        [businessId, inbound.id],
      ),
    ).toHaveLength(1);
    expect(
      await admin.query(
        `SELECT id FROM public.messages WHERE "businessId"=$1 AND direction='outbound' AND "conversationId"=$2`,
        [businessId, inbound.conversation_id],
      ),
    ).toHaveLength(1);
  });
});
