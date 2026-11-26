import { ChannelConnectionService } from '../../src/channels/channel-connection.service';
import { MerchantAssistantService } from '../../src/Auth/merchant-assistant.service';
import type { GroundedModel } from '../../src/assistant/grounded-model.provider';
import { UnifiedKnowledgeRetrievalService } from '../../src/knowledge/unified-knowledge-retrieval.service';
import { UsageService } from '../../src/metering/usage.service';
import { CredentialCipher } from '../../src/channels/secure-whatsapp/credential-cipher';
import { WhatsAppCloudApiService } from '../../src/whatsapp/whatsapp-cloud-api.service';
import { BusinessRepository } from '../../src/database/repositories/business.repository';
import { startMetaFixture } from './meta-fixture';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Response } from 'supertest';
import type { DataSource } from 'typeorm';
import { MerchantAccess } from '../../src/Auth/merchant-access.service';
import { MerchantDatabase } from '../../src/Auth/merchant-database';
import { merchantAuthConfig } from '../../src/config/env';
import { Account } from '../../src/database/entities/account.entity';
import { Business, Conversation, User } from '../../src/database/entities';
import { BusinessMember } from '../../src/database/entities/business-member.entity';
import {
  grantMerchantAccess,
  merchantPolicyTables,
} from '../../src/database/merchant-access';
import { repositories, seedTenant } from './fixtures';
import { clientId, clientSecret, startIdentityProvider } from './oidc-fixture';
import { applyMigrations, createIntegrationDatabase } from './postgres';
import { databaseMigrations } from '../../src/database/schema';

function cookieHeader(response: Response, name: string) {
  const headers = response.headers['set-cookie'] as unknown as
    string[] | undefined;
  const match = headers?.find((value) => value.startsWith(name + '='));
  if (!match) throw new Error('Expected fixture cookie ' + name);
  return match;
}

function cookiePair(response: Response, name: string) {
  return cookieHeader(response, name).split(';')[0];
}

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
function mailToken(message: string | undefined) {
  const decoded = (message ?? '').replace(/=\r?\n/g, '').replace(/=3D/gi, '=');
  return decoded.match(/token=([A-Za-z0-9_-]{43})/)?.[1];
}
async function waitForMail(
  mailjet: { messages: string[] },
  previousCount: number,
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const message = mailjet.messages[previousCount];
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Expected the local SMTP fixture to capture a message.');
}
async function clearEmailAuthenticationFixtures(admin: DataSource) {
  await admin.query(
    "DELETE FROM public.outbox_operations WHERE operation = 'merchant.email'",
  );
  await admin.query('DELETE FROM public.merchant_email_deliveries');
  await admin.query('DELETE FROM public.merchant_auth_tokens');
  await admin.query('DELETE FROM public.merchant_password_credentials');
  await admin.query('DELETE FROM public.merchant_auth_profiles');
  await admin.query(
    `DELETE FROM public.merchant_auth_identities i USING public.accounts a
     WHERE i.account_id=a.id AND (a.issuer<>i.issuer OR a.subject<>i.subject)`,
  );
}
const redirectUri =
  process.env.OIDC_REDIRECT_URI || 'http://127.0.0.1:3000/auth/callback';
const origin = new URL(redirectUri).origin;

