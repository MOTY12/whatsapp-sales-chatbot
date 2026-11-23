import { X509Certificate } from 'node:crypto';
import { checkServerIdentity, type ConnectionOptions } from 'node:tls';
import type { LogLevel } from '@nestjs/common';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

const logLevels: LogLevel[] = [
  'fatal',
  'error',
  'warn',
  'log',
  'debug',
  'verbose',
];
const graphOrigin = 'https://graph.facebook.com';

export function applicationEnvironment(env = process.env) {
  const value = env.NODE_ENV?.trim() || 'development';
  if (value !== 'development' && value !== 'test' && value !== 'production') {
    throw new Error('NODE_ENV must be development, test or production.');
  }
  return value;
}

function port(env: NodeJS.ProcessEnv, name: string, fallback: number) {
  const value = env[name]?.trim() ?? String(fallback);
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be an integer from 1 to 65535.`);
  }
  return parsed;
}

function flag(env: NodeJS.ProcessEnv, name: string, fallback: boolean) {
  const value = env[name]?.trim();
  if (value === undefined) return fallback;
  if (value === 'true' || value === 'false') return value === 'true';
  throw new Error(`${name} must be true or false.`);
}

function required<const Names extends string>(
  env: NodeJS.ProcessEnv,
  names: readonly Names[],
  production: boolean,
): Record<Names, string> {
  const missing = names.filter((name) => {
    const value = env[name]?.trim();
    return !value || (production && isPlaceholder(value));
  });
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. Set non-placeholder values for this environment.`,
    );
  }
  return Object.fromEntries(
    names.map((name) => [name, env[name]?.trim()]),
  ) as Record<Names, string>;
}

function isPlaceholder(value: string) {
  return /^(replace_me$|your[_-])/i.test(value);
}

function validatedUrl(value: string, name: string, protocols: string[]) {
  try {
    const url = new URL(value);
    if (protocols.includes(url.protocol) && url.hostname) return url;
  } catch {
    // Report the setting name without printing its value.
  }
  throw new Error(
    `${name} must be a valid ${protocols.map((protocol) => protocol.slice(0, -1)).join(' or ')} URL.`,
  );
}

export function databaseConfig(env = process.env): PostgresConnectionOptions {
  const production = applicationEnvironment(env) === 'production';
  const db = required(
    env,
    ['DATABASE_HOST', 'DATABASE_USER', 'DATABASE_PASSWORD', 'DATABASE_NAME'],
    production,
  );
  const tls = flag(env, 'DATABASE_SSL', production);
  const verify = flag(env, 'DATABASE_SSL_REJECT_UNAUTHORIZED', true);
  if (production && !tls) {
    throw new Error('DATABASE_SSL must be enabled in production.');
  }
  if (tls && !verify) {
    throw new Error(
      'DATABASE_SSL_REJECT_UNAUTHORIZED must be true when database TLS is enabled.',
    );
  }
  if (tls && db.DATABASE_HOST.startsWith('/')) {
    throw new Error(
      'DATABASE_HOST must be a hostname or IP address when database TLS is enabled.',
    );
  }

  const ca = env.DATABASE_SSL_CA?.trim().replace(/\\n/g, '\n');
  if (production && !ca) {
    throw new Error(
      'DATABASE_SSL_CA is required in production. Supply the trusted PostgreSQL CA certificate in PEM format.',
    );
  }
  if (tls && ca) {
    const certificates = ca.match(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
    );
    try {
      if (
        !certificates ||
        ca
          .replace(
            /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
            '',
          )
          .trim()
      ) {
        throw new Error();
      }
      for (const certificate of certificates) new X509Certificate(certificate);
    } catch {
      throw new Error('DATABASE_SSL_CA must contain valid PEM certificates.');
    }
  }

  const ssl:
    | Pick<
        ConnectionOptions,
        'ca' | 'rejectUnauthorized' | 'checkServerIdentity'
      >
    | false = tls && {
    ca,
    rejectUnauthorized: true,
    // pg supplies SNI for DNS names only. Verify the configured IP or name in either case.
    checkServerIdentity: (_name, certificate) =>
      checkServerIdentity(db.DATABASE_HOST, certificate),
  };

  return {
    type: 'postgres',
    host: db.DATABASE_HOST,
    port: port(env, 'DATABASE_PORT', 5432),
    username: db.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    database: db.DATABASE_NAME,
    connectTimeoutMS: 5000,
    synchronize: false,
    logging: flag(env, 'DATABASE_LOGGING', false),
    ssl,
  };
}

