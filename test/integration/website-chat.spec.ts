import { randomBytes, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { WebsiteChatService } from '../../src/website-chat/website-chat.service';
import { seedTenant } from './fixtures';
import { applyMigrations, createIntegrationDatabase } from './postgres';

describe('public website chat sessions and messages', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let admin: DataSource;
  let runtime: DataSource;
  let tenant: Awaited<ReturnType<typeof seedTenant>>;
  let chat: WebsiteChatService;
  const publicId = randomBytes(24).toString('base64url');
  const origin = 'https://store.example.test';

  beforeAll(async () => {
    database = await createIntegrationDatabase();
    admin = await database.migrator();
    await applyMigrations(admin);
    tenant = await seedTenant(admin, 1);
    await database.grantRuntimeAccess(admin);
    runtime = await database.runtime();
    chat = new WebsiteChatService(runtime);
    const widgetId = randomUUID();
    await admin.query(
      `INSERT INTO public.website_widgets(id,business_id,public_id,name,enabled,ai_enabled,configuration)
       VALUES($1,$2,$3,'Integration website',true,false,$4)`,
      [
        widgetId,
        tenant.business.id,
        publicId,
        JSON.stringify({ assistantName: 'Shop Assistant' }),
      ],
    );
    await admin.query(
      `INSERT INTO public.website_widget_domains(business_id,widget_id,origin)
       VALUES($1,$2,$3)`,
      [tenant.business.id, widgetId, origin],
    );
  });

  afterAll(async () => {
    await runtime?.destroy();
    await database?.close();
  });

  it('creates a tenant-bound anonymous session, persists one visitor turn and rejects replay conflicts', async () => {
    const config = await chat.publicConfiguration(publicId, origin);
    expect(config).toMatchObject({
      businessName: 'Integration Shop',
      assistantName: 'Shop Assistant',
      aiEnabled: false,
      availability: 'OPEN',
    });

    const session = await chat.createSession(
      publicId,
      origin,
      undefined,
      '127.0.0.1',
    );
    expect(session.token).toHaveLength(43);
    expect(Object.keys(session)).toEqual(['token', 'expiresInSeconds']);
    const idempotencyKey = randomUUID();
    const submitted = await chat.submitMessage(
      publicId,
      session.token,
      origin,
      undefined,
      { text: 'Do you sell Samsung phones?', idempotencyKey },
    );
    expect(submitted).toMatchObject({ accepted: true, aiEnabled: false });
    const duplicate = await chat.submitMessage(
      publicId,
      session.token,
      origin,
      undefined,
      { text: 'Do you sell Samsung phones?', idempotencyKey },
    );
    expect(duplicate.messageId).toBe(submitted.messageId);
    await expect(
      chat.submitMessage(publicId, session.token, origin, undefined, {
        text: 'A different message',
        idempotencyKey,
      }),
    ).rejects.toMatchObject({ status: 400 });

    const history = await chat.messages(publicId, session.token, origin);
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      direction: 'inbound',
      content: 'Do you sell Samsung phones?',
    });
    expect(history.contactSaved).toBe(false);
    await expect(
      admin.query(
        `SELECT count(*)::int AS lead_count FROM public.merchant_leads l
         JOIN public.messages m ON m."conversationId"=l.conversation_id AND m."businessId"=l.business_id
         WHERE l.business_id=$1 AND m.idempotency_key=$2`,
        [tenant.business.id, idempotencyKey],
      ),
    ).resolves.toEqual([{ lead_count: 1 }]);
  });

  it('binds visitor credentials to the exact allowed origin and revocation', async () => {
    await expect(
      chat.publicConfiguration(
        publicId,
        'https://store.example.test.attacker.invalid',
      ),
    ).rejects.toMatchObject({ status: 404 });
    const session = await chat.createSession(
      publicId,
      origin,
      undefined,
      '127.0.0.2',
    );
    await expect(
      chat.messages(publicId, session.token, 'https://attacker.example.test'),
    ).rejects.toMatchObject({ status: 403 });
    await chat.endSession(publicId, session.token, origin);
    await expect(
      chat.messages(publicId, session.token, origin),
    ).rejects.toMatchObject({
      status: 403,
    });
  });
});
