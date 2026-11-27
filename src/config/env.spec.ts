import {
  aiConfig,
  appConfig,
  databaseConfig,
  metaConfig,
  merchantAuthConfig,
  merchantEmailAuthConfig,
  oidcEnvironmentDiagnostics,
  redisConfig,
  usageConfig,
  whatsappCredentialConfig,
  whatsappSignupRuntimeConfig,
  websiteAbuseConfig,
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
      monthlyEmbeddingTokens: 100000,
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

  it.each([
    {
      label: 'local HTTP',
      dashboardOrigin: 'http://localhost:3001',
      secureCookies: false,
    },
    {
      label: 'HTTPS tunnel',
      dashboardOrigin: 'https://merchant-preview.ngrok-free.app',
      secureCookies: true,
    },
  ])(
    'uses the configured dashboard origin for CSRF and cookie security on $label',
    ({ dashboardOrigin, secureCookies }) => {
      const config = merchantAuthConfig({
        ...database,
        MERCHANT_DATABASE_USER: 'kleva_merchant_test',
        MERCHANT_DATABASE_PASSWORD: 'merchant-db-fixture',
        IDENTITY_DATABASE_USER: 'kleva_identity_test',
        IDENTITY_DATABASE_PASSWORD: 'identity-db-fixture',
        OIDC_ISSUER: 'https://accounts.example.test',
        OIDC_CLIENT_ID: 'fixture-client',
        OIDC_CLIENT_SECRET: 'fixture-secret',
        OIDC_REDIRECT_URI: 'http://localhost:3001/auth/callback',
        DASHBOARD_PUBLIC_ORIGIN: dashboardOrigin,
      });

      expect(config).toMatchObject({
        csrfOrigin: dashboardOrigin,
        secureCookies,
      });
    },
  );

  it('rejects dashboard origins that include a path or credentials', () => {
    const authEnv = {
      ...database,
      MERCHANT_DATABASE_USER: 'kleva_merchant_test',
      MERCHANT_DATABASE_PASSWORD: 'merchant-db-fixture',
      IDENTITY_DATABASE_USER: 'kleva_identity_test',
      IDENTITY_DATABASE_PASSWORD: 'identity-db-fixture',
      OIDC_ISSUER: 'https://accounts.example.test',
      OIDC_CLIENT_ID: 'fixture-client',
      OIDC_CLIENT_SECRET: 'fixture-secret',
      OIDC_REDIRECT_URI: 'http://localhost:3001/auth/callback',
    };

    expect(() =>
      merchantAuthConfig({
        ...authEnv,
        DASHBOARD_PUBLIC_ORIGIN: 'https://merchant.example.test/dashboard',
      }),
    ).toThrow('DASHBOARD_PUBLIC_ORIGIN');
    expect(() =>
      merchantAuthConfig({
        ...authEnv,
        DASHBOARD_PUBLIC_ORIGIN: 'https://user:secret@merchant.example.test',
      }),
    ).toThrow('DASHBOARD_PUBLIC_ORIGIN');
  });

  it('accepts only explicitly configured additional dashboard origins for CSRF', () => {
    const config = merchantAuthConfig({
      ...database,
      MERCHANT_DATABASE_USER: 'kleva_merchant_test',
      MERCHANT_DATABASE_PASSWORD: 'merchant-db-fixture',
      IDENTITY_DATABASE_USER: 'kleva_identity_test',
      IDENTITY_DATABASE_PASSWORD: 'identity-db-fixture',
      OIDC_ISSUER: 'https://accounts.example.test',
      OIDC_CLIENT_ID: 'fixture-client',
      OIDC_CLIENT_SECRET: 'fixture-secret',
      OIDC_REDIRECT_URI: 'http://localhost:3001/auth/callback',
      DASHBOARD_PUBLIC_ORIGIN: 'https://merchant.example.test',
      DASHBOARD_ALLOWED_ORIGINS:
        'http://localhost:3001,https://preview.example.test',
    });

    expect(config?.csrfOrigins).toEqual([
      'https://merchant.example.test',
      'http://localhost:3001',
      'https://preview.example.test',
    ]);
    expect(config?.secureCookies).toBe(true);
    expect(() =>
      merchantAuthConfig({
        ...database,
        MERCHANT_DATABASE_USER: 'kleva_merchant_test',
        MERCHANT_DATABASE_PASSWORD: 'merchant-db-fixture',
        IDENTITY_DATABASE_USER: 'kleva_identity_test',
        IDENTITY_DATABASE_PASSWORD: 'identity-db-fixture',
        OIDC_ISSUER: 'https://accounts.example.test',
        OIDC_CLIENT_ID: 'fixture-client',
        OIDC_CLIENT_SECRET: 'fixture-secret',
        OIDC_REDIRECT_URI: 'http://localhost:3001/auth/callback',
        DASHBOARD_PUBLIC_ORIGIN: 'https://merchant.example.test',
        DASHBOARD_ALLOWED_ORIGINS: 'https://attacker.example.test/path',
      }),
    ).toThrow('DASHBOARD_ALLOWED_ORIGINS');
  });

  it('validates Mailjet configuration without exposing values', () => {
    expect(merchantEmailAuthConfig({}).enabled).toBe(false);
    expect(() =>
      merchantEmailAuthConfig({ EMAIL_AUTH_ENABLED: 'true' }),
    ).toThrow(/MAILJET_API_KEY/);
    const configured = merchantEmailAuthConfig({
      EMAIL_AUTH_ENABLED: 'true',
      EMAIL_PROVIDER: 'mailjet',
      MAILJET_API_KEY: 'fixture-api-key',
      MAILJET_SECRET_KEY: 'fixture-secret-key',
      MAILJET_SENDER_EMAIL: 'merchant@example.test',
      MAILJET_SENDER_NAME: 'Kleva',
      FRONTEND_URL: 'http://localhost:3001',
      EMAIL_PAYLOAD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'),
      AUTH_RATE_LIMIT_SECRET: 'fixture-rate-limit-secret-long-enough',
    });
    expect(configured).toMatchObject({
      enabled: true,
      provider: 'mailjet',
      senderEmail: 'merchant@example.test',
      frontendUrl: 'http://localhost:3001',
    });
    expect(configured.encryptionKey).toHaveLength(32);
    expect(() =>
      merchantEmailAuthConfig({
        EMAIL_AUTH_ENABLED: 'true',
        EMAIL_PROVIDER: 'smtp',
        MAILJET_API_KEY: 'fixture-api-key',
        MAILJET_SECRET_KEY: 'fixture-secret-key',
        MAILJET_SENDER_EMAIL: 'merchant@example.test',
        MAILJET_SENDER_NAME: 'Kleva',
        FRONTEND_URL: 'http://localhost:3001',
        EMAIL_PAYLOAD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'),
        AUTH_RATE_LIMIT_SECRET: 'fixture-rate-limit-secret-long-enough',
      }),
    ).toThrow('EMAIL_PROVIDER must be mailjet');
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
    expect(() =>
      whatsappCredentialConfig({
        WHATSAPP_KEY_PROVIDER: 'aws_kms',
      }),
    ).toThrow('WHATSAPP_KMS_KEY_ARN');
    expect(
      whatsappCredentialConfig({
        WHATSAPP_KEY_PROVIDER: 'aws_kms',
        WHATSAPP_KMS_KEY_ARN:
          'arn:aws:kms:eu-west-1:123456789012:key/11111111-1111-4111-8111-111111111111',
        AWS_REGION: 'eu-west-1',
      }),
    ).toMatchObject({ provider: 'aws_kms', region: 'eu-west-1' });
  });

  it('bounds signup attempt lifetime and authorization-code exchange deadlines', () => {
    expect(whatsappSignupRuntimeConfig({})).toEqual({
      attemptTtlSeconds: 900,
      codeExchangeTimeoutMs: 5000,
    });
    expect(
      whatsappSignupRuntimeConfig({
        WHATSAPP_SIGNUP_ATTEMPT_TTL_SECONDS: '600',
        WHATSAPP_CODE_EXCHANGE_TIMEOUT_MS: '7000',
      }),
    ).toEqual({ attemptTtlSeconds: 600, codeExchangeTimeoutMs: 7000 });
    expect(() =>
      whatsappSignupRuntimeConfig({
        WHATSAPP_CODE_EXCHANGE_TIMEOUT_MS: '30000',
      }),
    ).toThrow('WHATSAPP_CODE_EXCHANGE_TIMEOUT_MS');
  });

  it('requires an authenticated Redis connection in production', () => {
    expect(() => redisConfig({ NODE_ENV: 'production' })).toThrow(
      'REDIS_PASSWORD',
    );
    expect(() =>
      redisConfig({ NODE_ENV: 'production', REDIS_PASSWORD: 'replace_me' }),
    ).toThrow('REDIS_PASSWORD');
  });

  it('validates bounded website abuse defaults and exact trusted proxy addresses', () => {
    expect(websiteAbuseConfig({})).toMatchObject({
      rateLimitEnabled: true,
      sessionRateLimitPerMinute: 10,
      messageRateLimitPerMinute: 20,
      sseMaxConnectionsPerSession: 4,
      sseLeaseTtlSeconds: 90,
      sseLeaseRenewSeconds: 30,
    });
    expect(
      websiteAbuseConfig({
        WEBSITE_SESSION_RATE_LIMIT_PER_MINUTE: '15',
        WEBSITE_TRUSTED_PROXY_IPS: '127.0.0.1,::1',
      }).trustedProxyIps,
    ).toEqual(new Set(['127.0.0.1', '::1']));
    expect(() =>
      websiteAbuseConfig({ WEBSITE_SSE_LEASE_TTL_SECONDS: '2' }),
    ).toThrow('WEBSITE_SSE_LEASE_TTL_SECONDS');
    expect(() =>
      websiteAbuseConfig({
        WEBSITE_SSE_LEASE_TTL_SECONDS: '30',
        WEBSITE_SSE_LEASE_RENEW_SECONDS: '30',
      }),
    ).toThrow('WEBSITE_SSE_LEASE_RENEW_SECONDS');
    expect(() =>
      websiteAbuseConfig({ WEBSITE_TRUSTED_PROXY_IPS: '127.0.0.1/8' }),
    ).toThrow('WEBSITE_TRUSTED_PROXY_IPS');
  });
});