export function metaConfig(env = process.env) {
  const production = applicationEnvironment(env) === 'production';
  const graph = validatedUrl(
    env.META_GRAPH_BASE_URL?.trim() || graphOrigin,
    'META_GRAPH_BASE_URL',
    production ? ['https:'] : ['http:', 'https:'],
  );
  if (
    graph.username ||
    graph.password ||
    graph.search ||
    graph.hash ||
    graph.pathname !== '/' ||
    (production && graph.origin !== graphOrigin)
  ) {
    throw new Error(
      'META_GRAPH_BASE_URL must be a Graph API origin. Production requires https://graph.facebook.com.',
    );
  }
  const apiVersion = env.WHATSAPP_API_VERSION?.trim() || 'v27.0';
  if (!/^v\d+\.\d+$/.test(apiVersion)) {
    throw new Error('WHATSAPP_API_VERSION must use the vMAJOR.MINOR format.');
  }
  const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  return {
    graphBaseUrl: graph.origin,
    apiVersion,
    appSecret: env.META_APP_SECRET?.trim() || undefined,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || undefined,
    accessToken:
      accessToken && !isPlaceholder(accessToken) ? accessToken : undefined,
    phoneNumberId:
      phoneNumberId && !isPlaceholder(phoneNumberId)
        ? phoneNumberId
        : undefined,
  };
}

export function signupConfig(env = process.env) {
  const production = applicationEnvironment(env) === 'production';
  const values = required(
    env,
    [
      'META_APP_ID',
      'META_APP_SECRET',
      'META_REDIRECT_URI',
      'WHATSAPP_BUSINESS_CONFIG_ID',
      'WHATSAPP_API_VERSION',
    ],
    production,
  );
  const redirect = validatedUrl(
    values.META_REDIRECT_URI,
    'META_REDIRECT_URI',
    production ? ['https:'] : ['http:', 'https:'],
  );
  if (
    redirect.username ||
    redirect.password ||
    redirect.hash ||
    (production && isPlaceholder(redirect.hostname))
  ) {
    throw new Error(
      'META_REDIRECT_URI must be a callback URL without credentials or a fragment.',
    );
  }
  return {
    ...metaConfig(env),
    appId: values.META_APP_ID,
    appSecret: values.META_APP_SECRET,
    redirectUri: values.META_REDIRECT_URI,
    businessConfigId: values.WHATSAPP_BUSINESS_CONFIG_ID,
  };
}

export function logLevelsConfig(env = process.env) {
  const level = env.LOG_LEVEL?.trim() || 'log';
  const levelIndex = logLevels.findIndex((candidate) => candidate === level);
  if (levelIndex < 0) {
    throw new Error(
      'LOG_LEVEL must be fatal, error, warn, log, debug or verbose.',
    );
  }
  return logLevels.slice(0, levelIndex + 1);
}

export function redisConfig(env = process.env) {
  const production = applicationEnvironment(env) === 'production';
  const url = env.REDIS_URL?.trim() || undefined;
  if (url) validatedUrl(url, 'REDIS_URL', ['redis:', 'rediss:']);
  const password = env.REDIS_PASSWORD?.trim() || undefined;
  if (production && (!password || isPlaceholder(password))) {
    throw new Error(
      'REDIS_PASSWORD is required and must not be a placeholder in production.',
    );
  }
  return {
    url,
    host: env.REDIS_HOST?.trim() || 'localhost',
    port: port(env, 'REDIS_PORT', 6379),
    password,
  };
}

