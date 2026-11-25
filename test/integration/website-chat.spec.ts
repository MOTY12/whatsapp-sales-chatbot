import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { NestFactory } from '@nestjs/core';
import { WebsiteChatModule } from '../../src/website-chat/website-chat.module';
import { WebsiteChatService } from '../../src/website-chat/website-chat.service';
import { WebsiteRealtimeService } from '../../src/website-chat/website-realtime.service';
import { seedTenant } from './fixtures';
import { applyMigrations, createIntegrationDatabase } from './postgres';

type BrowserLocator = {
  waitFor(options?: { timeout?: number }): Promise<void>;
  click(): Promise<void>;
  fill(value: string): Promise<void>;
};
type WidgetBrowserPage = {
  goto(url: string): Promise<unknown>;
  frameLocator(selector: string): {
    getByRole(
      role: string,
      options?: { name?: string | RegExp },
    ): BrowserLocator;
    getByText(text: string): BrowserLocator;
  };
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
};
type WidgetBrowser = {
  newPage(): Promise<WidgetBrowserPage>;
  close(): Promise<void>;
};
type Chromium = {
  launch(options: { headless: boolean }): Promise<WidgetBrowser>;
};
type WidgetApiApp = {
  listen(port: number, host?: string): Promise<void>;
  getUrl(): Promise<string>;
  close(): Promise<void>;
};

