import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  MERCHANT_AUTH_CONFIG,
  MerchantDatabase,
  type MerchantAuthConfig,
} from './merchant-database';
import { MerchantOidcClient } from './oidc-client';

const opaquePattern = /^[A-Za-z0-9_-]{43}$/;
const token = () => randomBytes(32).toString('base64url');
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export function isOpaque(value?: string): value is string {
  return typeof value === 'string' && opaquePattern.test(value);
}

@Injectable()
export class MerchantAuthService {
  constructor(
    private readonly database: MerchantDatabase,
    private readonly oidc: MerchantOidcClient,
    @Inject(MERCHANT_AUTH_CONFIG) private readonly config: MerchantAuthConfig,
  ) {}

  settings() {
    if (!this.config)
      throw new ServiceUnavailableException(
        'Merchant authentication is unavailable.',
      );
    return this.config;
  }

  async start() {
    const { redirect } = this.settings();
    const state = token();
    const binding = token();
    const nonce = token();
    const verifier = token();
    const url = await this.oidc.authorizationUrl(
      redirect,
      state,
      nonce,
      verifier,
    );
    await this.database.identityConnection().query(
      `
      INSERT INTO merchant_login_attempts (state_digest, binding_digest, nonce, verifier)
      VALUES ($1, $2, $3, $4)
    `,
      [digest(state), digest(binding), nonce, verifier],
    );
    return { url: url.href, binding };
  }

  async finish(query: string, binding?: string, previousSession?: string) {
    const url = new URL(this.settings().redirect);
    url.search = query;
    const states = url.searchParams.getAll('state');
    const state = states[0];
    if (states.length !== 1 || !isOpaque(state) || !isOpaque(binding)) {
      throw new BadRequestException('Invalid or expired login attempt.');
    }
    const database = this.database.identityConnection();
    const [attempt] = await database.query<
      { nonce: string; verifier: string }[]
    >('SELECT * FROM public.kleva_consume_login($1, $2)', [
      digest(state),
      digest(binding),
    ]);
    if (!attempt)
      throw new BadRequestException('Invalid or expired login attempt.');

    let identity: Awaited<ReturnType<MerchantOidcClient['verifyCallback']>>;
    try {
      identity = await this.oidc.verifyCallback(
        url,
        state,
        attempt.nonce,
        attempt.verifier,
      );
    } catch {
      throw new UnauthorizedException('Identity provider verification failed.');
    }
    const session = token();
    const csrf = token();
    await database.query(
      'SELECT public.kleva_issue_session($1, $2, $3, $4, $5)',
      [
        identity.issuer,
        identity.subject,
        digest(session),
        digest(csrf),
        isOpaque(previousSession) ? digest(previousSession) : null,
      ],
    );
    return { session, csrf };
  }

  async authenticate(session?: string) {
    if (!isOpaque(session)) throw new UnauthorizedException();
    const key = digest(session);
    const [result] = await this.database
      .connection()
      .query<{ account_id: string | null }[]>(
        'SELECT public.kleva_session_account($1) AS account_id',
        [key],
      );
    if (!result?.account_id) throw new UnauthorizedException();
    return { accountId: result.account_id, sessionDigest: key };
  }

  async verifyCsrf(sessionDigest: string, csrf: string) {
    const [result] = await this.database
      .connection()
      .query<{ valid: boolean }[]>(
        'SELECT public.kleva_session_account($1, $2) IS NOT NULL AS valid',
        [sessionDigest, digest(csrf)],
      );
    return result.valid;
  }

  async logout(sessionDigest: string, csrf: string) {
    await this.database
      .connection()
      .query('SELECT public.kleva_revoke_session($1, $2)', [
        sessionDigest,
        digest(csrf),
      ]);
  }
}

export type MerchantPrincipal = Awaited<
  ReturnType<MerchantAuthService['authenticate']>
>;