export function workerConfig(env = process.env) {
  const environment = applicationEnvironment(env);
  const redis = redisConfig(env);
  const prefix = env.JOBS_QUEUE_PREFIX?.trim() || `kleva-${environment}`;
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(prefix)) {
    throw new Error(
      'JOBS_QUEUE_PREFIX must be 1–64 letters, digits, underscores or hyphens and begin with a letter.',
    );
  }
  const concurrency = port(env, 'JOBS_CONCURRENCY', 4);
  if (concurrency > 32) {
    throw new Error('JOBS_CONCURRENCY must be between 1 and 32.');
  }
  if (environment === 'production' && !redis.url && !env.REDIS_HOST?.trim()) {
    throw new Error('Set REDIS_URL or REDIS_HOST for the production worker.');
  }
  return { redis, prefix, concurrency, ai: aiConfig(env) };
}

export function aiConfig(env = process.env) {
  const enabled = aiResponsesEnabled(env);
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (enabled && (!apiKey || isPlaceholder(apiKey))) {
    throw new Error(
      'OPENAI_API_KEY is required when AI_RESPONSES_ENABLED is true.',
    );
  }
  const model = env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(model)) {
    throw new Error('OPENAI_MODEL has an invalid format.');
  }
  const timeoutMs = usageLimit(env, 'AI_REQUEST_TIMEOUT_MS', 12000);
  if (timeoutMs < 1000 || timeoutMs > 30000) {
    throw new Error('AI_REQUEST_TIMEOUT_MS must be between 1000 and 30000.');
  }
  const handoffMessage =
    env.AI_HANDOFF_MESSAGE?.trim() ||
    "I don't have enough information to confirm that. Let me connect you with someone from the business.";
  if (handoffMessage.length < 16 || handoffMessage.length > 500) {
    throw new Error(
      'AI_HANDOFF_MESSAGE must be between 16 and 500 characters.',
    );
  }
  return {
    enabled,
    apiKey: enabled ? apiKey : undefined,
    // The merchant playground is explicitly separate from live-response
    // activation. This value is consumed only inside the server-side model adapter.
    playgroundApiKey: apiKey && !isPlaceholder(apiKey) ? apiKey : undefined,
    model,
    timeoutMs,
    handoffMessage,
  };
}

/** Read the global AI kill-switch without requiring worker-only provider secrets. */
export function aiResponsesEnabled(env = process.env) {
  return flag(env, 'AI_RESPONSES_ENABLED', false);
}

function usageLimit(env: NodeJS.ProcessEnv, name: string, fallback: number) {
  const value = env[name]?.trim() ?? String(fallback);
  const parsed = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(parsed) ||
    parsed > 2_147_483_647
  ) {
    throw new Error(
      `${name} must be a non-negative integer no greater than 2147483647.`,
    );
  }
  return parsed;
}

export function usageConfig(env = process.env) {
  return {
    monthlyWhatsAppMessages: usageLimit(
      env,
      'USAGE_DEFAULT_MONTHLY_WHATSAPP_MESSAGES',
      1000,
    ),
    monthlyAiInputTokens: usageLimit(
      env,
      'USAGE_DEFAULT_MONTHLY_AI_INPUT_TOKENS',
      100000,
    ),
    monthlyAiOutputTokens: usageLimit(
      env,
      'USAGE_DEFAULT_MONTHLY_AI_OUTPUT_TOKENS',
      50000,
    ),
    aiTokensPerRequest: usageLimit(
      env,
      'USAGE_DEFAULT_AI_TOKENS_PER_REQUEST',
      4096,
    ),
  };
}

export function appConfig(env = process.env) {
  const environment = applicationEnvironment(env);
  const production = environment === 'production';
  const database = databaseConfig(env);
  const meta = signupConfig(env);
  if (production) required(env, ['WHATSAPP_VERIFY_TOKEN'], true);
  return {
    environment,
    port: port(env, 'PORT', 3000),
    database,
    meta,
    logLevels: logLevelsConfig(env),
    redis: redisConfig(env),
    ai: {
      apiKey: env.OPENAI_API_KEY?.trim() || undefined,
      model: env.OPENAI_MODEL?.trim() || undefined,
    },
  };
}

