import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { OutboxOperation } from '../../src/database/entities/outbox-operation.entity';
import { Business } from '../../src/database/entities/business.entity';
import { OutboxStore } from '../../src/jobs/outbox.store';
import { UsageService } from '../../src/metering/usage.service';
import { OutboundMessageService } from '../../src/whatsapp/outbound-message.service';
import { WhatsAppProviderError } from '../../src/whatsapp/interfaces/whatsapp-cloud-api-client.interface';
import { WhatsAppResponseIntentDispatcher } from '../../src/whatsapp/response-intent.dispatcher';
import { WhatsAppCloudApiService } from '../../src/whatsapp/whatsapp-cloud-api.service';
import { ChannelConnectionService } from '../../src/channels/channel-connection.service';
import { CredentialCipher } from '../../src/channels/secure-whatsapp/credential-cipher';
import { BusinessRepository } from '../../src/database/repositories/business.repository';
import { applyMigrations, createIntegrationDatabase } from './postgres';
import { startMetaFixture } from './meta-fixture';

describe('durable WhatsApp outbound messages', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let admin: DataSource;
  let runtime: DataSource;
  let usage: UsageService;
  let outbound: OutboundMessageService;
  let cloud: { sendTextMessage: jest.Mock };
  let businessId: string;
  let connectionId: string;
  let conversationId: string;
  let recipient: string;
  let metaFixture: Awaited<ReturnType<typeof startMetaFixture>>;
  let credentialCipher: CredentialCipher;
  let originalMetaEnv: Pick<
    NodeJS.ProcessEnv,
    | 'META_GRAPH_BASE_URL'
    | 'WHATSAPP_CREDENTIAL_KEY_ID'
    | 'WHATSAPP_CREDENTIAL_KEYS'
  >;

  beforeAll(async () => {
    originalMetaEnv = {
      META_GRAPH_BASE_URL: process.env.META_GRAPH_BASE_URL,
      WHATSAPP_CREDENTIAL_KEY_ID: process.env.WHATSAPP_CREDENTIAL_KEY_ID,
      WHATSAPP_CREDENTIAL_KEYS: process.env.WHATSAPP_CREDENTIAL_KEYS,
    };
    metaFixture = await startMetaFixture();
    process.env.META_GRAPH_BASE_URL = metaFixture.origin;
    process.env.WHATSAPP_CREDENTIAL_KEY_ID = 'outbound-fixture';
    process.env.WHATSAPP_CREDENTIAL_KEYS = JSON.stringify({
      'outbound-fixture': randomBytes(32).toString('base64url'),
    });
    credentialCipher = new CredentialCipher();
    database = await createIntegrationDatabase();
    admin = await database.migrator();
    await applyMigrations(admin);
    await database.grantRuntimeAccess(admin);
    runtime = await database.runtime();
    usage = new UsageService(runtime);
  });

  beforeEach(async () => {
    const business = await admin.getRepository(Business).save({
      name: 'Outbound Shop',
      phone: randomUUID(),
    });
    businessId = business.id;
    recipient = '2348012345678';
    connectionId = randomUUID();
    conversationId = randomUUID();
    const customerId = randomUUID();
    await admin.query(
      `INSERT INTO public.channel_connections (id, "businessId", provider, "externalAccountId", "externalAssetId", status, "verifiedAt")
       VALUES ($1,$2,'whatsapp','waba-fixture',$3,'active',now())`,
      [connectionId, businessId, 'phone-' + connectionId],
    );
    await admin.query(
      `INSERT INTO public.whatsapp_credentials (business_id, connection_id, envelope)
       VALUES ($1,$2,$3)`,
      [
        businessId,
        connectionId,
        JSON.stringify(
          credentialCipher.encrypt(
            'fixture-access-token',
            businessId,
            connectionId,
          ),
        ),
      ],
    );
    await admin.query(
      `INSERT INTO public.customers (id, "businessId", name, phone, "whatsappId", source)
       VALUES ($1,$2,'Customer',$3,$3,'whatsapp')`,
      [customerId, businessId, recipient],
    );
    await admin.query(
      `INSERT INTO public.conversations (id, "businessId", "customerId", status)
       VALUES ($1,$2,$3,'open')`,
      [conversationId, businessId, customerId],
    );
    await admin.query(
      `INSERT INTO public.messages ("businessId", "conversationId", direction, content, status, "createdAt")
       VALUES ($1,$2,'inbound','recent question','delivered',now())`,
      [businessId, conversationId],
    );
    await usage.setBusinessLimits(businessId, {
      monthlyWhatsAppMessages: 5,
      monthlyAiInputTokens: null,
      monthlyAiOutputTokens: null,
      aiTokensPerRequest: null,
    });
    cloud = {
      sendTextMessage: jest
        .fn()
        .mockImplementation(async () => `wamid.${randomUUID()}`),
    };
    outbound = new OutboundMessageService(
      runtime,
      new OutboxStore(runtime),
      usage,
      cloud,
    );
  });

  afterAll(async () => {
    await metaFixture?.close();
    for (const key of Object.keys(originalMetaEnv ?? {})) {
      const envKey = key as keyof typeof originalMetaEnv;
      const value = originalMetaEnv?.[envKey];
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
    await database?.close();
  });

  const queueMessage = (key = randomUUID()) =>
    outbound.enqueueTextMessage(
      businessId,
      { to: recipient, message: 'Thanks for your message.' },
      key,
    );

  const queueFencedAiMessage = (controlVersion: number, key = randomUUID()) =>
    outbound.enqueueTextMessage(
      businessId,
      { to: recipient, message: 'Automated reply.' },
      key,
      undefined,
      { conversationId, kind: 'AI', controlVersion },
    );

  async function outboxFor(id: string) {
    return runtime.getRepository(OutboxOperation).findOneByOrFail({ id });
  }

  async function outboundRow(id: string) {
    const [row] = await admin.query<
      {
        status: string;
        message_id: string;
        provider_message_id: string | null;
      }[]
    >(
      `SELECT status, message_id, provider_message_id FROM public.whatsapp_outbound_messages WHERE id = $1`,
      [id],
    );
    return row;
  }

  it('suppresses queued AI intents after takeover and keeps them stale after release', async () => {
    const id = await queueFencedAiMessage(1);
    await admin.query(
      `UPDATE public.conversations SET control_mode = 'HUMAN', control_version = 2
        WHERE id = $1 AND "businessId" = $2`,
      [conversationId, businessId],
    );
    await outbound.execute({ ...(await outboxFor(id)) });
    await expect(outboundRow(id)).resolves.toMatchObject({
      status: 'SUPPRESSED',
    });
    expect(cloud.sendTextMessage).not.toHaveBeenCalled();

    await admin.query(
      `UPDATE public.conversations SET control_mode = 'AUTO', control_version = 3
        WHERE id = $1 AND "businessId" = $2`,
      [conversationId, businessId],
    );
    await outbound.execute({ ...(await outboxFor(id)) });
    expect(cloud.sendTextMessage).not.toHaveBeenCalled();
    await expect(outboundRow(id)).resolves.toMatchObject({
      status: 'SUPPRESSED',
    });
  });

  it('allows a human reply while takeover is active', async () => {
    await admin.query(
      `UPDATE public.conversations SET control_mode = 'HUMAN', control_version = 2
        WHERE id = $1 AND "businessId" = $2`,
      [conversationId, businessId],
    );
    const id = await outbound.enqueueTextMessage(
      businessId,
      { to: recipient, message: 'Merchant reply.' },
      randomUUID(),
      undefined,
      { conversationId, kind: 'HUMAN' },
    );
    await outbound.execute({ ...(await outboxFor(id)) });
    expect(cloud.sendTextMessage).toHaveBeenCalledTimes(1);
    await expect(outboundRow(id)).resolves.toMatchObject({
      status: 'ACCEPTED',
    });
  });

  it('persists intent and reserves quota before the worker calls Meta, then charges acceptance once', async () => {
    const id = await queueMessage();
    expect(await outboundRow(id)).toMatchObject({
      status: 'RESERVED',
      provider_message_id: null,
    });
    expect(
      await usage.getRemainingAllowance(businessId, 'whatsapp_outbound'),
    ).toBe(4);
    expect(cloud.sendTextMessage).not.toHaveBeenCalled();

    const operation = await outboxFor(id);
    await outbound.execute(operation);
    expect(await outboundRow(id)).toMatchObject({ status: 'ACCEPTED' });
    expect((await outboundRow(id)).provider_message_id).toBeTruthy();
    expect(
      await usage.getRemainingAllowance(businessId, 'whatsapp_outbound'),
    ).toBe(4);
    await outbound.execute(operation);
    expect(cloud.sendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('sends through the local Meta Cloud API fixture with the encrypted tenant credential', async () => {
    const realClient = new WhatsAppCloudApiService(
      new BusinessRepository(runtime.getRepository(Business)),
      new ChannelConnectionService(runtime),
      credentialCipher,
      runtime,
    );
    outbound = new OutboundMessageService(
      runtime,
      new OutboxStore(runtime),
      usage,
      realClient,
    );
    const id = await queueMessage();
    await outbound.execute(await outboxFor(id));
    expect(metaFixture.sent).toContain('fixture-access-token');
    expect(await outboundRow(id)).toMatchObject({
      status: 'ACCEPTED',
      provider_message_id: 'wamid.fixture',
    });
    expect(
      await usage.getRemainingAllowance(businessId, 'whatsapp_outbound'),
    ).toBe(4);
  });

  it('releases quota on definitive provider rejection and retains it on ambiguous timeouts', async () => {
    const rejectedId = await queueMessage();
    cloud.sendTextMessage.mockRejectedValueOnce(
      new WhatsAppProviderError(true, 'PROVIDER_REJECTED'),
    );
    await outbound.execute(await outboxFor(rejectedId));
    expect(await outboundRow(rejectedId)).toMatchObject({ status: 'FAILED' });
    expect(
      await usage.getRemainingAllowance(businessId, 'whatsapp_outbound'),
    ).toBe(5);

    const uncertainId = await queueMessage();
    cloud.sendTextMessage.mockRejectedValueOnce(
      new WhatsAppProviderError(false, 'TIMEOUT'),
    );
    await outbound.execute(await outboxFor(uncertainId));
    expect(await outboundRow(uncertainId)).toMatchObject({
      status: 'UNCERTAIN',
    });
    expect(
      await usage.getRemainingAllowance(businessId, 'whatsapp_outbound'),
    ).toBe(4);
    await outbound.execute(await outboxFor(uncertainId));
    expect(cloud.sendTextMessage).toHaveBeenCalledTimes(2);
    await outbound.resolveUncertain(businessId, uncertainId, 'failed');
    expect(await outboundRow(uncertainId)).toMatchObject({ status: 'FAILED' });
    expect(
      await usage.getRemainingAllowance(businessId, 'whatsapp_outbound'),
    ).toBe(5);
  });

  it('deduplicates concurrent logical sends and keeps the same outbox ID and charge', async () => {
    const key = randomUUID();
    const [first, second] = await Promise.all([
      queueMessage(key),
      queueMessage(key),
    ]);
    expect(first).toBe(second);
    const [rows] = await admin.query<{ total: number }[]>(
      `SELECT count(*)::int AS total FROM public.whatsapp_outbound_messages WHERE business_id = $1 AND idempotency_key = $2`,
      [businessId, key],
    );
    expect(rows.total).toBe(1);
    expect(
      await usage.getRemainingAllowance(businessId, 'whatsapp_outbound'),
    ).toBe(4);
  });

  it('fails closed on quota exhaustion, disconnected connections, cross-tenant connection IDs, and expired windows', async () => {
    await usage.setBusinessLimits(businessId, {
      monthlyWhatsAppMessages: 0,
      monthlyAiInputTokens: null,
      monthlyAiOutputTokens: null,
      aiTokensPerRequest: null,
    });
    await expect(queueMessage()).rejects.toThrow('Usage allowance exceeded');
    await usage.setBusinessLimits(businessId, {
      monthlyWhatsAppMessages: 5,
      monthlyAiInputTokens: null,
      monthlyAiOutputTokens: null,
      aiTokensPerRequest: null,
    });
    await admin.query(
      `UPDATE public.channel_connections SET status = 'inactive' WHERE id = $1`,
      [connectionId],
    );
    await expect(queueMessage()).rejects.toThrow(
      'Verified WhatsApp connection is unavailable',
    );
    await admin.query(
      `UPDATE public.channel_connections SET status = 'active' WHERE id = $1`,
      [connectionId],
    );
    await admin.query(
      `UPDATE public.messages SET "createdAt" = now() - interval '25 hours' WHERE "businessId" = $1 AND direction = 'inbound'`,
      [businessId],
    );
    await expect(queueMessage()).rejects.toThrow('customer-service window');
  });

  it('does not resend a worker operation left in SENDING and reconciles out-of-order provider receipts monotonically', async () => {
    const id = await queueMessage();
    await admin.query(
      `UPDATE public.whatsapp_outbound_messages SET status = 'SENDING' WHERE id = $1`,
      [id],
    );
    await outbound.execute(await outboxFor(id));
    expect(await outboundRow(id)).toMatchObject({ status: 'UNCERTAIN' });
    expect(cloud.sendTextMessage).not.toHaveBeenCalled();

    const acceptedId = await queueMessage();
    await outbound.execute(await outboxFor(acceptedId));
    const accepted = await outboundRow(acceptedId);
    expect(accepted.provider_message_id).toBeTruthy();
    expect(
      await outbound.reconcileProviderStatus(
        businessId,
        accepted.provider_message_id!,
        'read',
      ),
    ).toBe(true);
    expect(
      await outbound.reconcileProviderStatus(
        businessId,
        accepted.provider_message_id!,
        'delivered',
      ),
    ).toBe(true);
    expect(await outboundRow(acceptedId)).toMatchObject({ status: 'READ' });

    const failedThenDelivered = await queueMessage();
    await outbound.execute(await outboxFor(failedThenDelivered));
    const delayed = await outboundRow(failedThenDelivered);
    expect(delayed.provider_message_id).toBeTruthy();
    await outbound.reconcileProviderStatus(
      businessId,
      delayed.provider_message_id!,
      'failed',
    );
    await outbound.reconcileProviderStatus(
      businessId,
      delayed.provider_message_id!,
      'delivered',
    );
    expect(await outboundRow(failedThenDelivered)).toMatchObject({
      status: 'DELIVERED',
    });
  });

  it('preserves an unmatched delivery callback and reconciles it when the send result appears', async () => {
    const id = await queueMessage();
    const receiptId = randomUUID();
    await admin.query(
      `INSERT INTO public.outbox_operations (id, "businessId", operation, metadata)
       VALUES ($1,$2,'whatsapp.receipt',$3)`,
      [receiptId, businessId, JSON.stringify({ receiptId })],
    );
    await admin.query(
      `INSERT INTO public.webhook_receipts (id, provider, connection_id, business_id, event_key, event_type, payload)
       VALUES ($1,'whatsapp',$2,$3,$4,'delivery',$5)`,
      [
        receiptId,
        connectionId,
        businessId,
        `delivery-${receiptId}`,
        JSON.stringify({ messageId: 'wamid.late', status: 'delivered' }),
      ],
    );
    await admin.query(
      `INSERT INTO public.whatsapp_unmatched_statuses
        (business_id, connection_id, provider_message_id, provider_status, receipt_id)
       VALUES ($1,$2,'wamid.late','delivered',$3)`,
      [businessId, connectionId, receiptId],
    );
    cloud.sendTextMessage.mockResolvedValueOnce('wamid.late');
    await outbound.execute(await outboxFor(id));
    expect(await outboundRow(id)).toMatchObject({
      status: 'DELIVERED',
      provider_message_id: 'wamid.late',
    });
    const [stored] = await admin.query<{ reconciled_at: Date | null }[]>(
      `SELECT reconciled_at FROM public.whatsapp_unmatched_statuses WHERE receipt_id = $1`,
      [receiptId],
    );
    expect(stored.reconciled_at).toBeTruthy();
    expect(
      await usage.getRemainingAllowance(businessId, 'whatsapp_outbound'),
    ).toBe(4);
  });

  it('dispatches generated owner and legacy onboarding replies as separate durable outbounds', async () => {
    const intentId = randomUUID();
    const receiptId = randomUUID();
    const messageId = randomUUID();
    const ownerId = randomUUID();
    const accountId = randomUUID();
    await admin.query(
      `INSERT INTO public.accounts (id, issuer, subject) VALUES ($1,'https://idp.example.test',$2)`,
      [accountId, ownerId],
    );
    await admin.query(
      `INSERT INTO public.users (id, "businessId", email, "firstName", password, roles, "whatsappId")
       VALUES ($1,$2,$3,'Owner','fixture','owner',$4)`,
      [ownerId, businessId, `${ownerId}@example.test`, recipient],
    );
    await admin.query(
      `UPDATE public.business_members SET "accountId" = $2, "verifiedWhatsappId" = $4
        WHERE "businessId" = $1 AND "legacyUserId" = $3`,
      [businessId, accountId, ownerId, recipient],
    );
    await admin.query(
      `INSERT INTO public.outbox_operations (id, "businessId", operation, metadata) VALUES ($1,$2,'whatsapp.receipt',$3)`,
      [receiptId, businessId, JSON.stringify({ receiptId })],
    );
    await admin.query(
      `INSERT INTO public.webhook_receipts (id, provider, connection_id, business_id, event_key, event_type, payload)
       VALUES ($1,'whatsapp',$2,$3,$4,'message',$5)`,
      [
        receiptId,
        connectionId,
        businessId,
        'response-fixture-' + receiptId,
        JSON.stringify({
          senderId: recipient,
          messageId: 'inbound-' + receiptId,
          text: 'show pipeline',
        }),
      ],
    );
    await admin.query(
      `INSERT INTO public.messages (id, "businessId", "conversationId", direction, content, status, "whatsappMessageId") VALUES ($1,$2,$3,'inbound','show pipeline','delivered',$4)`,
      [messageId, businessId, conversationId, 'inbound-' + receiptId],
    );
    await admin.query(
      `INSERT INTO public.whatsapp_response_intents (id, business_id, receipt_id, message_id, response_kind) VALUES ($1,$2,$3,$4,'owner_command')`,
      [intentId, businessId, receiptId, messageId],
    );
    const assistant = {
      handleIncomingMessage: jest
        .fn()
        .mockResolvedValue({ to: recipient, message: 'Pipeline: no leads.' }),
    };
    const onboarding = {
      handleIncomingMessage: jest
        .fn()
        .mockResolvedValue({ to: recipient, message: 'Welcome to Kleva.' }),
    };
    expect(
      await admin.query(
        `SELECT "legacyUserId", "verifiedWhatsappId", status FROM public.business_members WHERE "businessId" = $1`,
        [businessId],
      ),
    ).toEqual([
      {
        legacyUserId: ownerId,
        verifiedWhatsappId: recipient,
        status: 'active',
      },
    ]);
    const dispatcher = new WhatsAppResponseIntentDispatcher(
      runtime,
      assistant as never,
      onboarding as never,
      outbound,
    );
    const operation = {
      id: intentId,
      businessId,
      metadata: { responseIntentId: intentId },
    } as unknown as OutboxOperation;
    await dispatcher.execute(operation);
    const [intent] = await admin.query<
      { status: string; response_text: string }[]
    >(
      `SELECT status, response_text FROM public.whatsapp_response_intents WHERE id = $1`,
      [intentId],
    );
    expect(intent).toEqual({
      status: 'QUEUED',
      response_text: 'Pipeline: no leads.',
    });
    expect(assistant.handleIncomingMessage).toHaveBeenCalledTimes(1);
    const [outboundRow] = await admin.query<{ id: string; status: string }[]>(
      `SELECT id, status FROM public.whatsapp_outbound_messages WHERE response_intent_id = $1`,
      [intentId],
    );
    expect(outboundRow.status).toBe('RESERVED');
    await dispatcher.execute(operation);
    expect(assistant.handleIncomingMessage).toHaveBeenCalledTimes(1);

    const onboardingIntentId = randomUUID();
    const onboardingReceiptId = randomUUID();
    const onboardingMessageId = randomUUID();
    await admin.query(
      `INSERT INTO public.outbox_operations (id, "businessId", operation, metadata) VALUES ($1,$2,'whatsapp.receipt',$3)`,
      [
        onboardingReceiptId,
        businessId,
        JSON.stringify({ receiptId: onboardingReceiptId }),
      ],
    );
    await admin.query(
      `INSERT INTO public.webhook_receipts (id, provider, connection_id, business_id, event_key, event_type, payload)
       VALUES ($1,'whatsapp',$2,$3,$4,'message',$5)`,
      [
        onboardingReceiptId,
        connectionId,
        businessId,
        'response-fixture-' + onboardingReceiptId,
        JSON.stringify({
          senderId: recipient,
          messageId: 'inbound-' + onboardingReceiptId,
          text: 'hi',
        }),
      ],
    );
    await admin.query(
      `INSERT INTO public.messages (id, "businessId", "conversationId", direction, content, status, "whatsappMessageId") VALUES ($1,$2,$3,'inbound','hi','delivered',$4)`,
      [
        onboardingMessageId,
        businessId,
        conversationId,
        'inbound-' + onboardingReceiptId,
      ],
    );
    await admin.query(
      `INSERT INTO public.whatsapp_response_intents (id, business_id, receipt_id, message_id, response_kind) VALUES ($1,$2,$3,$4,'legacy_onboarding')`,
      [
        onboardingIntentId,
        businessId,
        onboardingReceiptId,
        onboardingMessageId,
      ],
    );
    await dispatcher.execute({
      id: onboardingIntentId,
      businessId,
      metadata: { responseIntentId: onboardingIntentId },
    } as unknown as OutboxOperation);
    expect(onboarding.handleIncomingMessage).toHaveBeenCalledTimes(1);
    const [onboardingReply] = await admin.query<
      { status: string; response_text: string }[]
    >(
      `SELECT status, response_text FROM public.whatsapp_response_intents WHERE id = $1`,
      [onboardingIntentId],
    );
    expect(onboardingReply).toEqual({
      status: 'QUEUED',
      response_text: 'Welcome to Kleva.',
    });
  });
});
