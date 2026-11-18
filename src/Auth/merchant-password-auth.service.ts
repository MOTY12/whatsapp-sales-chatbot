import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import { MerchantDatabase } from './merchant-database';
import { EMAIL_CONFIG, type EmailConfig } from '../Email/email.config';
import { EmailService } from '../Email/email.service';

const argonOptions = {
  type: argon2.argon2id as 2,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
};
const rawToken = () => randomBytes(32).toString('base64url');
const tokenDigest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const validEmail = (value: string) =>
  value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const weakPasswords = new Set([
  'password1234',
  'password12345',
  'password123456',
  '123456789012',
  'qwerty123456',
  'letmein12345',
  'iloveyou1234',
  'admin123456',
  'welcome12345',
]);

export type PasswordLoginResult = {
  session: string;
  csrf: string;
  nextPath: '/onboarding' | '/dashboard';
};

@Injectable()
export class MerchantPasswordAuthService {
  private readonly logger = new Logger(MerchantPasswordAuthService.name);
  private readonly dummyHash = argon2.hash(
    'not-a-real-merchant-password-' + randomBytes(32).toString('hex'),
    argonOptions,
  );

  constructor(
    private readonly database: MerchantDatabase,
    private readonly email: EmailService,
    @Inject(EMAIL_CONFIG) private readonly config: EmailConfig,
  ) {}

  async register(
    fullName: unknown,
    email: unknown,
    password: unknown,
    remoteAddress: string,
  ) {
    this.requireEnabled();
    const profile = this.validateProfile(fullName, email);
    this.validatePassword(password);
    await this.rateLimit('register_ip', remoteAddress, 10, 3600);
    await this.rateLimit('register_email', profile.email, 5, 3600);

    const verificationToken = rawToken();
    const [created] = await this.database
      .identityConnection()
      .query<{ kleva_register_password: boolean }[]>(
        'SELECT public.kleva_register_password($1,$2,$3,$4,$5) AS kleva_register_password',
        [
          profile.email,
          profile.fullName,
          await argon2.hash(password, argonOptions),
          tokenDigest(verificationToken),
          new Date(Date.now() + 30 * 60_000),
        ],
      );
    if (created?.kleva_register_password) {
      try {
        await this.email.sendVerification(
          profile.email,
          profile.fullName,
          verificationToken,
        );
      } catch {
        // The response stays enumeration-safe; the merchant can request a resend.
        this.logger.warn({
          event: 'merchant_auth.email_enqueue_failed',
          kind: 'verification',
        });
      }
    }
    return {
      message:
        'If registration can proceed, we sent an email with the next step.',
    };
  }

  async login(
    email: unknown,
    password: unknown,
    remoteAddress: string,
    previousSession?: string,
  ): Promise<PasswordLoginResult> {
    this.requireEnabled();
    const normalizedEmail = this.normalizeEmail(email);
    if (typeof password !== 'string' || password.length > 1024)
      throw new UnauthorizedException('Invalid email or password.');
    await this.rateLimit('login_ip', remoteAddress, 20, 900);
    await this.rateLimit('login_email', normalizedEmail, 10, 900);
    const [account] = await this.database.identityConnection().query<
      {
        account_id: string;
        password_hash: string;
        email_verified: boolean;
        account_active: boolean;
      }[]
    >('SELECT * FROM public.kleva_password_account($1)', [normalizedEmail]);
    const encodedHash = account?.password_hash ?? (await this.dummyHash);
    const matches = await argon2
      .verify(encodedHash, password)
      .catch(() => false);
    if (!account || !matches || !account.account_active)
      throw new UnauthorizedException('Invalid email or password.');
    if (!account.email_verified)
      throw new ForbiddenException({
        code: 'email_verification_required',
        message: 'Verify your email address before signing in.',
      });

    const session = rawToken();
    const csrf = rawToken();
    const [created] = await this.database
      .identityConnection()
      .query<{ account_id: string | null }[]>(
        'SELECT public.kleva_create_password_session($1,$2,$3,$4) AS account_id',
        [
          normalizedEmail,
          tokenDigest(session),
          tokenDigest(csrf),
          this.isOpaque(previousSession) ? tokenDigest(previousSession!) : null,
        ],
      );
    if (!created?.account_id)
      throw new UnauthorizedException('Invalid email or password.');
    const [progress] = await this.database
      .identityConnection()
      .query<{ current_step: string }[]>(
        'SELECT * FROM public.kleva_read_onboarding_progress($1)',
        [tokenDigest(session)],
      );
    const memberships = await this.database
      .identityConnection()
      .query<{ businessId: string }[]>(
        'SELECT * FROM public.kleva_list_memberships($1)',
        [tokenDigest(session)],
      );
    return {
      session,
      csrf,
      nextPath:
        memberships.length && progress?.current_step === 'dashboard'
          ? '/dashboard'
          : '/onboarding',
    };
  }

