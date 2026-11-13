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
  const apiVersion = env.WHATSAPP_API_VERSION?.trim() || 'v25.0';
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
  const url = env.REDIS_URL?.trim() || undefined;
  if (url) validatedUrl(url, 'REDIS_URL', ['redis:', 'rediss:']);
  return {
    url,
    host: env.REDIS_HOST?.trim() || 'localhost',
    port: port(env, 'REDIS_PORT', 6379),
    password: env.REDIS_PASSWORD || undefined,
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
  return { redis, prefix, concurrency };
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

export function merchantAuthConfig(env = process.env) {
  const keys = [
    'OIDC_ISSUER',
    'OIDC_CLIENT_ID',
    'OIDC_CLIENT_SECRET',
    'OIDC_REDIRECT_URI',
    'MERCHANT_DATABASE_USER',
    'MERCHANT_DATABASE_PASSWORD',
    'IDENTITY_DATABASE_USER',
    'IDENTITY_DATABASE_PASSWORD',
  ] as const;
  if (keys.every((key) => !env[key]?.trim())) return undefined;
  const production = applicationEnvironment(env) === 'production';
  const values = required(env, keys, production);
  const protocols = production ? ['https:'] : ['http:', 'https:'];
  const issuer = validatedUrl(values.OIDC_ISSUER, 'OIDC_ISSUER', protocols);
  const redirect = validatedUrl(
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
  if (
    !merchantRolePattern.test(values.MERCHANT_DATABASE_USER) ||
    values.MERCHANT_DATABASE_USER === env.DATABASE_USER?.trim()
  ) {
    throw new Error(
      'MERCHANT_DATABASE_USER must be a separate kleva_merchant_* login.',
    );
  }
  if (
    !identityRolePattern.test(values.IDENTITY_DATABASE_USER) ||
    values.IDENTITY_DATABASE_USER === env.DATABASE_USER?.trim()
  ) {
    throw new Error(
      'IDENTITY_DATABASE_USER must be a separate kleva_identity_* login.',
    );
  }
  return {
    issuer,
    redirect,
    secureCookies: redirect.protocol === 'https:',
    clientId: values.OIDC_CLIENT_ID,
    clientSecret: values.OIDC_CLIENT_SECRET,
    identityDatabase: databaseConfig({
      ...env,
      DATABASE_USER: values.IDENTITY_DATABASE_USER,
      DATABASE_PASSWORD: env.IDENTITY_DATABASE_PASSWORD,
      DATABASE_LOGGING: 'false',
    }),
    database: databaseConfig({
      ...env,
      DATABASE_USER: values.MERCHANT_DATABASE_USER,
      DATABASE_PASSWORD: env.MERCHANT_DATABASE_PASSWORD,
      DATABASE_LOGGING: 'false',
    }),
  };
}

export function whatsappCredentialConfig(env = process.env) {
  const current = env.WHATSAPP_CREDENTIAL_KEY_ID?.trim() ?? '';
  const raw = env.WHATSAPP_CREDENTIAL_KEYS?.trim();
  const keys = new Map<string, Buffer>();
  if (!current && !raw) return { current, keys };

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
