import {
  aiConfig,
  appConfig,
  databaseConfig,
  metaConfig,
  merchantAuthConfig,
  oidcEnvironmentDiagnostics,
  redisConfig,
  usageConfig,
  whatsappCredentialConfig,
} from './env';

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
  it('keeps AI responses disabled by default and validates enabled credentials and timeouts', () => {
    expect(aiConfig({}).enabled).toBe(false);
    expect(
      aiConfig({
        AI_RESPONSES_ENABLED: 'true',
        OPENAI_API_KEY: 'fixture-secret',
      }),
    ).toMatchObject({
      enabled: true,
      model: 'gpt-4o-mini',
      timeoutMs: 12000,
    });
    expect(() => aiConfig({ AI_RESPONSES_ENABLED: 'true' })).toThrow(
      'OPENAI_API_KEY',
    );
    expect(() => aiConfig({ AI_REQUEST_TIMEOUT_MS: '999' })).toThrow(
      'AI_REQUEST_TIMEOUT_MS',
    );
    expect(() => aiConfig({ AI_HANDOFF_MESSAGE: 'short' })).toThrow(
      'AI_HANDOFF_MESSAGE',
    );
  });
  it('provides configurable per-tenant usage defaults and rejects invalid limits', () => {
    expect(usageConfig({})).toEqual({
      monthlyWhatsAppMessages: 1000,
      monthlyAiInputTokens: 100000,
      monthlyAiOutputTokens: 50000,
      aiTokensPerRequest: 4096,
    });
    expect(
      usageConfig({ USAGE_DEFAULT_MONTHLY_WHATSAPP_MESSAGES: '25' })
        .monthlyWhatsAppMessages,
    ).toBe(25);
    expect(() =>
      usageConfig({ USAGE_DEFAULT_MONTHLY_AI_INPUT_TOKENS: '-1' }),
    ).toThrow('USAGE_DEFAULT_MONTHLY_AI_INPUT_TOKENS');
  });

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

  it('requires production OIDC settings for the merchant dashboard', () => {
    expect(() => merchantAuthConfig({ NODE_ENV: 'production' })).toThrow(
      'OIDC_ISSUER',
    );
  });

  it('reports OIDC configuration checks without returning credentials', () => {
    const diagnostics = oidcEnvironmentDiagnostics({
      OIDC_ISSUER: 'https://accounts.google.com',
      OIDC_CLIENT_ID: '123456789012-example.apps.googleusercontent.com',
      OIDC_CLIENT_SECRET: 'fixture-secret-value',
      OIDC_REDIRECT_URI: 'http://localhost:3001/auth/callback',
    });

    expect(diagnostics).toEqual({
      issuerPresent: true,
      clientIdPresent: true,
      clientIdTrimmed: true,
      clientIdLooksLikeGoogleWebClient: true,
      clientSecretPresent: true,
      clientSecretTrimmed: true,
      clientSecretPlaceholder: false,
      redirectUriPresent: true,
      redirectUriMatchesLocalDashboardCallback: true,
    });
    expect(JSON.stringify(diagnostics)).not.toContain('fixture-secret-value');
  });

  it('detects missing, padded, placeholder and mismatched OIDC settings safely', () => {
    expect(
      oidcEnvironmentDiagnostics({
        OIDC_CLIENT_ID: 'not-a-google-client',
        OIDC_CLIENT_SECRET: ' replace_me ',
        OIDC_REDIRECT_URI: 'http://localhost:3001/wrong',
      }),
    ).toMatchObject({
      issuerPresent: false,
      clientIdLooksLikeGoogleWebClient: false,
      clientSecretTrimmed: false,
      clientSecretPlaceholder: true,
      redirectUriMatchesLocalDashboardCallback: false,
    });
  });

  it('requires a WhatsApp credential keyring in production', () => {
    expect(() => whatsappCredentialConfig({ NODE_ENV: 'production' })).toThrow(
      'WHATSAPP_CREDENTIAL_KEY_ID',
    );
  });

  it('requires an authenticated Redis connection in production', () => {
    expect(() => redisConfig({ NODE_ENV: 'production' })).toThrow(
      'REDIS_PASSWORD',
    );
    expect(() =>
      redisConfig({ NODE_ENV: 'production', REDIS_PASSWORD: 'replace_me' }),
    ).toThrow('REDIS_PASSWORD');
  });
});