describe('public website chat sessions and messages', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let admin: DataSource;
  let runtime: DataSource;
  let tenant: Awaited<ReturnType<typeof seedTenant>>;
  let chat: WebsiteChatService;
  let realtimeA: WebsiteRealtimeService;
  let realtimeB: WebsiteRealtimeService;
  let conversationId: string;
  let browserDemo: ChildProcess | undefined;
  let previousRedisUrl: string | undefined;
  const publicId = randomBytes(24).toString('base64url');
  const origin = 'https://store.example.test';

  beforeAll(async () => {
    const redisUrl = process.env.KLEVA_TEST_REDIS_URL;
    if (!redisUrl) {
      throw new Error(
        'Set KLEVA_TEST_REDIS_URL to the disposable loopback Redis service.',
      );
    }
    const parsedRedisUrl = new URL(redisUrl);
    if (
      parsedRedisUrl.protocol !== 'redis:' ||
      parsedRedisUrl.hostname !== '127.0.0.1' ||
      !parsedRedisUrl.port
    ) {
      throw new Error(
        'KLEVA_TEST_REDIS_URL must be a redis://127.0.0.1 URL with an explicit port.',
      );
    }
    previousRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = redisUrl;
    database = await createIntegrationDatabase();
    admin = await database.migrator();
    await applyMigrations(admin);
    tenant = await seedTenant(admin, 1);
    await database.grantRuntimeAccess(admin);
    runtime = await database.runtime();
    realtimeA = new WebsiteRealtimeService();
    realtimeB = new WebsiteRealtimeService();
    chat = new WebsiteChatService(runtime, realtimeA);
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
    browserDemo?.kill('SIGTERM');
    await runtime?.destroy();
    realtimeA?.beforeApplicationShutdown();
    realtimeB?.beforeApplicationShutdown();
    await database?.close();
    if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousRedisUrl;
  });

  it('renders the real demo widget and persists a visitor message through the live API', async () => {
    const portServer = createServer();
    await new Promise<void>((resolve) =>
      portServer.listen(0, '127.0.0.1', resolve),
    );
    const demoPort = (portServer.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) =>
      portServer.close((error) => (error ? reject(error) : resolve())),
    );
    const demoOrigin = `http://127.0.0.1:${demoPort}`;
    await admin.query(
      `INSERT INTO public.website_widget_domains(business_id,widget_id,origin)
       SELECT business_id,id,$2 FROM public.website_widgets WHERE public_id=$1
       ON CONFLICT DO NOTHING`,
      [publicId, demoOrigin],
    );

    const options = runtime.options as PostgresConnectionOptions;
    const envNames = [
      'DATABASE_HOST',
      'DATABASE_PORT',
      'DATABASE_USER',
      'DATABASE_PASSWORD',
      'DATABASE_NAME',
      'DATABASE_SSL',
      'DATABASE_SSL_CA',
      'DATABASE_SSL_REJECT_UNAUTHORIZED',
    ] as const;
    const priorEnv = Object.fromEntries(
      envNames.map((name) => [name, process.env[name]]),
    );
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_HOST: String(options.host),
      DATABASE_PORT: String(options.port ?? 5432),
      DATABASE_USER: String(options.username),
      DATABASE_PASSWORD: String(options.password),
      DATABASE_NAME: String(options.database),
      DATABASE_SSL: 'false',
      DATABASE_SSL_CA: '',
      DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
    });

    let apiApp: WidgetApiApp | undefined;
    let browser: WidgetBrowser | undefined;
    try {
      apiApp = await NestFactory.create(WebsiteChatModule, { logger: false });
      await apiApp.listen(0, '127.0.0.1');
      const backendOrigin = new URL(await apiApp.getUrl()).origin;
      const widgetAsset = await fetch(`${backendOrigin}/public/widget.js`);
      if (!widgetAsset.ok)
        throw new Error(`Widget asset returned HTTP ${widgetAsset.status}.`);
      const widgetConfig = await fetch(
        `${backendOrigin}/public/widgets/${publicId}/config`,
        {
          headers: {
            origin: backendOrigin,
            'x-kleva-site-origin': demoOrigin,
          },
        },
      );
      if (!widgetConfig.ok)
        throw new Error(
          `Widget config returned HTTP ${widgetConfig.status}: ${await widgetConfig.text()}`,
        );
      browserDemo = spawn(
        process.execPath,
        [join(process.cwd(), 'apps/chat-widget-demo/server.mjs')],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            KLEVA_BACKEND_ORIGIN: backendOrigin,
            WEBSITE_WIDGET_PUBLIC_ID: publicId,
            WIDGET_DEMO_PORT: String(demoPort),
          },
          stdio: 'ignore',
        },
      );
      let demoReady = false;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          const response = await fetch(demoOrigin);
          demoReady = response.ok;
          if (demoReady) break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      if (!demoReady) throw new Error('Demo site did not start.');
      const dashboardRequire = createRequire(
        join(process.cwd(), 'apps/merchant-dashboard/package.json'),
      );
      const { chromium } = dashboardRequire('@playwright/test') as {
        chromium: Chromium;
      };
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(demoOrigin);
      const widget = page.frameLocator(
        'iframe[title="Kleva customer support chat"]',
      );
      const launcher = widget.getByRole('button', { name: /open chat with/i });
      await launcher.waitFor({ timeout: 10000 });
      await launcher.click();
      const input = widget.getByRole('textbox', { name: 'Your message' });
      await input.fill('Is the Samsung Galaxy A15 available?');
      await widget.getByRole('button', { name: 'Send' }).click();
      await widget
        .getByText('Is the Samsung Galaxy A15 available?')
        .waitFor({ timeout: 10000 });
      let persistedCount = 0;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const [row] = await admin.query<{ count: number }[]>(
          `SELECT count(*)::int AS count FROM public.messages
           WHERE channel='WEBSITE' AND content=$1`,
          ['Is the Samsung Galaxy A15 available?'],
        );
        persistedCount = row?.count ?? 0;
        if (persistedCount === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(persistedCount).toBe(1);

      const sessionResponse = await fetch(
        `${backendOrigin}/public/widgets/${publicId}/sessions`,
        {
          method: 'POST',
          headers: {
            origin: backendOrigin,
            'x-kleva-site-origin': demoOrigin,
            'content-type': 'application/json',
          },
          body: '{}',
        },
      );
      expect(sessionResponse.status).toBe(201);
      const sessionValue: unknown = await sessionResponse.json();
      if (
        !sessionValue ||
        typeof sessionValue !== 'object' ||
        !('token' in sessionValue) ||
        typeof sessionValue.token !== 'string'
      )
        throw new Error('Public API did not return a visitor session.');
      const sessionToken = sessionValue.token;
      const rejectedStream = await fetch(
        `${backendOrigin}/public/widgets/${publicId}/events`,
        {
          headers: {
            origin: backendOrigin,
            'x-kleva-site-origin': 'https://unauthorized.example.test',
          },
        },
      );
      expect(rejectedStream.status).toBe(403);
      const eventStream = await fetch(
        `${backendOrigin}/public/widgets/${publicId}/events`,
        {
          headers: {
            origin: backendOrigin,
            'x-kleva-site-origin': demoOrigin,
            authorization: `Bearer ${sessionToken}`,
            accept: 'text/event-stream',
          },
        },
      );
      expect(eventStream.status).toBe(200);
      const reader = eventStream.body?.getReader();
      if (!reader) throw new Error('SSE response has no stream body.');
      const decoder = new TextDecoder();
      const readyFrame = await reader.read();
      expect(decoder.decode(readyFrame.value)).toContain('event: ready');
      const visitorContext = await chat.visitorEventContext(
        publicId,
        sessionToken,
        demoOrigin,
      );
      await chat.endSession(publicId, sessionToken, demoOrigin);
      const revokedFrame = await reader.read();
      expect(decoder.decode(revokedFrame.value)).toContain(
        'event: session.revoked',
      );
      expect(visitorContext.businessId).toBe(tenant.business.id);
      await reader.cancel();

      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await browser?.close();
      await apiApp?.close();
      browserDemo?.kill('SIGTERM');
      browserDemo = undefined;
      for (const name of envNames) {
        const value = priorEnv[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }, 60000);

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
    conversationId = (
      await chat.visitorEventContext(publicId, session.token, origin)
    ).conversationId;
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

  it('delivers identifier-only events across Redis instances with tenant scoping', async () => {
    const received: string[] = [];
    let resolveReceived!: () => void;
    const delivered = new Promise<void>((resolve) => {
      resolveReceived = resolve;
    });
    const unsubscribe = await realtimeB.subscribe(
      { businessId: tenant.business.id, conversationId },
      (event) => {
        received.push(event.type);
        resolveReceived();
      },
    );
    const wrongTenant: string[] = [];
    const unsubscribeWrong = await realtimeB.subscribe(
      { businessId: randomUUID(), conversationId },
      (event) => wrongTenant.push(event.type),
    );
    await expect(
      realtimeA.publish({
        type: 'message.created',
        businessId: tenant.business.id,
        conversationId,
        messageId: randomUUID(),
      }),
    ).resolves.toBe(true);
    await Promise.race([
      delivered,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Redis event was not delivered')),
          3000,
        ),
      ),
    ]);
    expect(received).toEqual(['message.created']);
    expect(wrongTenant).toEqual([]);
    unsubscribe();
    unsubscribeWrong();
  });

  it('expires and throttles ephemeral typing state without duplicate stop events', async () => {
    await expect(
      realtimeA.publishTyping({
        businessId: tenant.business.id,
        conversationId,
        actor: 'visitor',
        active: true,
      }),
    ).resolves.toBe(true);
    await expect(
      realtimeA.publishTyping({
        businessId: tenant.business.id,
        conversationId,
        actor: 'visitor',
        active: true,
      }),
    ).resolves.toBe(false);
    await expect(
      realtimeA.publishTyping({
        businessId: tenant.business.id,
        conversationId,
        actor: 'visitor',
        active: false,
      }),
    ).resolves.toBe(true);
    await expect(
      realtimeA.publishTyping({
        businessId: tenant.business.id,
        conversationId,
        actor: 'visitor',
        active: false,
      }),
    ).resolves.toBe(false);
  });

  it('reports expired sessions and only deletes them when explicitly enabled outside dry-run', async () => {
    const session = await chat.createSession(
      publicId,
      origin,
      undefined,
      '127.0.0.3',
    );
    const credentialHash = createHash('sha256')
      .update(session.token)
      .digest('hex');
    await admin.query(
      `UPDATE public.website_visitor_sessions SET created_at=now()-interval '9 days', expires_at=now()-interval '2 days'
       WHERE credential_hash=$1`,
      [credentialHash],
    );
    const previousEnabled = process.env.WEBSITE_SESSION_CLEANUP_ENABLED;
    const previousDryRun = process.env.WEBSITE_SESSION_CLEANUP_DRY_RUN;
    try {
      process.env.WEBSITE_SESSION_CLEANUP_ENABLED = 'false';
      process.env.WEBSITE_SESSION_CLEANUP_DRY_RUN = 'true';
      const dryRun = await chat.runRetentionMaintenance();
      expect(dryRun).toMatchObject({
        enabled: false,
        dryRun: true,
        deletedSessions: 0,
      });
      process.env.WEBSITE_SESSION_CLEANUP_ENABLED = 'true';
      process.env.WEBSITE_SESSION_CLEANUP_DRY_RUN = 'false';
      const cleanup = await chat.runRetentionMaintenance();
      expect(cleanup).toMatchObject({
        enabled: true,
        dryRun: false,
        deletedSessions: expect.any(Number),
      });
      await expect(
        admin.query(
          'SELECT count(*)::int AS count FROM public.website_visitor_sessions WHERE credential_hash=$1',
          [credentialHash],
        ),
      ).resolves.toEqual([{ count: 0 }]);
    } finally {
      if (previousEnabled === undefined)
        delete process.env.WEBSITE_SESSION_CLEANUP_ENABLED;
      else process.env.WEBSITE_SESSION_CLEANUP_ENABLED = previousEnabled;
      if (previousDryRun === undefined)
        delete process.env.WEBSITE_SESSION_CLEANUP_DRY_RUN;
      else process.env.WEBSITE_SESSION_CLEANUP_DRY_RUN = previousDryRun;
    }
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
