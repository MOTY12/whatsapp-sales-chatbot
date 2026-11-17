import {
  BadRequestException,
  ConflictException,
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
export type AuthIntent = 'signup' | 'login' | 'link';
export const onboardingSteps = [
  'business_profile',
  'whatsapp',
  'products_faq',
  'ai_assistant',
  'dashboard',
] as const;
export type OnboardingStep = (typeof onboardingSteps)[number];

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

  private oidcRedirect() {
    const redirect = this.settings().redirect;
    if (!redirect)
      throw new ServiceUnavailableException(
        'Google authentication is not configured.',
      );
    return redirect;
  }

  async start(
    intent: AuthIntent = 'login',
    link?: { accountId: string; sessionDigest: string },
  ) {
    if (intent === 'link' && !link)
      throw new BadRequestException('An authenticated session is required.');
    const redirect = this.oidcRedirect();
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
        INSERT INTO merchant_login_attempts
          (state_digest, binding_digest, nonce, verifier, intent, link_account_id, link_session_digest)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
        [
          digest(state),
          digest(binding),
          nonce,
          verifier,
          intent,
          link?.accountId ?? null,
          link?.sessionDigest ?? null,
        ],
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
    const url = new URL(this.oidcRedirect());
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
    let attempt:
      | {
          nonce: string;
          verifier: string;
          intent: AuthIntent;
          link_account_id: string | null;
          link_session_digest: string | null;
        }
      | undefined;
    try {
      [attempt] = await database.query<
        {
          nonce: string;
          verifier: string;
          intent: AuthIntent;
          link_account_id: string | null;
          link_session_digest: string | null;
        }[]
      >('SELECT * FROM public.kleva_consume_auth_attempt($1, $2)', [
        digest(state),
        digest(binding),
      ]);
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
    let completed:
      | {
          account_id: string | null;
          outcome: string;
          has_business: boolean;
          current_step: OnboardingStep | 'business_profile' | null;
        }
      | undefined;
    try {
      [completed] = await database.query<
        {
          account_id: string | null;
          outcome: string;
          has_business: boolean;
          current_step: OnboardingStep | 'business_profile' | null;
        }[]
      >(
        'SELECT * FROM public.kleva_complete_oidc_auth_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          identity.issuer,
          identity.subject,
          identity.email ?? null,
          identity.fullName ?? null,
          identity.emailVerified,
          digest(session),
          digest(csrf),
          isOpaque(previousSession) ? digest(previousSession) : null,
          attempt.intent,
          attempt.link_account_id,
          attempt.link_session_digest,
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
    if (completed?.outcome === 'account_not_found') {
      throw new UnauthorizedException({
        code: 'merchant_account_not_found',
        message: 'No merchant account found. Please create an account.',
      });
    }
    if (completed?.outcome === 'account_exists') {
      throw new ConflictException({
        code: 'merchant_account_exists',
        message: 'An account already exists. Please sign in.',
      });
    }
    if (completed?.outcome === 'invalid_link_session') {
      this.logFailure('OIDC_LINK_SESSION_INVALID');
      throw new UnauthorizedException(
        'Sign in again before connecting Google to this account.',
      );
    }
    if (
      completed?.outcome === 'identity_conflict' ||
      completed?.outcome === 'identity_already_linked'
    ) {
      throw new ConflictException({
        code: 'identity_already_linked',
        message:
          'This Google account is already connected to a merchant account.',
      });
    }
    if (completed?.outcome === 'verified_profile_required') {
      throw new UnauthorizedException({
        code: 'google_email_unverified',
        message:
          'Google did not provide a verified email address for registration.',
      });
    }
    if (completed?.outcome !== 'authenticated' || !completed.account_id) {
      this.logger.error({
        event: 'merchant_auth.failure',
        category: 'OIDC_COMPLETION_OUTCOME_INVALID',
        outcome: completed?.outcome ?? 'missing',
      });
      throw new ServiceUnavailableException(
        'Merchant authentication is unavailable.',
      );
    }
    return {
      session,
      csrf,
      nextPath:
        attempt.intent === 'signup' ||
        !completed.has_business ||
        completed.current_step !== 'dashboard'
          ? '/onboarding'
          : '/dashboard',
    };
  }

  async onboarding(sessionDigest: string) {
    try {
      const [progress] = await this.database.identityConnection().query<
        {
          current_step: OnboardingStep;
          completed_steps: string[];
          updated_at: Date | string;
        }[]
      >('SELECT * FROM public.kleva_read_onboarding_progress($1)', [sessionDigest]);
      if (!progress) throw new UnauthorizedException();
      return progress;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logFailure(
        this.databaseFailureCategory(error),
        error,
        undefined,
        'onboarding_read',
      );
      throw new ServiceUnavailableException(
        'Onboarding progress is unavailable.',
      );
    }
  }

  async updateOnboarding(sessionDigest: string, step: unknown) {
    if (
      typeof step !== 'string' ||
      !onboardingSteps.includes(step as OnboardingStep)
    ) {
      throw new BadRequestException('Choose a valid onboarding step.');
    }
    try {
      const [result] = await this.database
        .identityConnection()
        .query<{ updated: boolean }[]>(
          'SELECT public.kleva_set_onboarding_step($1, $2) AS updated',
          [sessionDigest, step],
        );
      if (!result?.updated) throw new UnauthorizedException();
      return await this.onboarding(sessionDigest);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logFailure(
        this.databaseFailureCategory(error),
        error,
        undefined,
        'onboarding_update',
      );
      throw new ServiceUnavailableException(
        'Onboarding progress could not be saved.',
      );
    }
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
