import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AiResponseService } from '../../src/assistant/ai-response.service';
import { FakeGroundedModel } from '../../src/assistant/grounded-model.provider';
import { UnifiedKnowledgeRetrievalService } from '../../src/knowledge/unified-knowledge-retrieval.service';
import { UsageService } from '../../src/metering/usage.service';
import { ChannelConnection } from '../../src/database/entities/channel-connection.entity';
import { OutboxOperation } from '../../src/database/entities/outbox-operation.entity';
import { OutboxStore } from '../../src/jobs/outbox.store';
import { OutboundMessageService } from '../../src/whatsapp/outbound-message.service';
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
    const connection = await admin.getRepository(ChannelConnection).save({
      businessId: tenant.business.id,
      provider: 'whatsapp',
      externalAccountId: 'fixture-account',
      externalAssetId: '1234567890',
      status: 'active',
      verifiedAt: new Date(),
    });
    await admin.query(
      `INSERT INTO public.whatsapp_credentials(business_id,connection_id,envelope)
       VALUES ($1,$2,'{}'::jsonb)`,
      [tenant.business.id, connection.id],
    );
    await admin.query(
      `UPDATE public.businesses SET status = 'active' WHERE id = $1`,
      [tenant.business.id],
    );
    const [pilotAccount] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.accounts(issuer, subject) VALUES ('https://fixture.example', $1) RETURNING id`,
      [randomUUID()],
    );
    await admin.query(
      `INSERT INTO public.business_pilot_enrollments(business_id,connection_id,merchant_account_id,
        consent_version,ai_provider_disclosed_at,escalation_acknowledged_at,status,activated_at,activated_by,activation_reference)
       VALUES ($1,$2,$3,'pilot-merchant-v1',now(),now(),'ACTIVE',now(),'integration-fixture','evidence:fixture')`,
      [tenant.business.id, connection.id, pilotAccount.id],
    );
    await admin.query(
      `INSERT INTO public.assistant_configurations
        (business_id,version,assistant_name,greeting,tone,language,response_length,
         handoff_behavior,fallback_response,updated_by)
       VALUES ($1,1,'Kleva Assistant','Hello!','FRIENDLY','ENGLISH','BALANCED',
         'OFFER_HUMAN','I can connect you with the team.', $2)`,
      [tenant.business.id, pilotAccount.id],
    );
    const usage = new UsageService(runtime);
    await usage.setBusinessLimits(tenant.business.id, {
      monthlyWhatsAppMessages: 5,
      monthlyAiInputTokens: 5000,
      monthlyAiOutputTokens: 5000,
      aiTokensPerRequest: 4000,
    });
    const cloud = {
      sendTextMessage: jest
        .fn()
        .mockImplementation(async () => `wamid.${randomUUID()}`),
    };
    const outbound = new OutboundMessageService(
      runtime,
      new OutboxStore(runtime),
      usage,
      cloud,
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
         VALUES ($1,$2,$3,1,'Quiet standing fan','Quiet standing fan with remote control. The price is 25,000 NGN.','FAN-01',25000,'NGN','IN_STOCK')`,
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
         VALUES ($1,$2,'inbound','Price quiet standing fan','delivered',$3,'{}') RETURNING id`,
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
      usage,
      outbound,
      model,
    );
    const operation = {
      id: runId,
      businessId: tenant.business.id,
      operation: 'whatsapp.ai_response',
      metadata: { aiResponseRunId: runId },
    } as unknown as OutboxOperation;
    await Promise.all([service.execute(operation), service.execute(operation)]);

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
    expect(run.outbound_message_id).toBeTruthy();
    const [outboxOperation] = await runtime
      .getRepository(OutboxOperation)
      .findBy({
        id: run.outbound_message_id!,
      });
    await outbound.execute(outboxOperation);
    expect(cloud.sendTextMessage).toHaveBeenCalledWith(
      {
        to: tenant.customer.whatsappId,
        message:
          'The quiet standing fan costs NGN 25,000 and includes remote control.',
      },
      tenant.business.id,
    );
    const [outboundRow] = await admin.query<
      { status: string; provider_message_id: string }[]
    >(
      `SELECT status,provider_message_id FROM public.whatsapp_outbound_messages WHERE id=$1 AND business_id=$2`,
      [run.outbound_message_id, tenant.business.id],
    );
    expect(outboundRow.status).toBe('ACCEPTED');
    await outbound.reconcileProviderStatus(
      tenant.business.id,
      outboundRow.provider_message_id,
      'delivered',
    );
    const [delivered] = await admin.query<{ status: string }[]>(
      `SELECT status FROM public.whatsapp_outbound_messages WHERE id=$1 AND business_id=$2`,
      [run.outbound_message_id, tenant.business.id],
    );
    expect(delivered.status).toBe('DELIVERED');
    await expect(
      new UsageService(runtime).getUsageSummary(tenant.business.id),
    ).resolves.toMatchObject({
      categories: {
        ai_input_tokens: { consumed: 150 },
        ai_output_tokens: { consumed: 16 },
      },
    });

    const staleRunId = randomUUID();
    const [staleMessage] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.messages
        ("businessId","conversationId",direction,content,status,"whatsappMessageId",metadata)
       VALUES ($1,$2,'inbound','Can you tell me about the fan?','delivered',$3,'{}') RETURNING id`,
      [tenant.business.id, tenant.conversation.id, randomUUID()],
    );
    const [staleLead] = await admin.query<{ id: string }[]>(
      `SELECT id FROM public.merchant_leads WHERE business_id=$1 AND conversation_id=$2`,
      [tenant.business.id, tenant.conversation.id],
    );
    await admin.query(
      `INSERT INTO public.ai_response_runs(id,business_id,inbound_message_id,conversation_id,lead_id,authorized_control_version)
       VALUES ($1,$2,$3,$4,$5,1)`,
      [
        staleRunId,
        tenant.business.id,
        staleMessage.id,
        tenant.conversation.id,
        staleLead.id,
      ],
    );
    const staleOperation = {
      id: staleRunId,
      businessId: tenant.business.id,
      operation: 'whatsapp.ai_response',
      metadata: { aiResponseRunId: staleRunId },
    } as unknown as OutboxOperation;
    await service.execute(staleOperation);
    const [staleRun] = await admin.query<{ outbound_message_id: string }[]>(
      'SELECT outbound_message_id FROM public.ai_response_runs WHERE id=$1',
      [staleRunId],
    );
    expect(staleRun.outbound_message_id).toBeTruthy();
    // Keep this dispatch-fence scenario deterministic even when the retrieval
    // fixture chooses a handoff for this follow-up turn.
    await admin.query(
      'UPDATE public.ai_response_runs SET evidence=$2 WHERE id=$1 AND business_id=$3',
      [
        staleRunId,
        JSON.stringify([
          {
            sourceId: productId,
            revisionId,
            sourceType: 'PRODUCT',
          },
        ]),
        tenant.business.id,
      ],
    );
    const replacementRevisionId = randomUUID();
    await admin.query(
      `INSERT INTO public.merchant_product_revisions
         (id,business_id,product_id,revision,name,description,sku,price,currency,availability)
       VALUES ($1,$2,$3,2,'Quiet standing fan','Quiet standing fan with remote control. The price is 25,000 NGN.','FAN-01',25000,'NGN','IN_STOCK')`,
      [replacementRevisionId, tenant.business.id, productId],
    );
    await admin.query(
      'UPDATE public.merchant_products SET draft_revision_id=$3,published_revision_id=$3,published_at=now() WHERE id=$1 AND business_id=$2',
      [productId, tenant.business.id, replacementRevisionId],
    );
    const [staleOutboundOperation] = await runtime
      .getRepository(OutboxOperation)
      .findBy({ id: staleRun.outbound_message_id });
    await outbound.execute(staleOutboundOperation);
    const [suppressed] = await admin.query<
      { status: string; last_error: string }[]
    >(
      'SELECT status,last_error FROM public.whatsapp_outbound_messages WHERE id=$1 AND business_id=$2',
      [staleRun.outbound_message_id, tenant.business.id],
    );
    expect(suppressed).toEqual({
      status: 'SUPPRESSED',
      last_error: 'PUBLISHED_EVIDENCE_CHANGED',
    });
    expect(cloud.sendTextMessage).toHaveBeenCalledTimes(1);

    const fallbackRunId = randomUUID();
    const [fallbackMessage] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.messages
        ("businessId","conversationId",direction,content,status,"whatsappMessageId",metadata)
       VALUES ($1,$2,'inbound','Can you deliver this tomorrow?','delivered',$3,'{}') RETURNING id`,
      [tenant.business.id, tenant.conversation.id, randomUUID()],
    );
    const [fallbackLead] = await admin.query<{ id: string }[]>(
      `SELECT id FROM public.merchant_leads WHERE business_id=$1 AND conversation_id=$2`,
      [tenant.business.id, tenant.conversation.id],
    );
    await admin.query(
      `INSERT INTO public.ai_response_runs(id,business_id,inbound_message_id,conversation_id,lead_id,authorized_control_version)
       VALUES ($1,$2,$3,$4,$5,1)`,
      [
        fallbackRunId,
        tenant.business.id,
        fallbackMessage.id,
        tenant.conversation.id,
        fallbackLead.id,
      ],
    );
    await admin.query(
      `INSERT INTO public.outbox_operations(id,"businessId",operation,metadata)
       VALUES ($1,$2,'whatsapp.ai_response',$3)`,
      [
        fallbackRunId,
        tenant.business.id,
        JSON.stringify({ aiResponseRunId: fallbackRunId }),
      ],
    );
    const unusedModel = { generate: jest.fn() };
    const fallbackService = new AiResponseService(
      runtime,
      new UnifiedKnowledgeRetrievalService(runtime),
      usage,
      outbound,
      unusedModel as never,
    );
    await fallbackService.execute({
      ...operation,
      id: fallbackRunId,
      metadata: { aiResponseRunId: fallbackRunId },
    });
    const [handoff] = await admin.query<
      {
        status: string;
        error_category: string;
        outbound_message_id: string | null;
      }[]
    >(
      `SELECT status,error_category,outbound_message_id FROM public.ai_response_runs WHERE id=$1 AND business_id=$2`,
      [fallbackRunId, tenant.business.id],
    );
    expect(handoff).toMatchObject({
      status: 'HANDOFF_REQUIRED',
      error_category: 'NO_MATCH',
    });
    expect(unusedModel.generate).not.toHaveBeenCalled();
    expect(handoff.outbound_message_id).toBeTruthy();
    expect(inboundId).toBeTruthy();
  });
});