  async verifyEmail(token: unknown, remoteAddress: string) {
    this.requireEnabled();
    const value = this.normalizeToken(token);
    await this.rateLimit('verify_ip', remoteAddress, 20, 3600);
    const [result] = await this.database
      .identityConnection()
      .query<{ verified: boolean }[]>(
        'SELECT public.kleva_verify_email($1) AS verified',
        [tokenDigest(value)],
      );
    return {
      verified: result?.verified === true,
      message:
        result?.verified === true
          ? 'Your email is verified. You can sign in.'
          : 'This verification link is invalid, expired, or already used.',
    };
  }

  async resendVerification(email: unknown, remoteAddress: string) {
    this.requireEnabled();
    const normalizedEmail = this.normalizeEmail(email);
    await this.rateLimit('resend_ip', remoteAddress, 5, 3600);
    await this.rateLimit('resend_email', normalizedEmail, 3, 3600);
    const raw = rawToken();
    const [created] = await this.database
      .identityConnection()
      .query<{ created: boolean }[]>(
        'SELECT public.kleva_create_auth_token($1,$2,$3,$4) AS created',
        [
          normalizedEmail,
          'email_verification',
          tokenDigest(raw),
          new Date(Date.now() + 30 * 60_000),
        ],
      );
    if (created?.created) {
      const [profile] = await this.database
        .identityConnection()
        .query<{ full_name: string }[]>(
          'SELECT full_name FROM public.kleva_auth_profile_for_delivery($1)',
          [normalizedEmail],
        );
      if (profile) {
        try {
          await this.email.sendVerification(
            normalizedEmail,
            profile.full_name,
            raw,
          );
        } catch {
          this.logger.warn({
            event: 'merchant_auth.email_enqueue_failed',
            kind: 'verification',
          });
        }
      }
    }
    return {
      message: 'If the account can be verified, an email has been sent.',
    };
  }

  async requestPasswordReset(email: unknown, remoteAddress: string) {
    this.requireEnabled();
    const normalizedEmail = this.normalizeEmail(email);
    await this.rateLimit('reset_request_ip', remoteAddress, 5, 3600);
    await this.rateLimit('reset_request_email', normalizedEmail, 3, 3600);
    const raw = rawToken();
    const [created] = await this.database
      .identityConnection()
      .query<{ created: boolean }[]>(
        'SELECT public.kleva_create_auth_token($1,$2,$3,$4) AS created',
        [
          normalizedEmail,
          'password_reset',
          tokenDigest(raw),
          new Date(Date.now() + 15 * 60_000),
        ],
      );
    if (created?.created) {
      const [profile] = await this.database
        .identityConnection()
        .query<{ full_name: string }[]>(
          'SELECT full_name FROM public.kleva_auth_profile_for_delivery($1)',
          [normalizedEmail],
        );
      if (profile) {
        try {
          await this.email.sendPasswordReset(
            normalizedEmail,
            profile.full_name,
            raw,
          );
        } catch {
          this.logger.warn({
            event: 'merchant_auth.email_enqueue_failed',
            kind: 'password_reset',
          });
        }
      }
    }
    return {
      message: 'If an account can reset its password, an email has been sent.',
    };
  }

