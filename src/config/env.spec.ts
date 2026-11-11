import { appConfig, databaseConfig, metaConfig } from './env';

const database = {
  DATABASE_HOST: 'localhost',
  DATABASE_USER: 'postgres',
  DATABASE_PASSWORD: 'fixture-db-password',
  DATABASE_NAME: 'kleva_db',
};
const meta = {
  META_APP_ID: 'fixture-app',
  META_APP_SECRET: 'fixture-secret',
  META_REDIRECT_URI: 'http://localhost:3000/meta/embedded-signup/callback',
  WHATSAPP_BUSINESS_CONFIG_ID: 'fixture-config',
  WHATSAPP_API_VERSION: 'v25.0',
};

describe('environment configuration', () => {
  it('reports missing required database settings by name', () => {
    expect(() => databaseConfig({})).toThrow(
      /Missing required environment variables: DATABASE_HOST, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME/,
    );
  });

  it('uses the same database defaults for application and database-only processes', () => {
    const env = { ...database, ...meta };
    const config = appConfig(env);
    expect(config.database).toEqual(databaseConfig(env));
    expect(config.database).toMatchObject({
      host: 'localhost',
      port: 5432,
      ssl: false,
      synchronize: false,
    });
    expect(config).toMatchObject({
      environment: 'development',
      port: 3000,
      redis: { port: 6379 },
      ai: {},
    });
  });

  it.each([
    ['PORT', '0'],
    ['PORT', '65536'],
    ['DATABASE_PORT', '5432invalid'],
    ['DATABASE_PORT', '1.5'],
    ['REDIS_PORT', '1e3'],
    ['NODE_ENV', 'staging'],
    ['LOG_LEVEL', 'invalid'],
    ['REDIS_URL', 'postgres://fixture:secret@localhost/db'],
    ['WHATSAPP_API_VERSION', 'v25'],
    ['META_REDIRECT_URI', 'http://user:secret@localhost/callback'],
  ])('rejects invalid %s without printing the input', (name, value) => {
    expect(() => appConfig({ ...database, ...meta, [name]: value })).toThrow(
      name,
    );
    expect(() =>
      appConfig({ ...database, ...meta, [name]: value }),
    ).not.toThrow(value);
  });

  it.each([
    [{ DATABASE_SSL: 'false' }, /DATABASE_SSL must be enabled/],
    [{ DATABASE_SSL_REJECT_UNAUTHORIZED: 'false' }, /must be true/],
    [{}, /DATABASE_SSL_CA is required/],
    [{ DATABASE_SSL_CA: 'garbage' }, /valid PEM/],
    [{ DATABASE_PASSWORD: 'replace_me' }, /DATABASE_PASSWORD/],
  ])('rejects insecure production database settings', (overrides, message) => {
    expect(() =>
      databaseConfig({ ...database, NODE_ENV: 'production', ...overrides }),
    ).toThrow(message);
  });

  it('requires the official Graph origin in production', () => {
    expect(metaConfig({ NODE_ENV: 'production' }).graphBaseUrl).toBe(
      'https://graph.facebook.com',
    );
    expect(() =>
      metaConfig({
        NODE_ENV: 'production',
        META_GRAPH_BASE_URL: 'https://graph.example.test',
      }),
    ).toThrow('META_GRAPH_BASE_URL');
  });
});
