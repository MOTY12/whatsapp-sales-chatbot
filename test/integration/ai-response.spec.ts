import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AiResponseService } from '../../src/assistant/ai-response.service';
import { FakeGroundedModel } from '../../src/assistant/grounded-model.provider';
import { UnifiedKnowledgeRetrievalService } from '../../src/knowledge/unified-knowledge-retrieval.service';
import { UsageService } from '../../src/metering/usage.service';
import { ChannelConnection } from '../../src/database/entities/channel-connection.entity';
import type { OutboxOperation } from '../../src/database/entities/outbox-operation.entity';
import { seedTenant } from './fixtures';
import { applyMigrations, createIntegrationDatabase } from './postgres';

describe('grounded WhatsApp AI response processing', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let admin: DataSource;
  let runtime: DataSource;
  let originalEnabled: string | undefined;
  let originalKey: string | undefined;

  beforeAll(async () => {
    originalEnabled = process.env.AI_RESPONSES_ENABLED;
    originalKey = process.env.OPENAI_API_KEY;
    process.env.AI_RESPONSES_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'integration-fixture-key';
    database = await createIntegrationDatabase();
    admin = await database.migrator();
    await applyMigrations(admin);
    await database.grantRuntimeAccess(admin);
    runtime = await database.runtime();
  });

  afterAll(async () => {
    await runtime?.destroy();
    await database?.close();
    if (originalEnabled === undefined) delete process.env.AI_RESPONSES_ENABLED;
    else process.env.AI_RESPONSES_ENABLED = originalEnabled;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it('uses only a published tenant product, reconciles usage and persists one response intent', async () => {
    const tenant = await seedTenant(admin, 1);
    await admin.getRepository(ChannelConnection).save({
      businessId: tenant.business.id,
      provider: 'whatsapp',
      externalAccountId: 'fixture-account',
      externalAssetId: '1234567890',
      status: 'active',
      verifiedAt: new Date(),
    });
    await admin.query(
      `UPDATE public.businesses SET status = 'active' WHERE id = $1`,
      [tenant.business.id],
    );

    const productId = randomUUID();
    const revisionId = randomUUID();
    await admin.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO public.merchant_products(id,business_id,creation_key,creation_fingerprint)
         VALUES ($1,$2,$3,'integration-fixture')`,
        [productId, tenant.business.id, randomUUID()],
      );
      await manager.query(
        `INSERT INTO public.merchant_product_revisions
           (id,business_id,product_id,revision,name,description,sku,price,currency,availability)
         VALUES ($1,$2,$3,1,'Quiet standing fan','Quiet standing fan with remote control.','FAN-01',25000,'NGN','IN_STOCK')`,
        [revisionId, tenant.business.id, productId],
      );
      await manager.query(
        `UPDATE public.merchant_products SET draft_revision_id=$2,published_revision_id=$2,published_at=now()
          WHERE id=$1 AND business_id=$3`,
        [productId, revisionId, tenant.business.id],
      );
    });

    const inboundId = randomUUID();
    const runId = randomUUID();
    await admin.transaction(async (manager) => {
      const [message] = await manager.query<{ id: string }[]>(
        `INSERT INTO public.messages
          ("businessId","conversationId",direction,content,status,"whatsappMessageId",metadata)
         VALUES ($1,$2,'inbound','What is the price of the quiet standing fan?','delivered',$3,'{}') RETURNING id`,
        [tenant.business.id, tenant.conversation.id, inboundId],
      );
      await manager.query(
        `INSERT INTO public.merchant_leads(business_id,customer_id,conversation_id,source,status,first_contact_at,last_activity_at)
         VALUES ($1,$2,$3,'WHATSAPP','NEW',now(),now())`,
        [tenant.business.id, tenant.customer.id, tenant.conversation.id],
      );
      const [lead] = await manager.query<{ id: string }[]>(
        `SELECT id FROM public.merchant_leads WHERE business_id=$1 AND conversation_id=$2`,
        [tenant.business.id, tenant.conversation.id],
      );
      expect(lead).toBeTruthy();
      await manager.query(
        `INSERT INTO public.ai_response_runs(id,business_id,inbound_message_id,conversation_id,lead_id,authorized_control_version)
         VALUES ($1,$2,$3,$4,$5,1)`,
        [
          runId,
          tenant.business.id,
          message.id,
          tenant.conversation.id,
          lead.id,
        ],
      );
      await manager.query(
        `INSERT INTO public.outbox_operations(id,"businessId",operation,metadata)
         VALUES ($1,$2,'whatsapp.ai_response',$3)`,
        [runId, tenant.business.id, JSON.stringify({ aiResponseRunId: runId })],
      );
    });

    const outbound = { enqueueTextMessage: jest.fn().mockResolvedValue(null) };
    const model = new FakeGroundedModel({
      reply:
        'The quiet standing fan costs NGN 25,000 and includes remote control.',
      evidenceIds: [productId],
      canAnswer: true,
      needsHuman: false,
      inputTokens: 150,
      outputTokens: 16,
    });
    const service = new AiResponseService(
      runtime,
      new UnifiedKnowledgeRetrievalService(runtime),
      new UsageService(runtime),
      outbound as never,
      model,
    );
    const operation = {
      id: runId,
      businessId: tenant.business.id,
      operation: 'whatsapp.ai_response',
      metadata: { aiResponseRunId: runId },
    } as OutboxOperation;
    await service.execute(operation);
    await service.execute(operation);

    const [run] = await admin.query<
      {
        status: string;
        evidence: Array<{ sourceId: string; revisionId: string }>;
        outbound_message_id: string | null;
      }[]
    >(
      `SELECT status,evidence,outbound_message_id FROM public.ai_response_runs WHERE id=$1 AND business_id=$2`,
      [runId, tenant.business.id],
    );
    expect(run.status).toBe('QUEUED');
    expect(run.evidence).toEqual([
      { sourceId: productId, revisionId, sourceType: 'PRODUCT' },
    ]);
    expect(outbound.enqueueTextMessage).toHaveBeenCalledTimes(1);
    expect(outbound.enqueueTextMessage).toHaveBeenCalledWith(
      tenant.business.id,
      {
        to: tenant.customer.whatsappId,
        message:
          'The quiet standing fan costs NGN 25,000 and includes remote control.',
      },
      runId,
      undefined,
      {
        conversationId: tenant.conversation.id,
        kind: 'AI',
        controlVersion: '1',
      },
    );
    await expect(
      new UsageService(runtime).getUsageSummary(tenant.business.id),
    ).resolves.toMatchObject({
      categories: {
        ai_input_tokens: { consumed: 150 },
        ai_output_tokens: { consumed: 16 },
      },
    });
    expect(inboundId).toBeTruthy();
  });
});
