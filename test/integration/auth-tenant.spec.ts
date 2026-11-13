import { ChannelConnectionService } from '../../src/channels/channel-connection.service';
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
import { Business, User } from '../../src/database/entities';
import { BusinessMember } from '../../src/database/entities/business-member.entity';
import {
  grantMerchantAccess,
  merchantPolicyTables,
} from '../../src/database/merchant-access';
import { seedTenant } from './fixtures';
import { clientId, clientSecret, startIdentityProvider } from './oidc-fixture';
import { applyMigrations, createIntegrationDatabase } from './postgres';

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
const origin = 'http://127.0.0.1:3000';

describe('merchant OIDC and tenant isolation', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let idp: Awaited<ReturnType<typeof startIdentityProvider>>;
  let meta: Awaited<ReturnType<typeof startMetaFixture>>;
  let app: ReturnType<typeof fork>;
  let server: string;
  let merchantDatabase: MerchantDatabase;
  let admin: DataSource;
  let first: Awaited<ReturnType<typeof seedTenant>>;
  let second: Awaited<ReturnType<typeof seedTenant>>;
  let env: NodeJS.ProcessEnv;

  beforeAll(async () => {
    database = await createIntegrationDatabase();
    admin = await database.migrator();
    await applyMigrations(admin);
    first = await seedTenant(admin, 1);
    second = await seedTenant(admin, 2);
    const credentials = await database.merchantCredentials(admin);
    idp = await startIdentityProvider();
    meta = await startMetaFixture();
    env = {
      ...process.env,
      NODE_ENV: 'test',
      META_GRAPH_BASE_URL: meta.origin,
      META_APP_ID: '123',
      WHATSAPP_PHONE_NUMBER_ID: '100',
      META_APP_SECRET: 'fixture-app-secret',
      WHATSAPP_CREDENTIAL_KEY_ID: 'fixture',
      WHATSAPP_CREDENTIAL_KEYS: JSON.stringify({
        fixture: randomBytes(32).toString('base64url'),
      }),
      DATABASE_HOST: credentials.host,
      DATABASE_PORT: String(credentials.port),
      DATABASE_NAME: credentials.database,
      DATABASE_USER: 'legacy-runtime',
      DATABASE_PASSWORD: 'fixture-only',
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
      OIDC_REDIRECT_URI: origin + '/auth/callback',
    };
    // Run Nest under Node's native module loader while keeping the signed
    // provider and disposable database under the suite's control.
    app = fork(join(__dirname, 'auth-app.ts'), {
      env,
      execArgv: ['-r', 'ts-node/register/transpile-only'],
    });
    const [port] = (await Promise.race([
      once(app, 'message'),
      once(app, 'exit').then(([code]) => {
        throw new Error(
          'Merchant auth fixture exited with code ' + String(code),
        );
      }),
    ])) as [unknown];
    if (typeof port !== 'number') throw new Error('Expected auth fixture port');
    server = 'http://127.0.0.1:' + String(port);

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

  async function start() {
    const response = await request(server)
      .get('/auth/login')
      .query({ redirect_uri: 'https://untrusted.example.test/callback' })
      .expect(302)
      .expect('Cache-Control', 'no-store');
    const authorization = new URL(String(response.headers.location));
    expect(authorization.searchParams.get('redirect_uri')).toBe(
      origin + '/auth/callback',
    );
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

  async function login(subject: string, previous?: string) {
    const { authorization, binding } = await start();
    const state = authorization.searchParams.get('state');
    const code = idp.authorize(authorization, subject);
    const response = await request(server)
      .get('/auth/callback')
      .query({ code, state })
      .set('Cookie', previous ? binding + '; ' + previous : binding)
      .expect(302)
      .expect('Location', '/auth/me');
    expect(cookieHeader(response, 'kleva_session')).toMatch(
      /HttpOnly; SameSite=Lax/i,
    );
    expect(cookieHeader(response, 'kleva_csrf')).not.toContain('HttpOnly');
    expect(response.text).not.toContain('private-provider');
    const session = cookiePair(response, 'kleva_session');
    const csrf = cookiePair(response, 'kleva_csrf').split('=')[1];
    const account = await admin
      .getRepository(Account)
      .findOneByOrFail({ issuer: idp.issuer, subject });
    return {
      session,
      csrf,
      accountId: account.id,
      digest: hash(session.split('=')[1]),
    };
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

    const rotated = await login('session-fixture', old.session);
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
      await admin.undoLastMigration();
      await admin.undoLastMigration();
      await admin.undoLastMigration();
      await expect(admin.undoLastMigration()).rejects.toThrow(
        'Merchant onboarding data exists',
      );
      await applyMigrations(admin);
      await grantMerchantAccess(
        admin,
        env.MERCHANT_DATABASE_USER!,
        env.IDENTITY_DATABASE_USER!,
      );
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
      .expect(200, { status: 'pending' });

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
      status: 'active',
      revision: 1,
    });
    expect(created.text).not.toContain(payload.accessToken);
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
      await send();
      await expect(resolve()).resolves.toBeNull();
      await send();
      expect(meta.sent).toEqual(['rotated-fixture-token', 'revoked-token']);

      await rotate('recovered-token').expect(200);
      await request(server).delete(path).set(headers(owner)).expect(200);
      expect(await stored()).toBeNull();
      await send();
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
});