export const merchantRolePattern = /^kleva_merchant_[a-z0-9_]{1,48}$/;
export const identityRolePattern = /^kleva_identity_[a-z0-9_]{1,48}$/;

/** Reports only safe OIDC configuration checks; never returns credential values. */
export function oidcEnvironmentDiagnostics(env = process.env) {
  const clientId = env.OIDC_CLIENT_ID ?? '';
  const clientSecret = env.OIDC_CLIENT_SECRET ?? '';
  const redirectUri = env.OIDC_REDIRECT_URI?.trim() ?? '';
  let expectedRedirect = false;
  try {
    const redirect = new URL(redirectUri);
    expectedRedirect =
      redirect.href === 'http://localhost:3001/auth/callback' &&
      !redirect.username &&
      !redirect.password;
  } catch {
    // Presence and validity are reported below without logging the value.
  }

  return {
    issuerPresent: Boolean(env.OIDC_ISSUER?.trim()),
    clientIdPresent: Boolean(clientId.trim()),
    clientIdTrimmed: clientId === clientId.trim(),
    clientIdLooksLikeGoogleWebClient:
      /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(
        clientId.trim(),
      ),
    clientSecretPresent: Boolean(clientSecret.trim()),
    clientSecretTrimmed: clientSecret === clientSecret.trim(),
    clientSecretPlaceholder: isPlaceholder(clientSecret.trim()),
    redirectUriPresent: Boolean(redirectUri),
    redirectUriMatchesLocalDashboardCallback: expectedRedirect,
  };
}

