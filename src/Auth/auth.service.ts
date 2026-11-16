import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
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
import { OidcStageFailure } from './oidc-client';
import { errorCode, postgresErrorCategory } from '../config/logging';

const opaquePattern = /^[A-Za-z0-9_-]{43}$/;
const token = () => randomBytes(32).toString('base64url');
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export function isOpaque(value?: string): value is string {
  return typeof value === 'string' && opaquePattern.test(value);
}

@Injectable()
export class MerchantAuthService {
  private readonly logger = new Logger(MerchantAuthService.name);

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
    let url: URL;
    try {
      url = await this.oidc.authorizationUrl(redirect, state, nonce, verifier);
    } catch (error) {
      this.logFailure(
        error instanceof OidcStageFailure
          ? error.category
          : 'OIDC_AUTHORIZATION_REQUEST_FAILED',
        error,
        error instanceof OidcStageFailure ? error.providerCode : undefined,
      );
      throw new ServiceUnavailableException(
        'Identity provider is unavailable.',
      );
    }
    try {
      await this.database.identityConnection().query(
        `
        INSERT INTO merchant_login_attempts (state_digest, binding_digest, nonce, verifier)
        VALUES ($1, $2, $3, $4)
      `,
        [digest(state), digest(binding), nonce, verifier],
      );
    } catch (error) {
      this.logFailure(
        this.databaseFailureCategory(error),
        error,
        undefined,
        'login_attempt_persist',
      );
      throw new ServiceUnavailableException(
        'Merchant authentication is unavailable.',
      );
    }
    return { url: url.href, binding };
  }

  async finish(query: string, binding?: string, previousSession?: string) {
    const url = new URL(this.settings().redirect);
    url.search = query;
    const states = url.searchParams.getAll('state');
    const state = states[0];
    if (states.length !== 1 || !isOpaque(state)) {
      this.logFailure('OIDC_STATE_INVALID');
      throw new BadRequestException('Invalid or expired login attempt.');
    }
    if (!isOpaque(binding)) {
      this.logFailure('OIDC_BINDING_INVALID');
      throw new BadRequestException('Invalid or expired login attempt.');
    }
    const database = this.database.identityConnection();
    let attempt: { nonce: string; verifier: string } | undefined;
    try {
      [attempt] = await database.query<{ nonce: string; verifier: string }[]>(
        'SELECT * FROM public.kleva_consume_login($1, $2)',
        [digest(state), digest(binding)],
      );
    } catch (error) {
      this.logFailure(
        this.databaseFailureCategory(error),
        error,
        undefined,
        'login_attempt_consume',
      );
      throw new ServiceUnavailableException(
        'Merchant authentication is unavailable.',
      );
    }
    if (!attempt) {
      this.logFailure('OIDC_STATE_INVALID');
      throw new BadRequestException('Invalid or expired login attempt.');
    }

    let identity: Awaited<ReturnType<MerchantOidcClient['verifyCallback']>>;
    try {
      identity = await this.oidc.verifyCallback(
        url,
        state,
        attempt.nonce,
        attempt.verifier,
      );
    } catch (error) {
      this.logFailure(
        error instanceof OidcStageFailure
          ? error.category
          : 'OIDC_CALLBACK_VALIDATION_FAILED',
        error,
        error instanceof OidcStageFailure ? error.providerCode : undefined,
      );
      throw new UnauthorizedException('Identity provider verification failed.');
    }
    const session = token();
    const csrf = token();
    try {
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
    } catch (error) {
      this.logFailure(
        this.databaseFailureCategory(error),
        error,
        undefined,
        'session_create',
      );
      throw new ServiceUnavailableException(
        'Merchant session could not be created.',
      );
    }
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

  private databaseFailureCategory(error: unknown) {
    return errorCode(error) === '42501'
      ? 'OIDC_DATABASE_PERMISSION_DENIED'
      : 'OIDC_DATABASE_OPERATION_FAILED';
  }

  private logFailure(
    category: string,
    error?: unknown,
    providerCode?: string,
    stage?: string,
  ) {
    const code = errorCode(error);
    const pgCategory = postgresErrorCategory(error);
    this.logger.error({
      event: 'merchant_auth.failure',
      category,
      ...(code ? { errorCode: code } : {}),
      ...(pgCategory ? { databaseCategory: pgCategory } : {}),
      ...(providerCode ? { providerCode } : {}),
      ...(stage ? { stage } : {}),
    });
  }
}

export type MerchantPrincipal = Awaited<
  ReturnType<MerchantAuthService['authenticate']>
>;