describe('merchant OIDC and tenant isolation', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let idp: Awaited<ReturnType<typeof startIdentityProvider>>;
  let meta: Awaited<ReturnType<typeof startMetaFixture>>;
  let mailjet: { messages: string[] };
  let app: ReturnType<typeof fork>;
  let server: string;
  let merchantDatabase: MerchantDatabase;
  let admin: DataSource;
  let first: Awaited<ReturnType<typeof seedTenant>>;
  let second: Awaited<ReturnType<typeof seedTenant>>;
  let runtimeUsername: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(async () => {
    database = await createIntegrationDatabase();
    admin = await database.migrator();
    await applyMigrations(admin);
    first = await seedTenant(admin, 1);
    second = await seedTenant(admin, 2);
    const credentials = await database.merchantCredentials(admin);
    runtimeUsername = credentials.runtimeUsername;
    await database.grantRuntimeAccess(admin);
    idp = await startIdentityProvider();
    meta = await startMetaFixture();
    mailjet = { messages: [] };
    env = {
      ...process.env,
      NODE_ENV: 'test',
      META_GRAPH_BASE_URL: meta.origin,
      META_APP_ID: '123',
      WHATSAPP_BUSINESS_CONFIG_ID: 'fixture-config',
      WHATSAPP_API_VERSION: 'v25.0',
      WHATSAPP_PHONE_NUMBER_ID: '100',
      META_APP_SECRET: 'fixture-app-secret',
      WHATSAPP_CREDENTIAL_KEY_ID: 'fixture',
      WHATSAPP_CREDENTIAL_KEYS: JSON.stringify({
        fixture: randomBytes(32).toString('base64url'),
      }),
      DATABASE_HOST: credentials.host,
      DATABASE_PORT: String(credentials.port),
      DATABASE_NAME: credentials.database,
      DATABASE_USER: credentials.runtimeUsername,
      DATABASE_PASSWORD: credentials.runtimePassword,
      DATABASE_SSL: 'false',
      DATABASE_SSL_CA: '',
      DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
      MERCHANT_DATABASE_USER: credentials.username,
      MERCHANT_DATABASE_PASSWORD: credentials.password,
      IDENTITY_DATABASE_USER: credentials.identityUsername,
      IDENTITY_DATABASE_PASSWORD: credentials.identityPassword,
      OIDC_ISSUER: idp.issuer,
      OIDC_CLIENT_ID: clientId,
      OIDC_CLIENT_SECRET: clientSecret,
      OIDC_REDIRECT_URI: redirectUri,
      DASHBOARD_PUBLIC_ORIGIN: origin,
      EMAIL_AUTH_ENABLED: 'true',
      EMAIL_PROVIDER: 'mailjet',
      MAILJET_API_KEY: 'fixture-api-key',
      MAILJET_SECRET_KEY: 'fixture-secret-key',
      MAILJET_SENDER_EMAIL: 'no-reply@example.test',
      MAILJET_SENDER_NAME: 'Kleva test',
      FRONTEND_URL: 'http://localhost:3001',
      EMAIL_PAYLOAD_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
      AUTH_RATE_LIMIT_SECRET: randomBytes(32).toString('base64url'),
    };
    // Run Nest under Node's native module loader while keeping the signed
    // provider and disposable database under the suite's control.
    app = fork(join(__dirname, 'auth-app.ts'), {
      env,
      execArgv: ['-r', 'ts-node/register/transpile-only'],
    });
    app.on('message', (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'mailjet_message' &&
        'message' in message &&
        typeof message.message === 'string'
      ) {
        mailjet.messages.push(message.message);
      }
    });
    const [ready] = (await Promise.race([
      once(app, 'message'),
      once(app, 'exit').then(([code]) => {
        throw new Error(
          'Merchant auth fixture exited with code ' + String(code),
        );
      }),
    ])) as [{ type: string; port?: number }];
    if (ready.type !== 'ready' || typeof ready.port !== 'number')
      throw new Error('Expected auth fixture port');
    server = 'http://127.0.0.1:' + String(ready.port);

    merchantDatabase = new MerchantDatabase(merchantAuthConfig(env));
    await merchantDatabase.onModuleInit();
  });

  afterAll(async () => {
    try {
      if (app?.connected) {
        const exited = once(app, 'exit');
        app.disconnect();
        await exited;
      }
      await merchantDatabase?.onApplicationShutdown();
    } finally {
      try {
        await Promise.all([idp?.close(), meta?.close()]);
      } finally {
        await database?.close();
      }
    }
  });

  async function start(intent: 'signup' | 'login' = 'signup') {
    const response = await request(server)
      .get(`/auth/${intent}`)
      .query({ redirect_uri: 'https://untrusted.example.test/callback' })
      .expect(302)
      .expect('Cache-Control', 'no-store');
    const authorization = new URL(String(response.headers.location));
    expect(authorization.searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(authorization.searchParams.get('code_challenge_method')).toBe(
      'S256',
    );
    expect(cookieHeader(response, 'kleva_oidc_binding')).toMatch(
      /HttpOnly; SameSite=Lax/i,
    );
    return {
      authorization,
      binding: cookiePair(response, 'kleva_oidc_binding'),
    };
  }

  async function callbackAttempt(
    subject: string,
    intent: 'signup' | 'login',
    previous?: string,
  ): Promise<Response> {
    const { authorization, binding } = await start(intent);
    const state = authorization.searchParams.get('state');
    const code = idp.authorize(authorization, subject);
    return await request(server)
      .get('/auth/callback')
      .query({ code, state })
      .set('Cookie', previous ? binding + '; ' + previous : binding);
  }

  async function authenticate(
    subject: string,
    intent: 'signup' | 'login' = 'signup',
    previous?: string,
    expectedLocation = '/onboarding',
  ) {
    const response = await callbackAttempt(subject, intent, previous);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(expectedLocation);
    expect(cookieHeader(response, 'kleva_session')).toMatch(
      /HttpOnly; SameSite=Lax/i,
    );
    expect(cookieHeader(response, 'kleva_csrf')).not.toContain('HttpOnly');
    expect(response.text).not.toContain('private-provider');
    const session = cookiePair(response, 'kleva_session');
    const csrf = cookiePair(response, 'kleva_csrf').split('=')[1];
    const [account] = await admin.query<{ id: string }[]>(
      `SELECT a.id FROM public.accounts a
       LEFT JOIN public.merchant_auth_identities i ON i.account_id=a.id
       WHERE (a.issuer=$1 AND a.subject=$2) OR (i.issuer=$1 AND i.subject=$2)
       ORDER BY a.id LIMIT 1`,
      [idp.issuer, subject],
    );
    if (!account) throw new Error('Expected merchant identity fixture.');
    return {
      session,
      csrf,
      accountId: account.id,
      digest: hash(session.split('=')[1]),
    };
  }

  async function login(subject: string, previous?: string) {
    return authenticate(subject, 'signup', previous);
  }

  async function signIn(
    subject: string,
    previous?: string,
    expectedLocation = '/onboarding',
  ) {
    return authenticate(subject, 'login', previous, expectedLocation);
  }

  it('rejects unsafe configuration and anonymous merchant requests', async () => {
    expect(() =>
      merchantAuthConfig({ ...env, OIDC_REDIRECT_URI: origin + '/other' }),
    ).toThrow('OIDC_REDIRECT_URI');
    expect(() =>
      merchantAuthConfig({
        ...env,
        OIDC_REDIRECT_URI: 'http://example.test/auth/callback',
      }),
    ).toThrow('local development HTTP');
    expect(() =>
      merchantAuthConfig({ ...env, NODE_ENV: 'production' }),
    ).toThrow('OIDC_ISSUER');
    expect(() =>
      merchantAuthConfig({ ...env, MERCHANT_DATABASE_USER: 'postgres' }),
    ).toThrow('separate');
    await request(server).get('/auth/me').expect(401);
    await request(server).get('/auth/businesses').expect(401);
  });

  it('separates signup from sign-in and rejects duplicate registrations', async () => {
    const missingSubject = 'not-registered-before-login';
    const signInResponse = await callbackAttempt(missingSubject, 'login');
    expect(signInResponse.status).toBe(401);
    expect(signInResponse.body).toMatchObject({
      code: 'merchant_account_not_found',
      message: 'No merchant account found. Please create an account.',
    });
    await expect(
      admin.getRepository(Account).countBy({ subject: missingSubject }),
    ).resolves.toBe(0);

    const subject = 'explicit-signup-then-login';
    const created = await login(subject);
    const duplicate = await callbackAttempt(subject, 'signup');
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({
      code: 'merchant_account_exists',
      message: 'An account already exists. Please sign in.',
    });
    await expect(
      admin.getRepository(Account).countBy({ subject }),
    ).resolves.toBe(1);
    const returning = await signIn(subject);
    expect(returning.accountId).toBe(created.accountId);
  });

  it('registers verified Argon2id email identities and rotates all sessions after password reset', async () => {
    const email = 'Merchant.Email@example.test';
    const password = 'correct horse battery staple - kleva';
    const registrationMailIndex = mailjet.messages.length;
    await request(server)
      .post('/auth/register')
      .send({ fullName: 'Merchant Owner', email, password })
      .expect(202)
      .expect(({ body }: Response) =>
        expect((body as { message: string }).message).toBe(
          'If registration can proceed, we sent an email with the next step.',
        ),
      );
    const registrationMail = await waitForMail(mailjet, registrationMailIndex);
    const verificationToken = mailToken(registrationMail);
    expect(verificationToken).toBeDefined();

    await request(server)
      .post('/auth/register')
      .send({
        fullName: 'Duplicate Owner',
        email: email.toLowerCase(),
        password,
      })
      .expect(202);
    await request(server)
      .post('/auth/register')
      .send({ fullName: 'Invalid Owner', email: 'not-an-email', password })
      .expect(400);
    await request(server)
      .post('/auth/register')
      .send({
        fullName: 'Weak Owner',
        email: 'weak@example.test',
        password: 'password123456',
      })
      .expect(400);
    await request(server)
      .post('/auth/login/password')
      .send({ email, password })
      .expect(403)
      .expect(({ body }: Response) =>
        expect((body as { message: string }).message).toContain(
          'Verify your email address',
        ),
      );

    const verified = await request(server)
      .post('/auth/verify-email')
      .send({ token: verificationToken })
      .expect(200);
    expect((verified.body as { verified: boolean }).verified).toBe(true);
    await request(server)
      .post('/auth/verify-email')
      .send({ token: verificationToken })
      .expect(200)
      .expect(({ body }: Response) =>
        expect((body as { verified: boolean }).verified).toBe(false),
      );

    const expiredEmail = 'expired-verification@example.test';
    const expiredVerificationIndex = mailjet.messages.length;
    await request(server)
      .post('/auth/register')
      .send({ fullName: 'Expired Owner', email: expiredEmail, password })
      .expect(202);
    const expiredVerification = mailToken(
      await waitForMail(mailjet, expiredVerificationIndex),
    );
    expect(expiredVerification).toBeDefined();
    await admin.query(
      "UPDATE public.merchant_auth_tokens SET expires_at=now()-interval '1 second' WHERE token_digest=$1",
      [hash(expiredVerification!)],
    );
    await request(server)
      .post('/auth/verify-email')
      .send({ token: expiredVerification })
      .expect(200)
      .expect(({ body }: Response) =>
        expect((body as { verified: boolean }).verified).toBe(false),
      );
    await request(server)
      .post('/auth/login/password')
      .send({ email: expiredEmail, password })
      .expect(403);

    await request(server)
      .post('/auth/login/password')
      .send({ email: email.toLowerCase(), password: 'incorrect password' })
      .expect(401)
      .expect(({ body }: Response) =>
        expect((body as { message: string }).message).toBe(
          'Invalid email or password.',
        ),
      );
    const signedIn = await request(server)
      .post('/auth/login/password')
      .send({ email, password })
      .expect(200);
    expect((signedIn.body as { nextPath: string }).nextPath).toBe(
      '/onboarding',
    );
    const session = cookiePair(signedIn, 'kleva_session');
    expect(cookieHeader(signedIn, 'kleva_session')).toMatch(/HttpOnly/i);
    await request(server).get('/auth/me').set('Cookie', session).expect(200);

    const failedEnqueueMailCount = mailjet.messages.length;
    await admin.query(
      `REVOKE INSERT ON public.merchant_email_deliveries FROM "${runtimeUsername}"`,
    );
    try {
      await request(server)
        .post('/auth/forgot-password')
        .send({ email })
        .expect(200)
        .expect(({ body }: Response) =>
          expect((body as { message: string }).message).toBe(
            'If an account can reset its password, an email has been sent.',
          ),
        );
      expect(mailjet.messages).toHaveLength(failedEnqueueMailCount);
    } finally {
      await admin.query(
        `GRANT INSERT ON public.merchant_email_deliveries TO "${runtimeUsername}"`,
      );
    }

    const expiredResetMailIndex = mailjet.messages.length;
    await request(server)
      .post('/auth/forgot-password')
      .send({ email })
      .expect(200);
    const expiredResetMail = await waitForMail(mailjet, expiredResetMailIndex);
    const resetToken = mailToken(expiredResetMail);
    expect(resetToken).toBeDefined();
    await admin.query(
      "UPDATE public.merchant_auth_tokens SET expires_at=now()-interval '1 second' WHERE token_digest=$1",
      [hash(resetToken!)],
    );
    await request(server)
      .post('/auth/reset-password')
      .send({ token: resetToken, password: 'new password after expiry 2026' })
      .expect(400);

    const liveResetMailIndex = mailjet.messages.length;
    await request(server)
      .post('/auth/forgot-password')
      .send({ email })
      .expect(200);
    const liveResetMail = await waitForMail(mailjet, liveResetMailIndex);
    const liveResetToken = mailToken(liveResetMail);
    expect(liveResetToken).toBeDefined();
    let submittedResetEmail:
      | {
          email_status: string;
          operation_status: string;
          provider_message_id: string;
        }
      | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      [submittedResetEmail] = await admin.query<
        {
          email_status: string;
          operation_status: string;
          provider_message_id: string;
        }[]
      >(
        `SELECT delivery.status AS email_status, operation.status AS operation_status,
          delivery.provider_message_id
         FROM public.outbox_operations operation
         JOIN public.merchant_email_deliveries delivery
           ON delivery.id = (operation.metadata->>'deliveryId')::uuid
         WHERE operation.operation = 'merchant.email'
         ORDER BY operation."createdAt" DESC LIMIT 1`,
      );
      if (
        submittedResetEmail?.email_status === 'ACCEPTED' &&
        submittedResetEmail.operation_status === 'COMPLETED'
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(submittedResetEmail).toMatchObject({
      email_status: 'ACCEPTED',
      operation_status: 'COMPLETED',
      provider_message_id: '123',
    });
    const nextPassword = 'new password after reset 2026';
    const confirmationMailIndex = mailjet.messages.length;
    await request(server)
      .post('/auth/reset-password')
      .send({ token: liveResetToken, password: nextPassword })
      .expect(200);
    const confirmationMail = await waitForMail(mailjet, confirmationMailIndex);
    expect(confirmationMail).toContain('Your Kleva password was changed');
    await request(server)
      .post('/auth/reset-password')
      .send({ token: liveResetToken, password: nextPassword })
      .expect(400);
    await request(server).get('/auth/me').set('Cookie', session).expect(401);
    await request(server)
      .post('/auth/login/password')
      .send({ email, password })
      .expect(401);
    const newLogin = await request(server)
      .post('/auth/login/password')
      .send({ email, password: nextPassword })
      .expect(200);
    expect(cookieHeader(newLogin, 'kleva_session')).toMatch(/HttpOnly/i);
    const newCsrf = cookiePair(newLogin, 'kleva_csrf').split('=')[1];
    expect(newCsrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await request(server)
      .post('/auth/password')
      .set('Cookie', cookiePair(newLogin, 'kleva_session'))
      .send({ password: 'updated password with CSRF validation' })
      .expect(403);
    await request(server)
      .post('/auth/password')
      .set('Cookie', cookiePair(newLogin, 'kleva_session'))
      .set('Origin', origin)
      .set('X-CSRF-Token', newCsrf)
      .send({ password: 'updated password with CSRF validation' })
      .expect(200);
    const [profile] = await admin.query<
      { email: string; full_name: string; verified: boolean; hash: string }[]
    >(
      `SELECT p.email,p.full_name,p.email_verified_at IS NOT NULL AS verified,
        c.password_hash AS hash FROM public.merchant_auth_profiles p
       JOIN public.merchant_password_credentials c USING(account_id)
       WHERE p.email=$1`,
      [email.toLowerCase()],
    );
    expect(profile).toMatchObject({
      email: email.toLowerCase(),
      full_name: 'Merchant Owner',
      verified: true,
    });
    expect(profile.hash).not.toContain(password);
    expect(profile.hash).toMatch(/^\$argon2id\$/);
  });

  it('links Google to an authenticated password identity without email-based account merging', async () => {
    const email = 'linked@example.test';
    const password = 'linking merchant identity with a long passphrase';
    const verificationIndex = mailjet.messages.length;
    await request(server)
      .post('/auth/register')
      .send({ fullName: 'Linked Owner', email, password })
      .expect(202);
    const verification = mailToken(
      await waitForMail(mailjet, verificationIndex),
    );
    await request(server)
      .post('/auth/verify-email')
      .send({ token: verification })
      .expect(200);
    const passwordLogin = await request(server)
      .post('/auth/login/password')
      .send({ email, password })
      .expect(200);
    const passwordSession = cookiePair(passwordLogin, 'kleva_session');
    const googleStart = await request(server)
      .get('/auth/google/link')
      .set('Cookie', passwordSession)
      .expect(302);
    const authorization = new URL(String(googleStart.headers.location));
    const binding = cookiePair(googleStart, 'kleva_oidc_binding');
    const state = authorization.searchParams.get('state');
    const code = idp.authorize(authorization, 'linked-google-identity');
    const linked = await request(server)
      .get('/auth/callback')
      .set('Cookie', `${binding}; ${passwordSession}`)
      .query({ code, state })
      .expect(302);
    const linkedSession = cookiePair(linked, 'kleva_session');
    const identity = await request(server)
      .get('/auth/me')
      .set('Cookie', linkedSession)
      .expect(200);
    const accountId = (identity.body as { accountId: string }).accountId;
    const googleLogin = await signIn('linked-google-identity');
    expect(googleLogin.accountId).toBe(accountId);

    const manualEmail = 'manual-match@example.test';
    const manualAccountId = randomUUID();
    await admin.query(
      `INSERT INTO public.accounts(id,issuer,subject)
       VALUES($1::uuid,'urn:kleva:password',$2)`,
      [manualAccountId, manualAccountId],
    );
    await admin.query(
      `INSERT INTO public.merchant_auth_profiles
       (account_id,email,full_name,email_verified_at)
       VALUES($1,$2,'Manual Match Owner',now())`,
      [manualAccountId, manualEmail],
    );
    const sameEmailGoogleSignup = await callbackAttempt(
      'manual-match',
      'signup',
    );
    expect(sameEmailGoogleSignup.status).toBe(409);
    const [identities] = await admin.query<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM public.merchant_auth_identities
       WHERE issuer=$1 AND subject='manual-match'`,
      [idp.issuer],
    );
    expect(identities.count).toBe('0');
  });

  it('persists onboarding navigation across sessions without marking optional integrations ready', async () => {
    const merchant = await login('resume-onboarding-session');
    const initial = await request(server)
      .get('/auth/onboarding')
      .set('Cookie', merchant.session)
      .expect(200);
    expect(initial.body).toMatchObject({
      current_step: 'business_profile',
      completed_steps: ['account'],
    });
    await request(server)
      .post('/auth/onboarding')
      .set('Cookie', merchant.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', merchant.csrf)
      .send({ currentStep: 'ai_assistant' })
      .expect(201)
      .then(({ body }) =>
        expect(body).toMatchObject({ current_step: 'ai_assistant' }),
      );
    const returning = await signIn('resume-onboarding-session');
    const resumed = await request(server)
      .get('/auth/onboarding')
      .set('Cookie', returning.session)
      .expect(200);
    const resumedBody = resumed.body as {
      current_step: string;
      completed_steps: string[];
    };
    expect(resumedBody.current_step).toBe('ai_assistant');
    expect(resumedBody.completed_steps).toEqual(['account']);
  });

  it('fails closed when the identity role cannot create a session', async () => {
    const { authorization, binding } = await start();
    const subject = 'session-permission-fixture';
    const code = idp.authorize(authorization, subject);
    const state = authorization.searchParams.get('state');
    const identityRole = env.IDENTITY_DATABASE_USER!;
    const quotedIdentityRole = `"${identityRole.replaceAll('"', '""')}"`;

    await admin.query(
      `REVOKE EXECUTE ON FUNCTION public.kleva_complete_oidc_auth_v2(text,text,text,text,boolean,text,text,text,text,uuid,text) FROM ${quotedIdentityRole}`,
    );
    try {
      await request(server)
        .get('/auth/callback')
        .set('Cookie', binding)
        .query({ code, state })
        .expect(503);
      await expect(
        admin.getRepository(Account).countBy({ subject }),
      ).resolves.toBe(0);
    } finally {
      await admin.query(
        `GRANT EXECUTE ON FUNCTION public.kleva_complete_oidc_auth_v2(text,text,text,text,boolean,text,text,text,text,uuid,text) TO ${quotedIdentityRole}`,
      );
    }
  });

  it.each(['invalid_client', 'token_endpoint'] as const)(
    'rejects OIDC token endpoint failure %s without creating an account',
    async (fault) => {
      const { authorization, binding } = await start();
      const subject = 'token-failure-' + fault;
      const code = idp.authorize(authorization, subject, fault);
      await request(server)
        .get('/auth/callback')
        .set('Cookie', binding)
        .query({ code, state: authorization.searchParams.get('state') })
        .expect(401);
      await expect(
        admin.getRepository(Account).countBy({ subject }),
      ).resolves.toBe(0);
    },
  );

  it('binds login state to the browser and consumes a callback once', async () => {
    const { authorization, binding } = await start();
    const state = authorization.searchParams.get('state');
    const code = idp.authorize(authorization, 'state-fixture');
    await request(server)
      .get('/auth/callback')
      .set('Cookie', binding)
      .query({ code, state: 'invalid' })
      .expect(400);
    await request(server)
      .get('/auth/callback')
      .query({ code, state })
      .expect(400);
    const concurrent = await Promise.all(
      [1, 2].map(() =>
        request(server)
          .get('/auth/callback')
          .set('Cookie', binding)
          .query({ code, state }),
      ),
    );
    expect(concurrent.map(({ status }) => status).sort()).toEqual([302, 400]);
  });

  it('rejects an expired registration state without creating an identity', async () => {
    const { authorization, binding } = await start('signup');
    const subject = 'expired-registration-state';
    const state = authorization.searchParams.get('state');
    const code = idp.authorize(authorization, subject);
    await admin.query(
      "UPDATE merchant_login_attempts SET expires_at = now() - interval '1 second' WHERE state_digest = $1",
      [hash(state ?? '')],
    );
    await request(server)
      .get('/auth/callback')
      .set('Cookie', binding)
      .query({ code, state })
      .expect(400);
    await expect(
      admin.getRepository(Account).countBy({ subject }),
    ).resolves.toBe(0);
  });

  it('rejects malformed authorization responses before token exchange', async () => {
    const { authorization, binding } = await start();
    const subject = 'malformed-authorization-response';
    await request(server)
      .get('/auth/callback')
      .set('Cookie', binding)
      .query({ state: authorization.searchParams.get('state') })
      .expect(401);
    await expect(
      admin.getRepository(Account).countBy({ subject }),
    ).resolves.toBe(0);
  });

  it.each([
    'nonce',
    'issuer',
    'audience',
    'expiry',
    'pkce',
    'signature',
  ] as const)('rejects a bad %s without creating an account', async (fault) => {
    const { authorization, binding } = await start();
    const subject = 'bad-' + fault;
    const code = idp.authorize(authorization, subject, fault);
    await request(server)
      .get('/auth/callback')
      .set('Cookie', binding)
      .query({ code, state: authorization.searchParams.get('state') })
      .expect(401);
    await expect(
      admin.getRepository(Account).countBy({ subject }),
    ).resolves.toBe(0);
  });

  it('stores only token digests, rotates sessions, enforces CSRF and expires sessions', async () => {
    const old = await login('session-fixture');
    const rows = await admin.query<
      { token_digest: string; csrf_digest: string }[]
    >(
      'SELECT token_digest, csrf_digest FROM merchant_sessions WHERE account_id = $1',
      [old.accountId],
    );
    expect(rows).toEqual([
      { token_digest: old.digest, csrf_digest: hash(old.csrf) },
    ]);
    await request(server)
      .get('/auth/me')
      .set('Cookie', old.session)
      .expect(200, { accountId: old.accountId, memberships: [] });
    await expect(
      admin.getRepository(BusinessMember).countBy({ accountId: old.accountId }),
    ).resolves.toBe(0);

    const rotated = await signIn('session-fixture', old.session);
    expect(rotated.session).not.toEqual(old.session);
    expect(rotated.accountId).toBe(old.accountId);
    await request(server)
      .get('/auth/me')
      .set('Cookie', old.session)
      .expect(401);
    await request(server)
      .post('/auth/logout')
      .set('Cookie', rotated.session)
      .set('Origin', 'http://other.example.test')
      .set('X-CSRF-Token', rotated.csrf)
      .expect(403);
    await request(server)
      .post('/auth/logout')
      .set('Cookie', rotated.session)
      .set('Origin', origin)
      .expect(403);
    await request(server)
      .post('/auth/logout')
      .set('Cookie', rotated.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', old.csrf)
      .expect(403);
    await request(server)
      .post('/auth/logout')
      .set('Cookie', rotated.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', rotated.csrf)
      .expect(204);
    await request(server)
      .get('/auth/me')
      .set('Cookie', rotated.session)
      .expect(401);

    const expired = await login('expiry-fixture');
    await admin.query(
      "UPDATE merchant_sessions SET expires_at = now() - interval '1 second' WHERE token_digest = $1",
      [expired.digest],
    );
    await request(server)
      .get('/auth/me')
      .set('Cookie', expired.session)
      .expect(401);
  });

  it('switches authorized businesses and rechecks role and membership', async () => {
    const owner = await login('multibusiness-fixture');
    const staff = await login('staff-fixture');
    const members = admin.getRepository(BusinessMember);
    await members.insert([
      {
        businessId: first.business.id,
        accountId: owner.accountId,
        role: 'owner',
      },
      {
        businessId: second.business.id,
        accountId: owner.accountId,
        role: 'agent',
      },
      {
        businessId: first.business.id,
        accountId: staff.accountId,
        role: 'staff',
      },
    ]);
    const list = await request(server)
      .get('/auth/businesses')
      .set('Cookie', owner.session)
      .expect(200);
    expect(list.body).toEqual(
      expect.arrayContaining([
        { businessId: first.business.id, role: 'owner' },
        { businessId: second.business.id, role: 'agent' },
      ]),
    );
    await Promise.all([
      request(server)
        .get('/auth/businesses/' + first.business.id)
        .set('Cookie', owner.session)
        .expect(200, {
          id: first.business.id,
          name: first.business.name,
          status: 'active',
          role: 'owner',
          industry: first.business.industry,
          phone: first.business.phone,
          timezone: first.business.timezone,
          description: null,
          openingHours: null,
        }),
      request(server)
        .get('/auth/businesses/' + second.business.id)
        .set('Cookie', owner.session)
        .expect(200, {
          id: second.business.id,
          name: second.business.name,
          status: 'active',
          role: 'agent',
          industry: second.business.industry,
          phone: second.business.phone,
          timezone: second.business.timezone,
          description: null,
          openingHours: null,
        }),
    ]);
    await request(server)
      .get('/auth/businesses/' + first.business.id)
      .set('Cookie', staff.session)
      .expect(403);
    await request(server)
      .get('/auth/businesses/' + second.business.id)
      .set('Cookie', staff.session)
      .expect(404);
    await request(server)
      .get('/auth/businesses/' + randomUUID())
      .set('Cookie', owner.session)
      .expect(404);

    const access = new MerchantAccess(merchantDatabase);
    const principal = {
      accountId: owner.accountId,
      sessionDigest: owner.digest,
    };
    await expect(
      access.withBusiness(principal, first.business.id, 'team.manage', () =>
        Promise.resolve('owner'),
      ),
    ).resolves.toBe('owner');
    await expect(
      access.withBusiness(principal, second.business.id, 'team.manage', () =>
        Promise.resolve('agent'),
      ),
    ).rejects.toThrow('Forbidden');
    await members.update(
      { accountId: owner.accountId, businessId: first.business.id },
      { role: 'staff' },
    );
    await request(server)
      .get('/auth/businesses/' + first.business.id)
      .set('Cookie', owner.session)
      .expect(403);
    await members.update(
      { accountId: owner.accountId, businessId: second.business.id },
      { status: 'inactive' },
    );
    await request(server)
      .get('/auth/businesses/' + second.business.id)
      .set('Cookie', owner.session)
      .expect(404);
  });

  it('invites verified staff once and immediately enforces versioned team changes', async () => {
    const owner = await login('team-invitation-owner');
    const recipient = await login('team-invitation-recipient');
    const agent = await login('team-invitation-agent');
    const members = admin.getRepository(BusinessMember);
    await members.insert([
      {
        businessId: first.business.id,
        accountId: owner.accountId,
        role: 'owner',
      },
      {
        businessId: first.business.id,
        accountId: agent.accountId,
        role: 'agent',
      },
      {
        businessId: second.business.id,
        accountId: agent.accountId,
        role: 'owner',
      },
    ]);
    const base = `/merchant/businesses/${first.business.id}/team`;
    await request(server).get(base).set('Cookie', agent.session).expect(403);
    await request(server)
      .post(`${base}/invitations`)
      .set('Cookie', agent.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', agent.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({ email: 'should-not-invite@example.test', role: 'agent' })
      .expect(403);
    const inviteMail = mailjet.messages.length;
    const invitation = await request(server)
      .post(`${base}/invitations`)
      .set('Cookie', owner.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', owner.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({ email: 'team-invitation-recipient@example.test', role: 'agent' })
      .expect(201)
      .expect('Cache-Control', 'no-store');
    expect(invitation.body).toMatchObject({
      email: 'team-invitation-recipient@example.test',
      role: 'agent',
      deliveryStatus: 'QUEUED',
    });
    const message = await waitForMail(mailjet, inviteMail);
    const credential = mailToken(message);
    expect(credential).toBeDefined();
    expect(message).toContain(first.business.name);
    expect(message).toContain('agent');

    await request(server)
      .post('/merchant/invitations/accept')
      .set('Cookie', recipient.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', recipient.csrf)
      .send({ token: credential })
      .expect(201)
      .expect(({ body }: Response) => {
        expect(body).toMatchObject({
          businessId: first.business.id,
          businessName: first.business.name,
          role: 'agent',
          accepted: true,
        });
      });
    await request(server)
      .post('/merchant/invitations/accept')
      .set('Cookie', recipient.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', recipient.csrf)
      .send({ token: credential })
      .expect(201, {
        businessId: first.business.id,
        businessName: first.business.name,
        role: 'agent',
        accepted: false,
      });

    const team = await request(server)
      .get(base)
      .set('Cookie', owner.session)
      .expect(200);
    const memberSearch = await request(server)
      .get(`${base}?search=team-invitation-recipient@example.test`)
      .set('Cookie', owner.session)
      .expect(200);
    const memberSearchItems = (
      memberSearch.body as {
        items: Array<{ accountId: string; email: string }>;
      }
    ).items;
    expect(memberSearchItems).toHaveLength(1);
    expect(memberSearchItems[0]).toMatchObject({
      accountId: recipient.accountId,
      email: 'team-invitation-recipient@example.test',
    });
    const teamItems = (
      team.body as { items: Array<{ accountId: string; id: string }> }
    ).items;
    const invited = teamItems.find(
      (item) => item.accountId === recipient.accountId,
    );
    if (!invited) throw new Error('Expected the invited membership record.');
    expect(invited).toMatchObject({
      role: 'agent',
      status: 'active',
      version: 1,
    });
    await request(server)
      .patch(`${base}/${invited.id}`)
      .set('Cookie', owner.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', owner.csrf)
      .send({ role: 'editor', version: 1 })
      .expect(200, { changed: true, version: 2 });
    await request(server)
      .post(`${base}/${invited.id}/revoke`)
      .set('Cookie', owner.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', owner.csrf)
      .send({ version: 2 })
      .expect(201, { revoked: true, version: 3 });
    await request(server)
      .get(`/merchant/businesses/${first.business.id}`)
      .set('Cookie', recipient.session)
      .expect(404);
    const stillOwnsOtherBusiness = await request(server)
      .get('/auth/businesses')
      .set('Cookie', agent.session)
      .expect(200);
    expect(stillOwnsOtherBusiness.body as unknown[]).toEqual(
      expect.arrayContaining([
        { businessId: first.business.id, role: 'agent' },
        { businessId: second.business.id, role: 'owner' },
      ]),
    );
    const ownerOnlyBusiness = await admin.getRepository(Business).save({
      name: 'Last Owner Guard Fixture',
      phone: randomUUID(),
      whatsappNumber: randomUUID(),
      timezone: 'Africa/Lagos',
    });
    const ownerMembership = await members.save({
      businessId: ownerOnlyBusiness.id,
      accountId: owner.accountId,
      role: 'owner',
      status: 'active',
    });
    const ownerOnlyBase = `/merchant/businesses/${ownerOnlyBusiness.id}/team`;
    await request(server)
      .patch(`${ownerOnlyBase}/${ownerMembership.id}`)
      .set('Cookie', owner.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', owner.csrf)
      .send({ role: 'agent', version: 1 })
      .expect(409);
    await request(server)
      .post(`${ownerOnlyBase}/${ownerMembership.id}/revoke`)
      .set('Cookie', owner.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', owner.csrf)
      .send({ version: 1 })
      .expect(409);

    // Keep this shared disposable fixture free of team data so later migration
    // rollback guards exercise the migration under test, not TENANT-003 data.
    await admin.query('DELETE FROM public.merchant_team_audit');
    await admin.query('DELETE FROM public.merchant_business_invitations');
    await admin.query('DELETE FROM public.merchant_team_invitation_attempts');
    await members.delete({
      businessId: first.business.id,
      accountId: recipient.accountId,
    });
    await admin.getRepository(Business).delete(ownerOnlyBusiness.id);
  });

  it('serves tenant-scoped inbox pages and serializes idempotent takeover changes', async () => {
    const owner = await login('inbox-owner');
    const staff = await login('inbox-staff');
    const agent = await login('inbox-agent');
    const otherOwner = await login('inbox-other-owner');
    const members = admin.getRepository(BusinessMember);
    await members.insert([
      {
        businessId: first.business.id,
        accountId: owner.accountId,
        role: 'owner',
      },
      {
        businessId: first.business.id,
        accountId: staff.accountId,
        role: 'staff',
      },
      {
        businessId: first.business.id,
        accountId: agent.accountId,
        role: 'agent',
      },
      {
        businessId: second.business.id,
        accountId: otherOwner.accountId,
        role: 'owner',
      },
    ]);
    const base = `/merchant/businesses/${first.business.id}/conversations`;
    const listing = await request(server)
      .get(base)
      .query({ limit: 1 })
      .set('Cookie', owner.session)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    const listingBody = listing.body as {
      items: {
        id: string;
        customer_name: string;
        customer_whatsapp_id: string;
        control_mode: string;
        unread_count: string | number;
      }[];
    };
    expect(listingBody.items).toHaveLength(1);
    expect(listingBody.items[0]).toMatchObject({
      id: first.conversation.id,
      customer_name: first.customer.name,
      customer_whatsapp_id: first.customer.whatsappId,
      control_mode: 'AUTO',
    });
    expect(Number(listingBody.items[0].unread_count)).toBeGreaterThan(0);
    const filteredOpen = await request(server)
      .get(base)
      .query({ status: 'open', search: first.customer.whatsappId })
      .set('Cookie', owner.session)
      .expect(200);
    const filteredOpenBody = filteredOpen.body as { items: { id: string }[] };
    expect(filteredOpenBody.items.map((item) => item.id)).toContain(
      first.conversation.id,
    );
    const filteredClosed = await request(server)
      .get(base)
      .query({ status: 'closed', search: first.customer.whatsappId })
      .set('Cookie', owner.session)
      .expect(200);
    expect((filteredClosed.body as { items: unknown[] }).items).toHaveLength(0);
    const teammateList = await request(server)
      .get(`${base}/members`)
      .set('Cookie', owner.session)
      .expect(200);
    expect(teammateList.body).toContainEqual({
      account_id: agent.accountId,
      role: 'agent',
    });
    const assignee = await request(server)
      .post(`${base}/${first.conversation.id}/assignee`)
      .set('Cookie', owner.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', owner.csrf)
      .send({ accountId: agent.accountId })
      .expect(201);
    expect(assignee.body).toMatchObject({
      assigned_to_account_id: agent.accountId,
      changed: true,
    });
    await request(server)
      .post(`${base}/${first.conversation.id}/assignee`)
      .set('Cookie', owner.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', owner.csrf)
      .send({ accountId: otherOwner.accountId })
      .expect(400);
    const unread = await request(server)
      .post(`${base}/${first.conversation.id}/read`)
      .set('Cookie', owner.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', owner.csrf)
      .send({})
      .expect(201);
    expect((unread.body as { last_read_at: string }).last_read_at).toBeTruthy();
    const readListing = await request(server)
      .get(base)
      .query({ search: first.customer.whatsappId })
      .set('Cookie', owner.session)
      .expect(200);
    const readListingBody = readListing.body as {
      items: { unread_count: string | number }[];
    };
    expect(Number(readListingBody.items[0].unread_count)).toBe(0);
    const agentListing = await request(server)
      .get(base)
      .query({ search: first.customer.whatsappId })
      .set('Cookie', agent.session)
      .expect(200);
    expect(
      Number(
        (agentListing.body as { items: { unread_count: string | number }[] })
          .items[0].unread_count,
      ),
    ).toBeGreaterThan(0);
    const createdNote = await request(server)
      .post(`${base}/${first.conversation.id}/notes`)
      .set('Cookie', owner.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', owner.csrf)
      .send({ text: 'Call after 3 PM.' })
      .expect(201);
    expect(createdNote.body).toMatchObject({
      body: 'Call after 3 PM.',
      actor_account_id: owner.accountId,
    });
    const listedNotes = await request(server)
      .get(`${base}/${first.conversation.id}/notes`)
      .set('Cookie', owner.session)
      .expect(200);
    expect(listedNotes.body).toContainEqual(
      expect.objectContaining({
        id: (createdNote.body as { id: string }).id,
      }),
    );
    await request(server)
      .get(`${base}/${second.conversation.id}/notes`)
      .set('Cookie', owner.session)
      .expect(404);
    await request(server)
      .get(`${base}/${second.conversation.id}`)
      .set('Cookie', owner.session)
      .expect(404);
    await request(server).get(base).set('Cookie', staff.session).expect(403);
    const history = await request(server)
      .get(`${base}/${first.conversation.id}/messages`)
      .query({ limit: 1 })
      .set('Cookie', owner.session)
      .expect(200);
    const historyBody = history.body as {
      items: { id: string; direction: string; content: string }[];
    };
    expect(historyBody.items).toMatchObject([
      { id: first.message.id, direction: 'inbound', content: 'Tenant 1 text' },
    ]);

    const takeover = () =>
      request(server)
        .post(`${base}/${first.conversation.id}/takeover`)
        .set('Cookie', owner.session)
        .set('Origin', origin)
        .set('X-CSRF-Token', owner.csrf)
        .expect(201);
    const firstTakeover = await takeover();
    const duplicateTakeover = await takeover();
    const firstTakeoverBody = firstTakeover.body as {
      mode: string;
      changed: boolean;
      controlVersion: number;
    };
    const duplicateTakeoverBody = duplicateTakeover.body as {
      mode: string;
      changed: boolean;
      controlVersion: number;
    };
    expect(firstTakeoverBody).toMatchObject({ mode: 'HUMAN', changed: true });
    expect(duplicateTakeoverBody).toMatchObject({
      mode: 'HUMAN',
      changed: false,
      controlVersion: firstTakeoverBody.controlVersion,
    });
    const [auditCount] = await admin.query<{ count: string }[]>(
      'SELECT count(*)::text AS count FROM public.conversation_control_audit WHERE conversation_id = $1',
      [first.conversation.id],
    );
    expect(auditCount.count).toBe('1');
    await request(server)
      .post(`${base}/${first.conversation.id}/release`)
      .set('Cookie', owner.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', owner.csrf)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({ mode: 'AUTO', changed: true });
      });
    const concurrentControl = await Promise.all([
      takeover(),
      request(server)
        .post(`${base}/${first.conversation.id}/release`)
        .set('Cookie', owner.session)
        .set('Origin', origin)
        .set('X-CSRF-Token', owner.csrf)
        .expect(201),
    ]);
    expect(concurrentControl[0].status).toBe(201);
    const finalState = await request(server)
      .get(`${base}/${first.conversation.id}`)
      .set('Cookie', owner.session)
      .expect(200);
    const finalStateBody = finalState.body as {
      control_mode: string;
      control_version: number | string;
    };
    expect(['AUTO', 'HUMAN']).toContain(finalStateBody.control_mode);
    expect(Number(finalStateBody.control_version)).toBeGreaterThanOrEqual(4);
    const closed = await request(server)
      .post(`${base}/${first.conversation.id}/status`)
      .set('Cookie', owner.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', owner.csrf)
      .send({ status: 'closed' })
      .expect(201);
    expect((closed.body as { status: string }).status).toBe('closed');
    await request(server)
      .post(`${base}/${first.conversation.id}/release`)
      .set('Cookie', owner.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', owner.csrf)
      .expect(400);
    await request(server)
      .get(`${base}/${first.conversation.id}`)
      .set('Cookie', owner.session)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ status: 'closed', control_mode: 'HUMAN' }),
      );
    const inboundAfterResolve = randomUUID();
    await admin.query(
      `INSERT INTO public.messages ("businessId","conversationId",direction,content,status,"whatsappMessageId")
       VALUES ($1,$2,'inbound','Following up','delivered',$3)`,
      [first.business.id, first.conversation.id, inboundAfterResolve],
    );
    await request(server)
      .get(`${base}/${first.conversation.id}`)
      .set('Cookie', owner.session)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ status: 'open', control_mode: 'HUMAN' }),
      );
    await admin.query(
      'DELETE FROM public.messages WHERE "whatsappMessageId"=$1',
      [inboundAfterResolve],
    );
    await admin.query(
      'DELETE FROM public.conversation_internal_notes WHERE conversation_id=$1',
      [first.conversation.id],
    );
    await admin.query(
      'DELETE FROM public.conversation_inbox_reads WHERE conversation_id=$1',
      [first.conversation.id],
    );
    await admin.query(
      'DELETE FROM public.conversation_inbox_state WHERE conversation_id=$1',
      [first.conversation.id],
    );
    await admin.query(
      'DELETE FROM public.conversation_inbox_audit WHERE conversation_id=$1',
      [first.conversation.id],
    );
    await admin.query(
      'DELETE FROM public.conversation_control_audit WHERE conversation_id = $1',
      [first.conversation.id],
    );
  });

  it('lists tenant leads and audits version-checked status transitions', async () => {
    const owner = await login('lead-api-owner');
    await admin.getRepository(BusinessMember).insert({
      businessId: first.business.id,
      accountId: owner.accountId,
      role: 'owner',
    });
    const [lead] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.merchant_leads
       (business_id, customer_id, conversation_id, source, status, first_contact_at, last_activity_at)
       VALUES ($1,$2,$3,'WHATSAPP','NEW',now(),now()) RETURNING id`,
      [first.business.id, first.customer.id, first.conversation.id],
    );
    const path = `/merchant/businesses/${first.business.id}/leads`;
    const headers = {
      Cookie: owner.session,
      Origin: origin,
      'X-CSRF-Token': owner.csrf,
    };
    const list = await request(server)
      .get(path)
      .set('Cookie', owner.session)
      .expect(200);
    const leadList = list.body as { items: Array<Record<string, unknown>> };
    expect(leadList.items).toHaveLength(1);
    expect(leadList.items[0]).toMatchObject({
      id: lead.id,
      customer_id: first.customer.id,
      conversation_id: first.conversation.id,
      status: 'NEW',
      version: 1,
    });
    await request(server)
      .get(`/merchant/businesses/${first.business.id}/leads/${lead.id}`)
      .set('Cookie', owner.session)
      .expect(200);
    await request(server)
      .get(`/merchant/businesses/${second.business.id}/leads/${lead.id}`)
      .set('Cookie', owner.session)
      .expect(404);
    const changed = await request(server)
      .patch(`${path}/${lead.id}`)
      .set(headers)
      .send({ status: 'CONTACTED', expectedVersion: 1 })
      .expect(200);
    expect(changed.body).toMatchObject({
      leadId: lead.id,
      status: 'CONTACTED',
      version: 2,
      changed: true,
      updatedAt: expect.any(String),
    });
    const repeated = await request(server)
      .patch(`${path}/${lead.id}`)
      .set(headers)
      .send({ status: 'CONTACTED', expectedVersion: 1 })
      .expect(200);
    expect(repeated.body).toMatchObject({
      leadId: lead.id,
      status: 'CONTACTED',
      version: 2,
      changed: false,
      updatedAt: expect.any(String),
    });
    await request(server)
      .patch(`${path}/${lead.id}`)
      .set(headers)
      .send({ status: 'QUALIFIED', expectedVersion: 2 })
      .expect(400);
    await request(server)
      .patch(`${path}/${lead.id}`)
      .set(headers)
      .send({ status: 'WON', expectedVersion: 2 })
      .expect(400);
    expect(
      await admin.query<{ count: string }[]>(
        `SELECT count(*)::text AS count FROM public.merchant_lead_events
         WHERE business_id=$1 AND lead_id=$2 AND event_type='STATUS_CHANGED'`,
        [first.business.id, lead.id],
      ),
    ).toEqual([{ count: '1' }]);
    await admin.query(
      'DELETE FROM public.merchant_lead_events WHERE business_id=$1 AND lead_id=$2',
      [first.business.id, lead.id],
    );
    await admin.query(
      'DELETE FROM public.merchant_leads WHERE business_id=$1 AND id=$2',
      [first.business.id, lead.id],
    );
  });

  it('versions sales policy, requires complete qualification and consent, and records manual conversions once', async () => {
    const owner = await login('sales-qualification-owner');
    const agent = await login('sales-qualification-agent');
    await admin.getRepository(BusinessMember).insert({
      businessId: first.business.id,
      accountId: owner.accountId,
      role: 'owner',
    });
    await admin.getRepository(BusinessMember).insert({
      businessId: first.business.id,
      accountId: agent.accountId,
      role: 'agent',
    });
    const [lead] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.merchant_leads
       (business_id, customer_id, conversation_id, source, status, first_contact_at, last_activity_at)
       VALUES ($1,$2,$3,'WHATSAPP','NEW',now(),now()) RETURNING id`,
      [first.business.id, first.customer.id, first.conversation.id],
    );
    const base = `/merchant/businesses/${first.business.id}`;
    const headers = {
      Cookie: owner.session,
      Origin: origin,
      'X-CSRF-Token': owner.csrf,
    };
    const initial = await request(server)
      .get(`${base}/sales-policy`)
      .set('Cookie', owner.session)
      .expect(200);
    const initialBody = initial.body as {
      policy: { version: number; fields: unknown[] };
      templates: Record<string, unknown>;
    };
    expect(initialBody.policy).toMatchObject({ version: 0, fields: [] });
    expect(initialBody.templates).toHaveProperty('retail');
    expect(initialBody.templates).toHaveProperty('service');
    await request(server)
      .get(`${base}/sales-policy`)
      .set('Cookie', agent.session)
      .expect(403);
    const fields = [
      {
        id: 'service_required',
        label: 'Service required',
        type: 'TEXT',
        required: true,
        validation: { maxLength: 100 },
        order: 10,
        purpose: 'Service the customer asked for.',
        consentRequired: false,
      },
      {
        id: 'contact_ok',
        label: 'Contact permission',
        type: 'BOOLEAN',
        required: false,
        validation: {},
        order: 20,
        purpose: 'Customer agreed to follow-up.',
        consentRequired: true,
      },
    ];
    await request(server)
      .patch(`${base}/sales-policy`)
      .set(headers)
      .send({
        expectedVersion: 0,
        fields: [{ ...fields[0], type: 'ARBITRARY_CODE' }],
      })
      .expect(400);
    const savedPolicy = await request(server)
      .patch(`${base}/sales-policy`)
      .set(headers)
      .send({ expectedVersion: 0, fields })
      .expect(200);
    expect(savedPolicy.body).toMatchObject({ version: 1, fields });
    await request(server)
      .patch(`${base}/sales-policy`)
      .set(headers)
      .send({ expectedVersion: 0, fields })
      .expect(409);
    const leadPath = `${base}/leads/${lead.id}`;
    await request(server)
      .patch(leadPath)
      .set(headers)
      .send({ status: 'CONTACTED', expectedVersion: 1 })
      .expect(200);
    const invalid = {
      expectedLeadVersion: 2,
      policyVersion: 1,
      fieldValues: { contact_ok: true },
      consentEvidence: {},
      markQualified: true,
    };
    await request(server)
      .patch(`${leadPath}/qualification`)
      .set(headers)
      .send(invalid)
      .expect(400);
    await request(server)
      .patch(`${leadPath}/qualification`)
      .set(headers)
      .send({
        ...invalid,
        fieldValues: { service_required: 'Repair', contact_ok: true },
        consentEvidence: {
          contact_ok: {
            consented: false,
            recordedAt: new Date().toISOString(),
            source: 'MERCHANT_RECORDED',
          },
        },
      })
      .expect(400);
    const qualified = await request(server)
      .patch(`${leadPath}/qualification`)
      .set(headers)
      .send({
        ...invalid,
        fieldValues: { service_required: 'Repair', contact_ok: true },
        consentEvidence: {
          contact_ok: {
            consented: true,
            recordedAt: new Date().toISOString(),
            source: 'CUSTOMER_CONFIRMED',
          },
        },
      })
      .expect(200);
    expect(qualified.body).toMatchObject({
      qualification_status: 'QUALIFIED',
      lead_status: 'QUALIFIED',
      lead_version: 3,
      policy_version: 1,
    });
    const nextFields = fields.map((field) =>
      field.id === 'service_required'
        ? { ...field, purpose: 'Customer stated service requested.' }
        : field,
    );
    await request(server)
      .patch(`${base}/sales-policy`)
      .set(headers)
      .send({ expectedVersion: 1, fields: nextFields })
      .expect(200);
    const details = await request(server)
      .get(`${leadPath}/qualification`)
      .set('Cookie', owner.session)
      .expect(200);
    const detailsBody = details.body as {
      record: { policy_version: number; field_values: Record<string, unknown> };
      history: unknown[];
      conversions: Array<Record<string, unknown>>;
    };
    expect(detailsBody.record).toMatchObject({
      policy_version: 1,
      field_values: { service_required: 'Repair', contact_ok: true },
    });
    expect(detailsBody.history).toHaveLength(1);
    await request(server)
      .get(
        `/merchant/businesses/${second.business.id}/leads/${lead.id}/qualification`,
      )
      .set('Cookie', owner.session)
      .expect(404);
    const key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const won = await request(server)
      .post(`${leadPath}/convert`)
      .set({ ...headers, 'Idempotency-Key': key })
      .send({
        expectedLeadVersion: 3,
        outcome: 'WON',
        details: {
          reference: 'merchant-record-12',
          value: 27500,
          currency: 'NGN',
        },
      })
      .expect(201);
    expect(won.body).toMatchObject({
      outcome: 'WON',
      lead_version: 4,
      changed: true,
    });
    const replay = await request(server)
      .post(`${leadPath}/convert`)
      .set({ ...headers, 'Idempotency-Key': key })
      .send({
        expectedLeadVersion: 3,
        outcome: 'WON',
        details: {
          reference: 'merchant-record-12',
          value: 27500,
          currency: 'NGN',
        },
      })
      .expect(201);
    expect(replay.body).toMatchObject({
      outcome: 'WON',
      lead_version: 4,
      changed: false,
    });
    await request(server)
      .post(`${leadPath}/convert`)
      .set({
        ...headers,
        'Idempotency-Key': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      })
      .send({ expectedLeadVersion: 4, outcome: 'WON', details: {} })
      .expect(409);
    const history = await request(server)
      .get(`${leadPath}/qualification`)
      .set('Cookie', owner.session)
      .expect(200);
    const historyBody = history.body as {
      conversions: Array<Record<string, unknown>>;
    };
    expect(historyBody.conversions).toHaveLength(1);
    expect(historyBody.conversions[0]).toMatchObject({
      outcome: 'WON',
      reference: 'merchant-record-12',
      currency: 'NGN',
    });
    const serviceConversation = await repositories(admin).conversations.create({
      businessId: first.business.id,
      customerId: first.customer.id,
      status: 'open',
    });
    const [lostLead] = await admin.query<{ id: string }[]>(
      `INSERT INTO public.merchant_leads
       (business_id, customer_id, conversation_id, source, status, first_contact_at, last_activity_at)
       VALUES ($1,$2,$3,'WHATSAPP','NEW',now(),now()) RETURNING id`,
      [first.business.id, first.customer.id, serviceConversation.id],
    );
    const lostPath = `${base}/leads/${lostLead.id}/convert`;
    const lost = await request(server)
      .post(lostPath)
      .set({
        ...headers,
        'Idempotency-Key': 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      })
      .send({
        expectedLeadVersion: 1,
        outcome: 'LOST',
        details: { lossReason: 'Customer postponed service.' },
      })
      .expect(201);
    expect(lost.body as Record<string, unknown>).toMatchObject({
      outcome: 'LOST',
      lead_version: 2,
      changed: true,
    });
    const lostHistory = await request(server)
      .get(`${base}/leads/${lostLead.id}/qualification`)
      .set('Cookie', owner.session)
      .expect(200);
    expect(
      (lostHistory.body as { conversions: Array<Record<string, unknown>> })
        .conversions[0],
    ).toMatchObject({
      outcome: 'LOST',
      loss_reason: 'Customer postponed service.',
    });
    await admin.query(
      'DELETE FROM public.merchant_lead_events WHERE business_id=$1 AND lead_id=$2',
      [first.business.id, lead.id],
    );
    await admin.query(
      'DELETE FROM public.merchant_leads WHERE business_id=$1 AND id=$2',
      [first.business.id, lead.id],
    );
    await admin.query(
      'DELETE FROM public.merchant_lead_events WHERE business_id=$1 AND lead_id=$2',
      [first.business.id, lostLead.id],
    );
    await admin.query(
      'DELETE FROM public.merchant_leads WHERE business_id=$1 AND id=$2',
      [first.business.id, lostLead.id],
    );
    await admin
      .getRepository(Conversation)
      .delete({ id: serviceConversation.id });
    await admin.query(
      'DELETE FROM public.sales_qualification_policies WHERE business_id=$1',
      [first.business.id],
    );
  });

  it('manages tenant FAQ revisions, publishes only approved revisions, and protects retrieval', async () => {
    const owner = await login('faq-owner');
    const editor = await login('faq-editor');
    const agent = await login('faq-agent');
    const foreignOwner = await login('faq-foreign-owner');
    await admin.getRepository(BusinessMember).insert([
      {
        businessId: first.business.id,
        accountId: owner.accountId,
        role: 'owner',
      },
      {
        businessId: first.business.id,
        accountId: editor.accountId,
        role: 'editor',
      },
      {
        businessId: first.business.id,
        accountId: agent.accountId,
        role: 'agent',
      },
      {
        businessId: second.business.id,
        accountId: foreignOwner.accountId,
        role: 'owner',
      },
    ]);
    await database.grantRuntimeAccess(admin);
    const runtime = await database.runtime();
    const base = `/merchant/businesses/${first.business.id}/faqs`;
    const otherBase = `/merchant/businesses/${second.business.id}/faqs`;
    const key = randomUUID();
    const draftPayload = {
      question: 'What time do you open?',
      answer: 'We open at 9 AM.',
    };
    const createFaq = (
      merchant: Awaited<ReturnType<typeof login>>,
      payload: { question: string; answer: string } = draftPayload,
      requestKey: string = key,
    ) =>
      request(server)
        .post(base)
        .set('Cookie', merchant.session)
        .set('Origin', origin)
        .set('X-CSRF-Token', merchant.csrf)
        .set('Idempotency-Key', requestKey)
        .send(payload);
    const updateFaq = (
      merchant: Awaited<ReturnType<typeof login>>,
      faqId: string,
      payload: { question: string; answer: string; expectedRevision: number },
    ) =>
      request(server)
        .patch(`${base}/${faqId}`)
        .set('Cookie', merchant.session)
        .set('Origin', origin)
        .set('X-CSRF-Token', merchant.csrf)
        .send(payload);
    const publishFaq = (
      merchant: Awaited<ReturnType<typeof login>>,
      faqId: string,
    ) =>
      request(server)
        .post(`${base}/${faqId}/publish`)
        .set('Cookie', merchant.session)
        .set('Origin', origin)
        .set('X-CSRF-Token', merchant.csrf);
    const retrieve = () =>
      runtime.query<
        {
          faq_id: string;
          published_revision_id: string;
          question: string;
          answer: string;
        }[]
      >('SELECT * FROM public.kleva_published_faqs($1)', [first.business.id]);

    try {
      await request(server).get(base).expect(401);
      await createFaq(owner).set('X-CSRF-Token', 'wrong').expect(403);
      await createFaq(agent).expect(403);
      await createFaq(editor, draftPayload, 'not-a-v4-key').expect(400);
      await createFaq(
        editor,
        { question: ' ', answer: 'No answer' },
        randomUUID(),
      ).expect(400);
      await createFaq(
        editor,
        {
          question: '<script>alert(1)</script>',
          answer: 'Plain text is escaped by the client.',
        },
        randomUUID(),
      ).expect(201);
      const create = await createFaq(owner).expect(201);
      const faqId = (create.body as { id: string }).id;
      expect(create.body).toMatchObject({
        status: 'DRAFT',
        revision: 1,
        published_revision: null,
        has_unpublished_changes: false,
      });
      expect(await retrieve()).toEqual([]);
      const repeated = await createFaq(owner).expect(201);
      expect((repeated.body as { id: string }).id).toBe(faqId);
      await createFaq(owner, {
        question: 'Different question',
        answer: 'Different answer',
      }).expect(409);

      const draftEdit = await updateFaq(editor, faqId, {
        question: draftPayload.question,
        answer: 'We open daily at 9 AM.',
        expectedRevision: 1,
      }).expect(200);
      expect(draftEdit.body).toMatchObject({
        status: 'DRAFT',
        revision: 2,
        answer: 'We open daily at 9 AM.',
      });
      await updateFaq(editor, faqId, {
        question: 'Stale edit',
        answer: 'Stale',
        expectedRevision: 1,
      }).expect(409);
      await updateFaq(foreignOwner, faqId, {
        ...draftPayload,
        expectedRevision: 2,
      }).expect(404);
      await request(server)
        .get(`${otherBase}/${faqId}`)
        .set('Cookie', foreignOwner.session)
        .expect(404);
      await publishFaq(agent, faqId).expect(403);
      await request(server).get(base).set('Cookie', agent.session).expect(403);

      const firstPublish = await publishFaq(owner, faqId).expect(201);
      expect(firstPublish.body).toMatchObject({
        status: 'PUBLISHED',
        revision: 2,
        published_revision: 2,
      });
      expect(await retrieve()).toMatchObject([
        {
          faq_id: faqId,
          question: draftPayload.question,
          answer: 'We open daily at 9 AM.',
        },
      ]);
      await publishFaq(editor, faqId).expect(201);
      let [eventCounts] = await admin.query<
        { event_type: string; count: string }[]
      >(
        `SELECT event_type, count(*)::text AS count FROM public.knowledge_faq_events
         WHERE faq_id = $1 AND event_type = 'PUBLISHED' GROUP BY event_type`,
        [faqId],
      );
      expect(eventCounts.count).toBe('1');

      const nextDraft = await updateFaq(editor, faqId, {
        question: draftPayload.question,
        answer: 'We open every weekday at 8:30 AM.',
        expectedRevision: 2,
      }).expect(200);
      expect(nextDraft.body).toMatchObject({
        status: 'PUBLISHED',
        revision: 3,
        published_revision: 2,
        has_unpublished_changes: true,
      });
      expect(await retrieve()).toMatchObject([
        { faq_id: faqId, answer: 'We open daily at 9 AM.' },
      ]);
      await publishFaq(owner, faqId).expect(201);
      expect(await retrieve()).toMatchObject([
        { faq_id: faqId, answer: 'We open every weekday at 8:30 AM.' },
      ]);

      const unpublish = () =>
        request(server)
          .post(`${base}/${faqId}/unpublish`)
          .set('Cookie', owner.session)
          .set('Origin', origin)
          .set('X-CSRF-Token', owner.csrf);
      const unpublished = await unpublish().expect(201);
      expect(unpublished.body).toMatchObject({
        status: 'DRAFT',
        revision: 3,
        published_revision: null,
      });
      await unpublish().expect(201);
      expect(await retrieve()).toEqual([]);
      [eventCounts] = await admin.query<
        { event_type: string; count: string }[]
      >(
        `SELECT event_type, count(*)::text AS count FROM public.knowledge_faq_events
         WHERE faq_id = $1 AND event_type = 'UNPUBLISHED' GROUP BY event_type`,
        [faqId],
      );
      expect(eventCounts.count).toBe('1');

      const merchantConnection = merchantDatabase.connection();
      await expect(
        merchantConnection.query('SELECT * FROM public.knowledge_faqs'),
      ).rejects.toMatchObject({ driverError: { code: '42501' } });
      await admin.query(
        'DELETE FROM public.knowledge_faq_events WHERE business_id = $1',
        [first.business.id],
      );
      await admin.query(
        `UPDATE public.knowledge_faqs
         SET draft_revision_id = NULL, published_revision_id = NULL
         WHERE business_id = $1`,
        [first.business.id],
      );
      await admin.query(
        'DELETE FROM public.knowledge_faq_revisions WHERE business_id = $1',
        [first.business.id],
      );
      await admin.query(
        'DELETE FROM public.knowledge_faqs WHERE business_id = $1',
        [first.business.id],
      );
      // This disposable migration-cycle fixture intentionally removes the
      // onboarding state that makes migration 0019 refuse a data-losing down.
      await admin.query('DELETE FROM public.merchant_onboarding_progress');
      await admin.query('DELETE FROM public.merchant_login_attempts');
      await clearEmailAuthenticationFixtures(admin);
      // Migrations 0020-0025 sit after the 0019 onboarding rollback guard.
      await admin.undoLastMigration();
      await admin.undoLastMigration();
      await admin.undoLastMigration();
      await admin.undoLastMigration();
      await admin.undoLastMigration();
      await admin.undoLastMigration();
      await admin.undoLastMigration();
      await applyMigrations(admin);
      await grantMerchantAccess(
        admin,
        env.MERCHANT_DATABASE_USER!,
        env.IDENTITY_DATABASE_USER!,
      );
      await database.grantRuntimeAccess(admin);
    } finally {
      await runtime.destroy();
    }
  });

  it('manages tenant products with immutable published revisions and precise nullable prices', async () => {
    const owner = await login('product-owner');
    const editor = await login('product-editor');
    const agent = await login('product-agent');
    const foreignOwner = await login('product-foreign-owner');
    await admin.getRepository(BusinessMember).insert([
      {
        businessId: first.business.id,
        accountId: owner.accountId,
        role: 'owner',
      },
      {
        businessId: first.business.id,
        accountId: editor.accountId,
        role: 'editor',
      },
      {
        businessId: first.business.id,
        accountId: agent.accountId,
        role: 'agent',
      },
      {
        businessId: second.business.id,
        accountId: foreignOwner.accountId,
        role: 'owner',
      },
    ]);
    await database.grantRuntimeAccess(admin);
    const runtime = await database.runtime();
    const base = `/merchant/businesses/${first.business.id}/products`;
    const key = randomUUID();
    const product: Record<string, unknown> = {
      name: 'Handmade market bag',
      description: 'Woven in Lagos.',
      sku: 'BAG-001',
      price: null,
      currency: 'NGN',
      availability: 'UNKNOWN',
    };
    const createProduct = (
      merchant: Awaited<ReturnType<typeof login>>,
      data: Record<string, unknown> = product,
      requestKey: string = key,
    ) =>
      request(server)
        .post(base)
        .set('Cookie', merchant.session)
        .set('Origin', origin)
        .set('X-CSRF-Token', merchant.csrf)
        .set('Idempotency-Key', requestKey)
        .send(data);
    const editProduct = (
      merchant: Awaited<ReturnType<typeof login>>,
      productId: string,
      data: Record<string, unknown>,
    ) =>
      request(server)
        .patch(`${base}/${productId}`)
        .set('Cookie', merchant.session)
        .set('Origin', origin)
        .set('X-CSRF-Token', merchant.csrf)
        .send(data);
    const publication = (
      merchant: Awaited<ReturnType<typeof login>>,
      productId: string,
      action: 'publish' | 'unpublish' = 'publish',
    ) =>
      request(server)
        .post(`${base}/${productId}/${action}`)
        .set('Cookie', merchant.session)
        .set('Origin', origin)
        .set('X-CSRF-Token', merchant.csrf);
    const retrieve = () =>
      runtime.query<
        {
          business_id: string;
          product_id: string;
          published_revision_id: string;
          name: string;
          description: string;
          price: string | null;
          currency: string;
          availability: string;
        }[]
      >('SELECT * FROM public.kleva_published_products($1)', [
        first.business.id,
      ]);

    try {
      await request(server).get(base).expect(401);
      await createProduct(owner).set('X-CSRF-Token', 'wrong').expect(403);
      await createProduct(agent).expect(403);
      await createProduct(editor, product, 'not-a-v4-key').expect(400);
      await createProduct(
        editor,
        { ...product, price: '-0.01' },
        randomUUID(),
      ).expect(400);
      await createProduct(
        editor,
        { ...product, currency: 'QQQ' },
        randomUUID(),
      ).expect(400);

      const created = await createProduct(editor).expect(201);
      const productId = (created.body as { id: string }).id;
      expect(created.body).toMatchObject({
        status: 'DRAFT',
        revision: 1,
        published_revision: null,
        price: null,
        availability: 'UNKNOWN',
      });
      expect(await retrieve()).toEqual([]);
      const duplicate = await createProduct(owner).expect(201);
      expect((duplicate.body as { id: string }).id).toBe(productId);
      await createProduct(owner, {
        ...product,
        name: 'Different product',
      }).expect(409);
      await request(server)
        .get(`${base}?limit=1&offset=0`)
        .set('Cookie', owner.session)
        .expect(200)
        .expect(({ body }) => {
          const page = body as { items: unknown[]; hasMore: boolean };
          expect(page.items).toHaveLength(1);
          expect(page.hasMore).toBe(false);
        });

      const editBody = {
        ...product,
        description: 'Handwoven with recycled cotton.',
        expectedRevision: 1,
      };
      await editProduct(editor, productId, editBody)
        .expect(200)
        .expect(({ body }) => {
          expect(body).toMatchObject({ revision: 2, status: 'DRAFT' });
        });
      await editProduct(editor, productId, editBody).expect(409);
      await editProduct(foreignOwner, productId, editBody).expect(404);
      await request(server)
        .get(`/merchant/businesses/${second.business.id}/products/${productId}`)
        .set('Cookie', foreignOwner.session)
        .expect(404);
      await editProduct(agent, productId, editBody).expect(403);
      await publication(agent, productId).expect(403);
      await publication(owner, productId).expect(201);
      await publication(editor, productId).expect(201);
      expect(await retrieve()).toMatchObject([
        {
          product_id: productId,
          business_id: first.business.id,
          name: product.name,
          description: 'Handwoven with recycled cotton.',
          price: null,
          availability: 'UNKNOWN',
        },
      ]);

      const concurrent = await Promise.all([
        editProduct(editor, productId, {
          ...product,
          description: 'First racing update.',
          expectedRevision: 2,
        }),
        editProduct(owner, productId, {
          ...product,
          description: 'Second racing update.',
          expectedRevision: 2,
        }),
      ]);
      expect(concurrent.map(({ status }) => status).sort()).toEqual([200, 409]);
      const concurrentWinner = concurrent.find(({ status }) => status === 200)!;
      expect(concurrentWinner.body).toMatchObject({
        revision: 3,
        published_revision: 2,
        has_unpublished_changes: true,
      });
      expect((await retrieve())[0].description).toBe(
        'Handwoven with recycled cotton.',
      );
      await publication(owner, productId).expect(201);
      const winnerBody = concurrentWinner.body as { description: string };
      expect((await retrieve())[0].description).toBe(winnerBody.description);

      const updated = await editProduct(editor, productId, {
        ...product,
        description: 'Updated, pending merchant approval.',
        expectedRevision: 3,
      }).expect(200);
      expect(updated.body).toMatchObject({
        status: 'PUBLISHED',
        revision: 4,
        published_revision: 3,
        has_unpublished_changes: true,
      });
      expect((await retrieve())[0].description).toBe(winnerBody.description);
      await publication(owner, productId).expect(201);
      expect((await retrieve())[0].description).toBe(
        'Updated, pending merchant approval.',
      );

      const precise = await createProduct(
        owner,
        {
          name: 'Precision priced item',
          description: 'Exact decimal price.',
          sku: 'PRECISE-001',
          price: '900719925474.09',
          currency: 'USD',
          availability: 'IN_STOCK',
        },
        randomUUID(),
      ).expect(201);
      const preciseId = (precise.body as { id: string }).id;
      expect((precise.body as { price: string }).price).toBe('900719925474.09');
      await publication(owner, preciseId).expect(201);
      expect(
        (await retrieve()).find(({ product_id }) => product_id === preciseId),
      ).toMatchObject({
        price: '900719925474.09',
        currency: 'USD',
        availability: 'IN_STOCK',
      });

      const unpublish = () => publication(owner, productId, 'unpublish');
      await unpublish().expect(201);
      await unpublish().expect(201);
      expect(await retrieve()).toHaveLength(1);
      const counts = await admin.query<{ event_type: string; count: string }[]>(
        `SELECT event_type, count(*)::text AS count FROM public.merchant_product_events
         WHERE product_id = $1 GROUP BY event_type`,
        [productId],
      );
      expect(counts).toEqual(
        expect.arrayContaining([
          { event_type: 'CREATED', count: '1' },
          { event_type: 'EDITED', count: '3' },
          { event_type: 'PUBLISHED', count: '3' },
          { event_type: 'UNPUBLISHED', count: '1' },
        ]),
      );
      await expect(
        merchantDatabase
          .connection()
          .query('SELECT * FROM public.merchant_products'),
      ).rejects.toMatchObject({ driverError: { code: '42501' } });
      // This disposable migration-cycle fixture intentionally removes the
      // onboarding state that makes migration 0019 refuse a data-losing down.
      await admin.query('DELETE FROM public.merchant_onboarding_progress');
      await admin.query('DELETE FROM public.merchant_login_attempts');
      await clearEmailAuthenticationFixtures(admin);
      // Unwind every migration after catalog migration 0014. Keep this fixture
      // aligned as new additive migrations are appended to the registry.
      const catalogMigrationIndex = databaseMigrations.findIndex(
        ({ name }) => name === 'MerchantProductCatalog1760000000014',
      );
      expect(catalogMigrationIndex).toBeGreaterThanOrEqual(0);
      for (
        let i = catalogMigrationIndex + 1;
        i < databaseMigrations.length;
        i += 1
      ) {
        await admin.undoLastMigration();
      }
      await expect(admin.undoLastMigration()).rejects.toThrow(
        'Merchant product history exists',
      );

      await admin.query(
        'DELETE FROM public.merchant_product_events WHERE business_id = $1',
        [first.business.id],
      );
      await admin.query(
        `UPDATE public.merchant_products SET draft_revision_id = NULL, published_revision_id = NULL
         WHERE business_id = $1`,
        [first.business.id],
      );
      await admin.query(
        'DELETE FROM public.merchant_product_revisions WHERE business_id = $1',
        [first.business.id],
      );
      await admin.query(
        'DELETE FROM public.merchant_products WHERE business_id = $1',
        [first.business.id],
      );
      await admin.undoLastMigration();
      await applyMigrations(admin);
      await grantMerchantAccess(
        admin,
        env.MERCHANT_DATABASE_USER!,
        env.IDENTITY_DATABASE_USER!,
      );
      await database.grantRuntimeAccess(admin);
    } finally {
      await runtime.destroy();
    }
  });

  it('persists authorized versioned AI settings and tests published knowledge without live customer effects', async () => {
    const owner = await login('assistant-playground-owner');
    const editor = await login('assistant-playground-editor');
    const agent = await login('assistant-playground-agent');
    const foreignOwner = await login('assistant-playground-foreign-owner');
    await admin.getRepository(BusinessMember).insert([
      {
        businessId: first.business.id,
        accountId: owner.accountId,
        role: 'owner',
      },
      {
        businessId: first.business.id,
        accountId: editor.accountId,
        role: 'editor',
      },
      {
        businessId: first.business.id,
        accountId: agent.accountId,
        role: 'agent',
      },
      {
        businessId: second.business.id,
        accountId: foreignOwner.accountId,
        role: 'owner',
      },
    ]);
    await database.grantRuntimeAccess(admin);

    let runtime: DataSource | undefined;
    try {
      const base = `/merchant/businesses/${first.business.id}/assistant/configuration`;
      const defaultConfig = await request(server)
        .get(base)
        .set('Cookie', owner.session)
        .expect(200);
      expect(defaultConfig.body).toMatchObject({
        revision: 0,
        assistantName: 'Kleva Assistant',
        language: 'ENGLISH',
      });
      const saved = await request(server)
        .patch(base)
        .set('Cookie', owner.session)
        .set('Origin', origin)
        .set('X-CSRF-Token', owner.csrf)
        .send({
          revision: 0,
          assistantName: 'Store Guide',
          greeting: 'Welcome to our shop.',
          tone: 'FRIENDLY',
          language: 'ENGLISH',
          responseLength: 'BALANCED',
          handoffBehavior: 'OFFER_HUMAN',
          fallbackResponse: 'A teammate can confirm that for you.',
        })
        .expect(200);
      expect(saved.body).toMatchObject({
        revision: 1,
        assistantName: 'Store Guide',
      });
      await request(server)
        .patch(base)
        .set('Cookie', editor.session)
        .set('Origin', origin)
        .set('X-CSRF-Token', editor.csrf)
        .send({
          revision: 0,
          assistantName: 'Store Guide',
          greeting: 'Welcome to our shop.',
          tone: 'FRIENDLY',
          language: 'ENGLISH',
          responseLength: 'BALANCED',
          handoffBehavior: 'OFFER_HUMAN',
          fallbackResponse: 'A teammate can confirm that for you.',
        })
        .expect(409);
      await request(server).get(base).set('Cookie', agent.session).expect(403);
      await request(server)
        .get(
          `/merchant/businesses/${second.business.id}/assistant/configuration`,
        )
        .set('Cookie', owner.session)
        .expect(404);
      await request(server)
        .patch(base)
        .set('Cookie', owner.session)
        .set('Origin', origin)
        .set('X-CSRF-Token', owner.csrf)
        .send({ ...saved.body, revision: 1, allowUnpublishedKnowledge: true })
        .expect(400);

      const faqBase = `/merchant/businesses/${first.business.id}/faqs`;
      const created = await request(server)
        .post(faqBase)
        .set('Cookie', owner.session)
        .set('Origin', origin)
        .set('X-CSRF-Token', owner.csrf)
        .set('Idempotency-Key', randomUUID())
        .send({
          question: 'What time do you open?',
          answer: 'We open daily at 9 AM.',
        })
        .expect(201);
      const faqId = (created.body as { id: string }).id;
      await request(server)
        .post(`${faqBase}/${faqId}/publish`)
        .set('Cookie', owner.session)
        .set('Origin', origin)
        .set('X-CSRF-Token', owner.csrf)
        .expect(201);

      runtime = await database.runtime();
      const beforeEffects = await admin.query<
        {
          messages: string;
          customers: string;
          leads: string;
          outbound: string;
        }[]
      >(
        `SELECT (SELECT count(*)::text FROM public.messages WHERE "businessId"=$1) AS messages,
        (SELECT count(*)::text FROM public.customers WHERE "businessId"=$1) AS customers,
        (SELECT count(*)::text FROM public.merchant_leads WHERE business_id=$1) AS leads,
        (SELECT count(*)::text FROM public.whatsapp_outbound_messages WHERE business_id=$1) AS outbound`,
        [first.business.id],
      );
      const model: GroundedModel = {
        generate: jest.fn(async (input) => ({
          reply: 'We open daily at 9 AM.',
          evidenceIds: [input.evidence[0].id],
          canAnswer: true,
          needsHuman: false,
          inputTokens: 64,
          outputTokens: 9,
        })),
      };
      const service = new MerchantAssistantService(
        new MerchantAccess(merchantDatabase),
        new UnifiedKnowledgeRetrievalService(runtime),
        new UsageService(runtime),
        model,
      );
      const result = await service.testMessage(
        { accountId: owner.accountId, sessionDigest: owner.digest },
        first.business.id,
        { message: 'What time do you open?' },
      );
      expect(result).toMatchObject({
        outcome: 'ANSWERED',
        reply: 'We open daily at 9 AM.',
        tokenUsage: { input: 64, output: 9, kind: 'ACTUAL' },
      });
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toMatchObject({
        id: faqId,
        type: 'FAQ',
        title: 'What time do you open?',
      });
      const usageRows = await admin.query<
        { outcome: string; input_tokens: number; output_tokens: number }[]
      >(
        `SELECT outcome,input_tokens,output_tokens FROM public.ai_playground_usage WHERE business_id=$1 AND account_id=$2`,
        [first.business.id, owner.accountId],
      );
      expect(usageRows).toEqual([
        { outcome: 'ANSWERED', input_tokens: 64, output_tokens: 9 },
      ]);
      await expect(
        merchantDatabase
          .connection()
          .query('SELECT * FROM public.assistant_configurations'),
      ).rejects.toMatchObject({ driverError: { code: '42501' } });
      const afterEffects = await admin.query(
        `SELECT (SELECT count(*)::text FROM public.messages WHERE "businessId"=$1) AS messages,
          (SELECT count(*)::text FROM public.customers WHERE "businessId"=$1) AS customers,
          (SELECT count(*)::text FROM public.merchant_leads WHERE business_id=$1) AS leads,
          (SELECT count(*)::text FROM public.whatsapp_outbound_messages WHERE business_id=$1) AS outbound`,
        [first.business.id],
      );
      expect(afterEffects).toEqual(beforeEffects);
    } finally {
      await runtime?.destroy();
      await admin.query(
        'DELETE FROM public.ai_playground_usage WHERE business_id=$1',
        [first.business.id],
      );
      await admin.query(
        'DELETE FROM public.ai_playground_rate_limits WHERE business_id=$1',
        [first.business.id],
      );
      await admin.query(
        'DELETE FROM public.assistant_configuration_audit WHERE business_id=$1',
        [first.business.id],
      );
      await admin.query(
        'DELETE FROM public.assistant_configurations WHERE business_id=$1',
        [first.business.id],
      );
      await admin.query(
        'DELETE FROM public.knowledge_faq_events WHERE business_id=$1',
        [first.business.id],
      );
      await admin.query(
        'UPDATE public.knowledge_faqs SET draft_revision_id=NULL,published_revision_id=NULL WHERE business_id=$1',
        [first.business.id],
      );
      await admin.query(
        'DELETE FROM public.knowledge_faq_revisions WHERE business_id=$1',
        [first.business.id],
      );
      await admin.query(
        'DELETE FROM public.knowledge_faqs WHERE business_id=$1',
        [first.business.id],
      );
    }
  });

  it('uses restricted SQL, fails closed without context and clears tenant state on pooled connections', async () => {
    const one = await login('pool-one');
    const two = await login('pool-two');
    await admin.getRepository(BusinessMember).insert([
      {
        businessId: first.business.id,
        accountId: one.accountId,
        role: 'owner',
      },
      {
        businessId: second.business.id,
        accountId: two.accountId,
        role: 'owner',
      },
    ]);
    const pool = merchantDatabase.connection();
    await expect(
      pool.query('SELECT public.kleva_issue_session(NULL,NULL,NULL,NULL,NULL)'),
    ).rejects.toMatchObject({ driverError: { code: '42501' } });
    const identityPool = merchantDatabase.identityConnection();
    await expect(
      identityPool.query('SELECT id FROM public.businesses'),
    ).rejects.toMatchObject({ driverError: { code: '42501' } });

    await expect(
      pool.query('SELECT id FROM public.businesses'),
    ).resolves.toEqual([]);
    await expect(
      pool.query('SELECT id FROM public.customers'),
    ).rejects.toMatchObject({ driverError: { code: '42501' } });
    await expect(
      pool.query('SELECT config FROM public.businesses'),
    ).rejects.toMatchObject({ driverError: { code: '42501' } });
    await expect(
      pool.query('SELECT account_id FROM public.merchant_sessions'),
    ).rejects.toMatchObject({ driverError: { code: '42501' } });
    const [{ protected_count }] = await admin.query<
      { protected_count: number }[]
    >(
      `
      SELECT count(*)::int AS protected_count FROM pg_class
      WHERE relname::text = ANY($1) AND relrowsecurity AND relforcerowsecurity
    `,
      [merchantPolicyTables],
    );
    expect(protected_count).toBe(merchantPolicyTables.length);

    const access = new MerchantAccess(merchantDatabase);
    const scopes = [
      [one, first.business.id],
      [two, second.business.id],
    ] as const;
    await Promise.all(
      scopes.map(([merchant, businessId]) =>
        access.withBusiness(
          { accountId: merchant.accountId, sessionDigest: merchant.digest },
          businessId,
          'business.read',
          async (manager) => {
            await manager.query('SELECT pg_sleep(0.05)');
            await expect(
              manager.query('SELECT id FROM public.businesses'),
            ).resolves.toEqual([{ id: businessId }]);
            await expect(
              manager.query('SELECT "businessId" FROM public.business_members'),
            ).resolves.toEqual([{ businessId }]);
          },
        ),
      ),
    );
    const rollback = new Error('Rollback tenant scope');
    await expect(
      access.withBusiness(
        { accountId: one.accountId, sessionDigest: one.digest },
        first.business.id,
        'business.read',
        async (manager) => {
          await expect(
            manager.query('SELECT id FROM public.businesses'),
          ).resolves.toEqual([{ id: first.business.id }]);
          throw rollback;
        },
      ),
    ).rejects.toBe(rollback);

    // A forged tenant identifier alone cannot select rows.
    await pool.transaction(async (manager) => {
      await manager.query("SELECT set_config('kleva.business_id', $1, true)", [
        second.business.id,
      ]);
      await expect(
        manager.query('SELECT id FROM public.businesses'),
      ).resolves.toEqual([]);
    });
    await Promise.all(
      Array.from({ length: 4 }, () =>
        pool.transaction(async (manager) => {
          await manager.query('SELECT pg_sleep(0.05)');
          await expect(
            manager.query('SELECT id FROM public.businesses'),
          ).resolves.toEqual([]);
        }),
      ),
    );
  });

  describe('merchant business onboarding', () => {
    const path = '/merchant/businesses';
    const profile = {
      name: '  Browser Business ',
      industry: ' Retail ',
      phone: '+234 (801) 111-2222',
      timezone: 'africa/lagos',
    };
    type Merchant = Awaited<ReturnType<typeof login>>;
    function create(merchant: Merchant, key: string) {
      return request(server)
        .post(path)
        .set('Cookie', merchant.session)
        .set('Origin', origin)
        .set('X-CSRF-Token', merchant.csrf)
        .set('Idempotency-Key', key);
    }
    function patch(merchant: Merchant, id: string) {
      return request(server)
        .patch(path + '/' + id)
        .set('Cookie', merchant.session)
        .set('Origin', origin)
        .set('X-CSRF-Token', merchant.csrf);
    }

    it('rejects unauthorized, CSRF-unsafe and invalid create requests', async () => {
      const merchant = await login('onboarding-validation');
      await request(server).post(path).send(profile).expect(401);
      await request(server)
        .post(path)
        .set('Cookie', merchant.session)
        .set('Origin', origin)
        .send(profile)
        .expect(403);
      await create(merchant, randomUUID())
        .set('X-CSRF-Token', 'invalid')
        .send(profile)
        .expect(403);
      await create(merchant, 'invalid').send(profile).expect(400);
      for (const bad of [
        { ownerId: randomUUID() },
        { accountId: merchant.accountId },
        { role: 'owner' },
        { id: randomUUID() },
        { config: {} },
        { name: '  ' },
        { industry: '' },
        { phone: '08011112222' },
        { timezone: 'Nowhere/Invalid' },
        { description: 42 },
      ]) {
        await create(merchant, randomUUID())
          .send({ ...profile, ...bad })
          .expect(400);
      }
    });

    it('creates one active owner and no legacy owner across concurrent requests and retries', async () => {
      const merchant = await login('onboarding-concurrency');
      const key = randomUUID();
      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          create(merchant, key).send(profile).expect(201),
        ),
      );
      const body = responses[0].body as { id: string };
      expect(body).toEqual({
        id: expect.any(String),
        name: 'Browser Business',
        industry: 'Retail',
        phone: '+2348011112222',
        timezone: 'Africa/Lagos',
        status: 'active',
        role: 'owner',
        description: null,
        openingHours: null,
      });
      for (const response of responses) expect(response.body).toEqual(body);
      await create(merchant, key)
        .send({
          ...profile,
          name: 'Browser Business',
          phone: '+2348011112222',
        })
        .expect(201, body);
      await create(merchant, key)
        .send({ ...profile, name: 'Different' })
        .expect(409);
      const members = admin.getRepository(BusinessMember);
      expect(await members.findBy({ accountId: merchant.accountId })).toEqual([
        expect.objectContaining({
          businessId: body.id,
          role: 'owner',
          status: 'active',
          legacyUserId: null,
        }),
      ]);
      expect(
        await admin.getRepository(User).countBy({ businessId: body.id }),
      ).toBe(0);
      await expect(
        admin.getRepository(Business).findOneByOrFail({ id: body.id }),
      ).resolves.toMatchObject({
        whatsappNumber: null,
        phoneNumberId: null,
        accessToken: null,
      });
      await request(server)
        .post('/auth/onboarding')
        .set('Cookie', merchant.session)
        .set('Origin', origin)
        .set('X-CSRF-Token', merchant.csrf)
        .send({ currentStep: 'dashboard' })
        .expect(201);
      await signIn('onboarding-concurrency', undefined, '/dashboard');
      const other = await login('onboarding-other-account');
      const distinct = await create(other, key).send(profile).expect(201);
      expect(distinct.body).not.toEqual(body);
      await request(server)
        .get(path + '/' + body.id)
        .set('Cookie', other.session)
        .expect(404);
      await patch(other, body.id).send({ name: 'Cross tenant' }).expect(404);
    });

    it('rolls back the business and request reservation when the owner insert fails', async () => {
      const merchant = await login('onboarding-rollback');
      const key = randomUUID();
      const name = 'Rollback fixture business';
      await admin.query(`
        ALTER TABLE public.business_members ADD CONSTRAINT test_reject_owner
        CHECK ("accountId" IS DISTINCT FROM '${merchant.accountId}'::uuid)
      `);
      try {
        await create(merchant, key)
          .send({ ...profile, name })
          .expect(500);
        expect(await admin.getRepository(Business).countBy({ name })).toBe(0);
        await expect(
          admin.query(
            'SELECT 1 FROM public.merchant_business_requests WHERE request_key = $1',
            [key],
          ),
        ).resolves.toEqual([]);
      } finally {
        await admin.query(
          'ALTER TABLE public.business_members DROP CONSTRAINT test_reject_owner',
        );
      }
      await create(merchant, key)
        .send({ ...profile, name })
        .expect(201);
    });

    it('shares read semantics, permits owner-only profile changes and preserves confidential fields', async () => {
      const owner = await login('onboarding-profile-owner');
      const editor = await login('onboarding-profile-editor');
      const created = await create(owner, randomUUID())
        .send(profile)
        .expect(201);
      const { id } = created.body as { id: string };
      await admin.getRepository(BusinessMember).insert({
        businessId: id,
        accountId: editor.accountId,
        role: 'editor',
      });
      const protectedFields = {
        phoneNumberId: 'private-phone-id',
        accessToken: 'private-provider-token',
        wabaId: 'private-waba',
        displayPhoneNumber: 'private-display-number',
        whatsappNumber: 'private-whatsapp-number',
        status: 'active' as const,
      };
      await admin.getRepository(Business).save({
        id,
        ...protectedFields,
        config: {
          security: { private: 'keep' },
          profile: { logoUploaded: true, openingHours: 'existing' },
        },
      });
      await patch(editor, id).send({ name: 'Editor update' }).expect(403);
      await request(server)
        .patch(path + '/' + id)
        .set('Cookie', owner.session)
        .set('Origin', origin)
        .send({ name: 'No CSRF' })
        .expect(403);
      await patch(owner, id).send({ config: {} }).expect(400);
      await patch(owner, id).send({ status: 'suspended' }).expect(400);
      await patch(owner, id).send({ accessToken: 'replace' }).expect(400);
      const updated = await patch(owner, id)
        .send({ name: ' Updated ', description: ' One line ' })
        .expect(200);
      expect(updated.body).toEqual({
        ...created.body,
        name: 'Updated',
        description: 'One line',
        openingHours: 'existing',
      });
      await request(server)
        .get('/auth/businesses/' + id)
        .set('Cookie', owner.session)
        .expect(200, updated.body as object);
      const profileRead = await request(server)
        .get(path + '/' + id)
        .set('Cookie', editor.session)
        .expect(200);
      expect(profileRead.body).toEqual({ ...updated.body, role: 'editor' });
      await patch(owner, id).send({ openingHours: null }).expect(200);
      await expect(
        admin.getRepository(Business).findOneByOrFail({ id }),
      ).resolves.toMatchObject({
        ...protectedFields,
        config: {
          security: { private: 'keep' },
          profile: {
            logoUploaded: true,
            description: 'One line',
            openingHours: null,
          },
        },
      });
      const pool = merchantDatabase.connection();
      await expect(
        pool.query('UPDATE public.businesses SET name = $1 WHERE id = $2', [
          'denied',
          id,
        ]),
      ).rejects.toMatchObject({ driverError: { code: '42501' } });
      await expect(
        pool.query('SELECT * FROM public.merchant_business_requests'),
      ).rejects.toMatchObject({ driverError: { code: '42501' } });
      await expect(
        pool.query('SELECT * FROM public.kleva_read_merchant_profile()'),
      ).resolves.toEqual([]);
    });

    it('blocks migration rollback once onboarding receipts exist', async () => {
      const merchant = await login('onboarding-rollback-guard');
      await create(merchant, randomUUID()).send(profile).expect(201);
      // Stop immediately after email-authentication migration 0020 so the next
      // rollback exercises its data-loss guard as later migrations are added.
      const emailAuthenticationMigrationIndex = databaseMigrations.findIndex(
        ({ name }) => name === 'MerchantEmailAuthentication1760000000020',
      );
      expect(emailAuthenticationMigrationIndex).toBeGreaterThanOrEqual(0);
      // Later migrations add optional analytics attribution. Clear those values
      // in this disposable fixture so this test still reaches the email-auth
      // rollback guard it is intended to exercise.
      await admin.query(
        'UPDATE public.whatsapp_outbound_messages SET actor_account_id = NULL WHERE actor_account_id IS NOT NULL',
      );
      await admin.query(
        'UPDATE public.usage_reservations SET usage_purpose = NULL WHERE usage_purpose IS NOT NULL',
      );
      for (
        let i = emailAuthenticationMigrationIndex + 1;
        i < databaseMigrations.length;
        i += 1
      ) {
        await admin.undoLastMigration();
      }
      await expect(admin.undoLastMigration()).rejects.toThrow(
        'Merchant email authentication data exists',
      );
      await applyMigrations(admin);
      await grantMerchantAccess(
        admin,
        env.MERCHANT_DATABASE_USER!,
        env.IDENTITY_DATABASE_USER!,
      );
      await database.grantRuntimeAccess(admin);
    });
  });

  it('verifies, encrypts, rotates, fences and disconnects a tenant-owned WhatsApp asset', async () => {
    const owner = await login('secure-whatsapp-owner');
    const other = await login('secure-whatsapp-other');
    const agent = await login('secure-whatsapp-agent');
    await admin.getRepository(BusinessMember).insert([
      {
        businessId: first.business.id,
        accountId: owner.accountId,
        role: 'owner',
      },
      {
        businessId: second.business.id,
        accountId: other.accountId,
        role: 'owner',
      },
      {
        businessId: first.business.id,
        accountId: agent.accountId,
        role: 'agent',
      },
    ]);
    await admin.getRepository(Business).update(first.business.id, {
      phoneNumberId: '789',
      wabaId: '456',
      accessToken: 'legacy-fixture-token',
      connectedAt: new Date(),
    });
    const path = '/merchant/businesses/' + first.business.id + '/whatsapp';
    const otherPath =
      '/merchant/businesses/' + second.business.id + '/whatsapp';
    const payload = {
      phoneNumberId: '789',
      wabaId: '456',
      accessToken: 'valid-fixture-token',
    };
    const headers = (merchant: typeof owner) => ({
      Cookie: merchant.session,
      Origin: origin,
      'X-CSRF-Token': merchant.csrf,
    });
    await request(server).get(path).expect(401);
    await request(server).get(path).set(headers(other)).expect(404);
    await request(server)
      .post(path)
      .set(headers(agent))
      .send(payload)
      .expect(403);
    await request(server)
      .post(path)
      .set(headers(owner))
      .unset('X-CSRF-Token')
      .send(payload)
      .expect(403);
    await request(server)
      .post(path)
      .set(headers(owner))
      .send({ ...payload, accessToken: 'invalid-token' })
      .expect(400);
    await request(server)
      .post(path)
      .set(headers(owner))
      .send({ ...payload, phoneNumberId: '999' })
      .expect(400);
    await request(server)
      .get(path)
      .set(headers(owner))
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          status: 'pending',
          connectionState: 'not_connected',
        }),
      );

    const race = await Promise.all([
      request(server).post(path).set(headers(owner)).send(payload),
      request(server).post(path).set(headers(owner)).send(payload),
    ]);
    expect(race.map(({ status }) => status).sort()).toEqual([201, 409]);
    const created = race.find(({ status }) => status === 201)!;
    expect(created.body).toEqual({
      id: expect.any(String),
      phoneNumberId: '789',
      wabaId: '456',
      displayName: 'Fixture shop',
      displayPhoneNumber: null,
      status: 'active',
      revision: 1,
    });
    expect(created.text).not.toContain(payload.accessToken);
    await request(server)
      .post(
        `/merchant/businesses/${first.business.id}/conversations/${first.conversation.id}/takeover`,
      )
      .set(headers(owner))
      .expect(201);
    await database.grantRuntimeAccess(admin);
    const replyKey = randomUUID();
    const replyPath = `/merchant/businesses/${first.business.id}/conversations/${first.conversation.id}/replies`;
    const reply = () =>
      request(server)
        .post(replyPath)
        .set(headers(owner))
        .set('Idempotency-Key', replyKey)
        .send({ text: 'A merchant reply from the inbox.' })
        .expect(201);
    const firstReply = await reply();
    const duplicateReply = await reply();
    const firstReplyBody = firstReply.body as {
      status: string;
      outboundMessageId: string;
    };
    const duplicateReplyBody = duplicateReply.body as {
      outboundMessageId: string;
    };
    expect(firstReplyBody).toMatchObject({ status: 'QUEUED' });
    expect(duplicateReplyBody.outboundMessageId).toBe(
      firstReplyBody.outboundMessageId,
    );
    const [manualRows] = await admin.query<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM public.whatsapp_outbound_messages
        WHERE id = $1 AND business_id = $2 AND authorization_kind = 'HUMAN'`,
      [firstReplyBody.outboundMessageId, first.business.id],
    );
    expect(manualRows.count).toBe('1');
    const inboxMessages = await request(server)
      .get(
        `/merchant/businesses/${first.business.id}/conversations/${first.conversation.id}/messages`,
      )
      .set('Cookie', owner.session)
      .expect(200);
    const inboxMessagesBody = inboxMessages.body as {
      items: {
        direction: string;
        content: string;
        authorization_kind: string;
        status: string;
      }[];
    };
    expect(inboxMessagesBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: 'outbound',
          content: 'A merchant reply from the inbox.',
          authorization_kind: 'HUMAN',
          status: 'RESERVED',
        }),
      ]),
    );
    await request(server)
      .post(otherPath)
      .set(headers(other))
      .send(payload)
      .expect(409);
    const stored = async () =>
      (
        await admin.query<{ envelope: unknown }[]>(
          'SELECT envelope FROM public.whatsapp_credentials WHERE business_id = $1',
          [first.business.id],
        )
      )[0].envelope;
    const encrypted = await stored();
    expect(JSON.stringify(encrypted)).not.toContain(payload.accessToken);
    await expect(
      merchantDatabase
        .connection()
        .query('SELECT envelope FROM public.whatsapp_credentials'),
    ).rejects.toMatchObject({ driverError: { code: '42501' } });

    const rotate = (accessToken: string) =>
      request(server)
        .patch(path + '/credential')
        .set(headers(owner))
        .send({ accessToken });
    await rotate('invalid-token').expect(400);
    expect(await stored()).toEqual(encrypted);
    await rotate('rotated-fixture-token').expect(200);
    expect(await stored()).not.toEqual(encrypted);

    await database.grantRuntimeAccess(admin);
    const runtime = await database.runtime();
    const channels = new ChannelConnectionService(runtime);
    jest.replaceProperty(process, 'env', env);
    try {
      const sender = new WhatsAppCloudApiService(
        new BusinessRepository(runtime.getRepository(Business)),
        channels,
        new CredentialCipher(),
        runtime,
      );
      const send = () =>
        sender.sendTextMessage(
          { to: '2348012345678', message: 'Fixture' },
          first.business.id,
        );
      const resolve = () =>
        channels.resolve({ provider: 'whatsapp', externalAssetId: '789' });
      await expect(resolve()).resolves.toMatchObject({
        businessId: first.business.id,
      });
      await send();
      expect(meta.sent).toEqual(['rotated-fixture-token']);

      await rotate('revoked-token').expect(200);
      await expect(send()).rejects.toThrow('WhatsApp provider send failed');
      await expect(resolve()).resolves.toBeNull();
      await expect(send()).rejects.toThrow('WhatsApp provider send failed');
      expect(meta.sent).toEqual(['rotated-fixture-token', 'revoked-token']);

      await rotate('recovered-token').expect(200);
      await request(server).delete(path).set(headers(owner)).expect(200);
      expect(await stored()).toBeNull();
      await expect(send()).rejects.toThrow('WhatsApp provider send failed');
      await expect(resolve()).resolves.toBeNull();
      await expect(
        admin
          .getRepository(Business)
          .findOneByOrFail({ id: first.business.id }),
      ).resolves.toMatchObject({ accessToken: 'legacy-fixture-token' });
      expect(meta.sent).toHaveLength(2);
      await expect(
        admin
          .getRepository(Business)
          .update(first.business.id, { phoneNumberId: '999' }),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
      const logs = await admin.query<unknown[]>(
        'SELECT "newValue" FROM public.audit_logs WHERE "entityType" = \'whatsapp_connection\'',
      );
      expect(logs).toHaveLength(5);
      expect(JSON.stringify(logs)).not.toMatch(
        /fixture-token|revoked-token|recovered-token/,
      );
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('completes Meta Embedded Signup once and enforces owner and tenant boundaries', async () => {
    const owner = await login('embedded-whatsapp-owner');
    const other = await login('embedded-whatsapp-other');
    await admin.getRepository(BusinessMember).insert([
      {
        businessId: first.business.id,
        accountId: owner.accountId,
        role: 'owner',
      },
      {
        businessId: second.business.id,
        accountId: other.accountId,
        role: 'owner',
      },
    ]);
    const path = `/merchant/businesses/${first.business.id}/whatsapp`;
    const otherPath = `/merchant/businesses/${second.business.id}/whatsapp`;
    const headers = (merchant: typeof owner) => ({
      Cookie: merchant.session,
      Origin: origin,
      'X-CSRF-Token': merchant.csrf,
    });
    const failedAttempt = await request(server)
      .post(`${path}/embedded-signup/start`)
      .set(headers(owner))
      .send({})
      .expect(201);
    const failedAttemptBody = failedAttempt.body as { attemptId: string };
    await request(server)
      .post(`${path}/embedded-signup/complete`)
      .set(headers(owner))
      .send({
        attemptId: failedAttemptBody.attemptId,
        code: 'invalid-fixture-code',
        wabaId: '456',
        phoneNumberId: '789',
        registrationPin: '123456',
      })
      .expect(400);
    await request(server)
      .get(path)
      .set(headers(owner))
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          connectionState: 'action_required',
          signupFailure: 'META_CODE_EXCHANGE_FAILED',
        });
      });
    const concurrentStarts = await Promise.all([
      request(server)
        .post(`${path}/embedded-signup/start`)
        .set(headers(owner))
        .send({})
        .expect(201),
      request(server)
        .post(`${path}/embedded-signup/start`)
        .set(headers(owner))
        .send({})
        .expect(201),
    ]);
    const startedBody = concurrentStarts[0].body as {
      attemptId: string;
      appId: string;
      configId: string;
      apiVersion: string;
    };
    expect((concurrentStarts[1].body as { attemptId: string }).attemptId).toBe(
      startedBody.attemptId,
    );
    expect(startedBody).toMatchObject({
      attemptId: expect.any(String),
      appId: '123',
      configId: 'fixture-config',
      apiVersion: 'v25.0',
    });
    const resumed = await request(server)
      .post(`${path}/embedded-signup/start`)
      .set(headers(owner))
      .send({})
      .expect(201);
    expect((resumed.body as { attemptId: string }).attemptId).toBe(
      startedBody.attemptId,
    );
    const completionBody = {
      attemptId: startedBody.attemptId,
      code: 'embedded-fixture-code',
      wabaId: '456',
      phoneNumberId: '789',
      registrationPin: '123456',
    };
    await request(server)
      .post(`${otherPath}/embedded-signup/complete`)
      .set(headers(other))
      .send(completionBody)
      .expect(409);
    const completion = await request(server)
      .post(`${path}/embedded-signup/complete`)
      .set(headers(owner))
      .send(completionBody)
      .expect(201);
    expect(completion.body).toMatchObject({
      connectionState: 'connecting',
      provisioningStage: 'CREDENTIAL_STAGED',
      status: 'inactive',
    });
    expect(completion.text).not.toContain('embedded-fixture-token');
    expect(completion.text).not.toContain('123456');
    const [stored] = await admin.query<
      { credential_envelope: unknown; registration_pin_envelope: unknown }[]
    >(
      'SELECT credential_envelope,registration_pin_envelope FROM public.whatsapp_pending_credentials WHERE business_id = $1',
      [first.business.id],
    );
    expect(JSON.stringify(stored.credential_envelope)).not.toContain(
      'embedded-fixture-token',
    );
    expect(JSON.stringify(stored.registration_pin_envelope)).not.toContain(
      '123456',
    );
    const [queued] = await admin.query<
      { operation: string; metadata: Record<string, string> }[]
    >(
      `SELECT operation,metadata FROM public.outbox_operations WHERE operation='whatsapp.connection.provision' AND "businessId"=$1`,
      [first.business.id],
    );
    expect(queued.operation).toBe('whatsapp.connection.provision');
    expect(queued.metadata).toEqual({ attemptId: startedBody.attemptId });
    expect(JSON.stringify(queued.metadata)).not.toContain(
      'embedded-fixture-token',
    );
    await request(server)
      .post(`${path}/embedded-signup/complete`)
      .set(headers(owner))
      .send(completionBody)
      .expect(409);
    await request(server)
      .get(path)
      .set(headers(owner))
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          connectionState: 'connecting',
          provisioningStage: 'CREDENTIAL_STAGED',
        }),
      );
  });
});