export function merchantAuthConfig(env = process.env) {
  const oidcKeys = [
    'OIDC_ISSUER',
    'OIDC_CLIENT_ID',
    'OIDC_CLIENT_SECRET',
    'OIDC_REDIRECT_URI',
  ] as const;
  const databaseKeys = [
    'MERCHANT_DATABASE_USER',
    'MERCHANT_DATABASE_PASSWORD',
    'IDENTITY_DATABASE_USER',
    'IDENTITY_DATABASE_PASSWORD',
  ] as const;

  const production = applicationEnvironment(env) === 'production';
  const oidcConfigured = oidcKeys.some((key) => Boolean(env[key]?.trim()));
  const emailEnabled = flag(env, 'EMAIL_AUTH_ENABLED', false);
  if (!oidcConfigured && !emailEnabled) {
    if (production) {
      throw new Error(
        `Missing required environment variables: ${oidcKeys.join(', ')} or set EMAIL_AUTH_ENABLED=true.`,
      );
    }
    return undefined;
  }
  const databaseValues = required(env, databaseKeys, production);
  let issuer: URL | undefined;
  let redirect: URL | undefined;
  let clientId: string | undefined;
  let clientSecret: string | undefined;
  if (oidcConfigured) {
    const values = required(env, oidcKeys, production);
    const protocols = production ? ['https:'] : ['http:', 'https:'];
    issuer = validatedUrl(values.OIDC_ISSUER, 'OIDC_ISSUER', protocols);
    redirect = validatedUrl(
      values.OIDC_REDIRECT_URI,
      'OIDC_REDIRECT_URI',
      protocols,
    );
    for (const url of [issuer, redirect]) {
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol === 'http:' &&
          !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      ) {
        throw new Error(
          'OIDC URLs must use HTTPS or local development HTTP, without credentials, query strings or fragments.',
        );
      }
    }
    if (redirect.pathname !== '/auth/callback') {
      throw new Error(
        'OIDC_REDIRECT_URI must point to /auth/callback on the merchant origin.',
      );
    }
    clientId = values.OIDC_CLIENT_ID;
    clientSecret = values.OIDC_CLIENT_SECRET;
  }
  const configuredDashboardOrigin =
    env.DASHBOARD_PUBLIC_ORIGIN?.trim() || env.MERCHANT_PUBLIC_ORIGIN?.trim();
  const dashboardUrl = configuredDashboardOrigin
    ? validatedUrl(
        configuredDashboardOrigin,
        env.DASHBOARD_PUBLIC_ORIGIN?.trim()
          ? 'DASHBOARD_PUBLIC_ORIGIN'
          : 'MERCHANT_PUBLIC_ORIGIN',
        production ? ['https:'] : ['http:', 'https:'],
      )
    : emailEnabled && !redirect
      ? validatedUrl(
          env.MERCHANT_PUBLIC_ORIGIN?.trim() ?? '',
          'MERCHANT_PUBLIC_ORIGIN',
          production ? ['https:'] : ['http:', 'https:'],
        )
      : redirect;
  if (
    dashboardUrl &&
    (dashboardUrl.username ||
      dashboardUrl.password ||
      dashboardUrl.pathname !== '/' ||
      dashboardUrl.search ||
      dashboardUrl.hash ||
      (dashboardUrl.protocol === 'http:' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(dashboardUrl.hostname)))
  ) {
    throw new Error(
      'DASHBOARD_PUBLIC_ORIGIN must be an origin without credentials, path, query or fragment.',
    );
  }
  const csrfOrigin = dashboardUrl?.origin;
  const csrfOrigins = new Set<string>(csrfOrigin ? [csrfOrigin] : []);
  const allowedOriginsValue = env.DASHBOARD_ALLOWED_ORIGINS?.trim();
  const additionalDashboardOrigins = allowedOriginsValue
    ? allowedOriginsValue.split(',').map((value) => value.trim())
    : [];
  if (additionalDashboardOrigins.some((origin) => !origin)) {
    throw new Error(
      'DASHBOARD_ALLOWED_ORIGINS must be a comma-separated list of exact origins.',
    );
  }
  for (const origin of additionalDashboardOrigins) {
    const parsed = validatedUrl(
      origin,
      'DASHBOARD_ALLOWED_ORIGINS',
      production ? ['https:'] : ['http:', 'https:'],
    );
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      (parsed.protocol === 'http:' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
    ) {
      throw new Error(
        'DASHBOARD_ALLOWED_ORIGINS must contain exact HTTPS origins or local development HTTP origins.',
      );
    }
    csrfOrigins.add(parsed.origin);
  }
  if (
    !merchantRolePattern.test(databaseValues.MERCHANT_DATABASE_USER) ||
    databaseValues.MERCHANT_DATABASE_USER === env.DATABASE_USER?.trim()
  ) {
    throw new Error(
      'MERCHANT_DATABASE_USER must be a separate kleva_merchant_* login.',
    );
  }
  if (
    !identityRolePattern.test(databaseValues.IDENTITY_DATABASE_USER) ||
    databaseValues.IDENTITY_DATABASE_USER === env.DATABASE_USER?.trim()
  ) {
    throw new Error(
      'IDENTITY_DATABASE_USER must be a separate kleva_identity_* login.',
    );
  }
  return {
    issuer,
    redirect,
    secureCookies:
      production ||
      [...csrfOrigins].some((origin) => origin.startsWith('https://')) ||
      redirect?.protocol === 'https:',
    csrfOrigin,
    csrfOrigins: [...csrfOrigins],
    clientId,
    clientSecret,
    identityDatabase: databaseConfig({
      ...env,
      DATABASE_USER: databaseValues.IDENTITY_DATABASE_USER,
      DATABASE_PASSWORD: databaseValues.IDENTITY_DATABASE_PASSWORD,
      DATABASE_LOGGING: 'false',
    }),
    database: databaseConfig({
      ...env,
      DATABASE_USER: databaseValues.MERCHANT_DATABASE_USER,
      DATABASE_PASSWORD: databaseValues.MERCHANT_DATABASE_PASSWORD,
      DATABASE_LOGGING: 'false',
    }),
  };
}

