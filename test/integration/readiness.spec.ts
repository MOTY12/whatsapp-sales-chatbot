import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { ApplicationLogger, correlateRequest } from '../../src/config/logging';
import { applyMigrations, createIntegrationDatabase } from './postgres';

describe('HTTP application database readiness', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let app: INestApplication<App>;
  let source: DataSource;

  beforeAll(async () => {
    database = await createIntegrationDatabase();
    const migrator = await database.migrator();
    await applyMigrations(migrator);
    await database.grantRuntimeAccess(migrator);
    await migrator.destroy();
    const runtime = await database.runtime();
    const options = runtime.options;
    if (options.type !== 'postgres' || typeof options.password !== 'string') {
      throw new Error('Expected disposable PostgreSQL runtime credentials.');
    }
    jest.replaceProperty(process, 'env', {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_HOST: options.host,
      DATABASE_PORT: String(options.port),
      DATABASE_USER: options.username,
      DATABASE_PASSWORD: options.password,
      DATABASE_NAME: options.database,
      DATABASE_SSL: 'false',
      DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
      DATABASE_SSL_CA: '',
      META_APP_ID: 'fixture-app',
      META_APP_SECRET: 'fixture-secret',
      META_REDIRECT_URI: 'http://localhost/meta/embedded-signup/callback',
      META_GRAPH_BASE_URL: 'https://graph.facebook.com',
      WHATSAPP_BUSINESS_CONFIG_ID: 'fixture-config',
      WHATSAPP_API_VERSION: 'v25.0',
      WHATSAPP_VERIFY_TOKEN: 'fixture-verify',
    });
    await runtime.destroy();

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({
      rawBody: true,
      logger: new ApplicationLogger(['log']),
    });
    app.use(correlateRequest);
    await app.init();
    source = app.get(DataSource);
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      jest.restoreAllMocks();
      await database?.close();
    }
  });

  it('initializes the API and migration CLI with the same database options', async () => {
    const { default: cli }: { default: DataSource } =
      await import('../../src/database/data-source');
    const { logger, migrations, ...cliOptions } = cli.options;
    expect(migrations).toBeDefined();
    expect(logger).toBeDefined();
    expect(source.options).toMatchObject(cliOptions);
    await expect(source.query('SELECT 1')).resolves.toHaveLength(1);
  });

  it('returns minimal health responses and changes readiness when the PostgreSQL pool disconnects', async () => {
    const server = app.getHttpServer();
    const sink = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      const requestId = '6ea31eaf-d2b2-4f28-9ea3-f1c3af3a55f9';
      await request(server)
        .get('/health/ready?access_token=private-query-token')
        .set('x-request-id', requestId)
        .expect('x-request-id', requestId)
        .expect(200, { status: 'ok' });
      const logs = sink.mock.calls.map(([line]) => String(line)).join('\n');
      expect(logs).toContain(requestId);
      expect(logs).toContain('request.completed');
      expect(logs).not.toContain('private-query-token');
    } finally {
      sink.mockRestore();
    }

    await source.destroy();
    try {
      await request(server)
        .get('/health/live')
        .set('x-request-id', 'Bearer private-token')
        .expect('x-request-id', /^[0-9a-f-]{36}$/)
        .expect(200, { status: 'ok' });
      await request(server)
        .get('/health/ready')
        .expect(503, { status: 'unavailable' });
    } finally {
      await source.initialize();
    }
    await request(server).get('/health/ready').expect(200, { status: 'ok' });
  });
});