  async resetPassword(
    token: unknown,
    password: unknown,
    remoteAddress: string,
  ) {
    this.requireEnabled();
    const value = this.normalizeToken(token);
    this.validatePassword(password);
    await this.rateLimit('reset_complete_ip', remoteAddress, 10, 3600);
    const [result] = await this.database
      .identityConnection()
      .query<
        { reset: boolean; email: string | null; full_name: string | null }[]
      >('SELECT * FROM public.kleva_reset_password($1,$2)', [
        tokenDigest(value),
        await argon2.hash(password, argonOptions),
      ]);
    if (!result?.reset)
      throw new BadRequestException(
        'This reset link is invalid, expired, or already used.',
      );
    if (result.email && result.full_name) {
      await this.email
        .sendPasswordChanged(result.email, result.full_name)
        .catch(() => {
          this.logger.warn({
            event: 'merchant_auth.email_enqueue_failed',
            kind: 'password_changed',
          });
        });
    }
    return { message: 'Your password has been changed. Sign in again.' };
  }

  async setPassword(sessionDigest: string, password: unknown) {
    this.requireEnabled();
    this.validatePassword(password);
    const [result] = await this.database
      .identityConnection()
      .query<{ saved: boolean }[]>(
        'SELECT public.kleva_set_password($1,$2) AS saved',
        [sessionDigest, await argon2.hash(password, argonOptions)],
      );
    if (!result?.saved)
      throw new UnauthorizedException(
        'A verified merchant session is required.',
      );
    return { message: 'Password authentication is enabled for your account.' };
  }

  private validateProfile(name: unknown, email: unknown) {
    if (typeof name !== 'string')
      throw new BadRequestException('Enter your full name.');
    const fullName = name.trim().replace(/\s+/g, ' ');
    if (!fullName || fullName.length > 160)
      throw new BadRequestException('Full name must be 1–160 characters.');
    return { fullName, email: this.normalizeEmail(email) };
  }

  private normalizeEmail(value: unknown) {
    if (typeof value !== 'string')
      throw new BadRequestException('Enter a valid email address.');
    const normalized = value.trim().toLowerCase();
    if (!validEmail(normalized))
      throw new BadRequestException('Enter a valid email address.');
    return normalized;
  }

  private validatePassword(value: unknown): asserts value is string {
    if (typeof value !== 'string' || value.length < 12 || value.length > 1024)
      throw new BadRequestException(
        'Password must be between 12 and 1024 characters.',
      );
    if (weakPasswords.has(value.toLowerCase()))
      throw new BadRequestException(
        'Choose a password that is not commonly compromised.',
      );
  }

  private normalizeToken(value: unknown) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value))
      throw new BadRequestException('This link is invalid or expired.');
    return value;
  }

  private isOpaque(value?: string) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
  }

  private requireEnabled() {
    if (!this.config.enabled)
      throw new ServiceUnavailableException(
        'Email authentication is not configured.',
      );
  }

  private enabledConfig(): EmailConfig {
    if (!this.config.enabled)
      throw new BadRequestException('Email authentication is not configured.');
    return this.config;
  }

  private async rateLimit(
    action: string,
    key: string,
    max: number,
    seconds: number,
  ) {
    const keyDigest = createHmac('sha256', this.enabledConfig().rateLimitSecret)
      .update(`${action}:${key}`)
      .digest('hex');
    const [result] = await this.database
      .identityConnection()
      .query<{ allowed: boolean }[]>(
        'SELECT public.kleva_auth_rate_limit($1,$2,$3,$4) AS allowed',
        [action, keyDigest, max, seconds],
      );
    if (!result?.allowed)
      throw new HttpException('Try again later.', HttpStatus.TOO_MANY_REQUESTS);
  }
}