export function merchantEmailAuthConfig(env = process.env) {
  const enabled = flag(env, 'EMAIL_AUTH_ENABLED', false);
  if (!enabled) return { enabled: false as const };

  const production = applicationEnvironment(env) === 'production';
  const values = required(
    env,
    [
      'EMAIL_PROVIDER',
      'MAILJET_API_KEY',
      'MAILJET_SECRET_KEY',
      'MAILJET_SENDER_EMAIL',
      'MAILJET_SENDER_NAME',
      'FRONTEND_URL',
      'EMAIL_PAYLOAD_ENCRYPTION_KEY',
      'AUTH_RATE_LIMIT_SECRET',
    ],
    production,
  );
  if (values.EMAIL_PROVIDER !== 'mailjet')
    throw new Error('EMAIL_PROVIDER must be mailjet.');
  if (
    isPlaceholder(values.MAILJET_API_KEY) ||
    isPlaceholder(values.MAILJET_SECRET_KEY)
  ) {
    throw new Error('Mailjet API credentials must not be placeholders.');
  }
  const sender = values.MAILJET_SENDER_EMAIL.trim();
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(sender)) {
    throw new Error('MAILJET_SENDER_EMAIL must be a valid email address.');
  }
  if (
    !values.MAILJET_SENDER_NAME.trim() ||
    values.MAILJET_SENDER_NAME.length > 120
  ) {
    throw new Error('MAILJET_SENDER_NAME must be 1–120 characters.');
  }
  if (
    values.AUTH_RATE_LIMIT_SECRET.length < 32 ||
    isPlaceholder(values.AUTH_RATE_LIMIT_SECRET)
  ) {
    throw new Error(
      'AUTH_RATE_LIMIT_SECRET must contain at least 32 characters.',
    );
  }
  const origin = validatedUrl(
    values.FRONTEND_URL,
    'FRONTEND_URL',
    production ? ['https:'] : ['http:', 'https:'],
  );
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new Error(
      'FRONTEND_URL must be an origin without credentials, path, query or fragment.',
    );
  }
  const encryptionKey = Buffer.from(
    values.EMAIL_PAYLOAD_ENCRYPTION_KEY,
    'base64url',
  );
  if (
    encryptionKey.length !== 32 ||
    encryptionKey.toString('base64url') !==
      values.EMAIL_PAYLOAD_ENCRYPTION_KEY ||
    isPlaceholder(values.EMAIL_PAYLOAD_ENCRYPTION_KEY)
  )
    throw new Error(
      'EMAIL_PAYLOAD_ENCRYPTION_KEY must be a base64url 32-byte key.',
    );
  return {
    enabled: true as const,
    provider: 'mailjet' as const,
    apiKey: values.MAILJET_API_KEY,
    secretKey: values.MAILJET_SECRET_KEY,
    senderEmail: sender,
    senderName: values.MAILJET_SENDER_NAME.trim(),
    encryptionKey,
    frontendUrl: origin.origin,
    rateLimitSecret: values.AUTH_RATE_LIMIT_SECRET,
  };
}

export function whatsappCredentialConfig(env = process.env) {
  const current = env.WHATSAPP_CREDENTIAL_KEY_ID?.trim() ?? '';
  const raw = env.WHATSAPP_CREDENTIAL_KEYS?.trim();
  const keys = new Map<string, Buffer>();
  if (!current && !raw) {
    if (applicationEnvironment(env) === 'production') {
      throw new Error(
        'WHATSAPP_CREDENTIAL_KEY_ID and WHATSAPP_CREDENTIAL_KEYS are required in production.',
      );
    }
    return { current, keys };
  }

  try {
    const parsed: unknown = JSON.parse(raw ?? '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error();
    for (const [id, value] of Object.entries(parsed)) {
      if (
        !/^[a-zA-Z0-9_-]{1,40}$/.test(id) ||
        typeof value !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(value)
      )
        throw new Error();
      const key = Buffer.from(value, 'base64url');
      if (key.length !== 32 || key.toString('base64url') !== value)
        throw new Error();
      keys.set(id, key);
    }
    if (!keys.has(current)) throw new Error();
    return { current, keys };
  } catch {
    throw new Error(
      'Invalid WHATSAPP_CREDENTIAL_KEY_ID or WHATSAPP_CREDENTIAL_KEYS.',
    );
  }
}
