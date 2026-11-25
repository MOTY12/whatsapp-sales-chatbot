import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import {
  maxExecutionAttempts,
  OutboxStore,
  PermanentJobFailure,
} from '../jobs/outbox.store';
import { errorCode, postgresErrorCategory } from '../config/logging';
import type { OutboxOperation } from '../database/entities/outbox-operation.entity';
import { EMAIL_CONFIG, type EmailConfig } from './email.config';
import {
  EMAIL_PROVIDER,
  MailjetDeliveryError,
  type EmailProvider,
} from './providers/mailjet.provider';
import {
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
  welcomeEmail,
  teamInvitationEmail,
  type TransactionalEmail,
} from './templates/transactional-email';

type EmailKind =
  | 'verification'
  | 'password_reset'
  | 'password_changed'
  | 'welcome'
  | 'team_invitation';
type EmailPayload = {
  kind: EmailKind;
  to: string;
  name: string;
  token?: string;
  businessName?: string;
  role?: 'editor' | 'agent';
  expiresAt?: string;
};
type StoredPayload = { iv: string; tag: string; data: string };

export class PermanentEmailFailure extends PermanentJobFailure {}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(EMAIL_CONFIG) private readonly config: EmailConfig,
    @InjectDataSource() private readonly database: DataSource,
    private readonly outbox: OutboxStore,
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
  ) {}

  sendVerification(to: string, name: string, token: string) {
    return this.enqueue('verification', to, name, token);
  }

  sendPasswordReset(to: string, name: string, token: string) {
    return this.enqueue('password_reset', to, name, token);
  }

  sendPasswordChanged(to: string, name: string) {
    return this.enqueue('password_changed', to, name);
  }

  sendWelcome(to: string, name: string) {
    return this.enqueue('welcome', to, name);
  }

  sendTeamInvitation(
    to: string,
    businessName: string,
    role: 'editor' | 'agent',
    token: string,
    expiresAt: Date,
  ) {
    return this.enqueue('team_invitation', to, 'there', token, {
      businessName,
      role,
      expiresAt: expiresAt.toISOString(),
    });
  }

  async execute(operation: Readonly<OutboxOperation>): Promise<void> {
    const deliveryId = operation.metadata?.deliveryId;
    if (!deliveryId || !/^[0-9a-f-]{36}$/i.test(deliveryId))
      throw new PermanentEmailFailure('Invalid email delivery reference.');
    const [row] = await this.database.query<
      Array<{ encrypted_payload: Buffer; status: string }>
    >(
      'SELECT encrypted_payload, status FROM public.merchant_email_deliveries WHERE id = $1',
      [deliveryId],
    );
    if (!row)
      throw new PermanentEmailFailure('Email delivery record not found.');
    if (row.status === 'ACCEPTED' || row.status === 'FAILED') return;

    let payload: EmailPayload;
    try {
      payload = this.decrypt(row.encrypted_payload);
      this.validatePayload(payload);
    } catch {
      await this.failDelivery(deliveryId, 'PAYLOAD_INVALID');
      throw new PermanentEmailFailure('Email delivery payload is invalid.');
    }

    this.logger.log({
      event: 'merchant_email.delivery_attempt',
      kind: payload.kind,
      attempt: operation.attempts,
    });
    try {
      const providerId = await this.provider.send(
        deliveryId,
        payload.to,
        this.render(payload),
      );
      await this.database.query(
        `UPDATE public.merchant_email_deliveries SET status = 'ACCEPTED',
          provider_message_id = $2, encrypted_payload = ''::bytea,
          error_class = NULL, "updatedAt" = now() WHERE id = $1 AND status = 'PENDING'`,
        [deliveryId, providerId],
      );
      this.logger.log({
        event: 'merchant_email.accepted_by_provider',
        kind: payload.kind,
      });
    } catch (error) {
      if (
        error instanceof MailjetDeliveryError &&
        error.category === 'permanent'
      ) {
        await this.failDelivery(
          deliveryId,
          error.status === 401
            ? 'PROVIDER_AUTH'
            : error.status === 403
              ? 'SENDER_REJECTED'
              : 'REQUEST_REJECTED',
        );
        throw new PermanentEmailFailure(
          'Mailjet permanently rejected the email.',
        );
      }
      if (operation.attempts >= maxExecutionAttempts) {
        await this.failDelivery(deliveryId, 'RETRIES_EXHAUSTED');
        throw new PermanentEmailFailure(
          'Mailjet delivery retry limit was reached.',
        );
      }
      throw error;
    }
  }

  private async enqueue(
    kind: EmailKind,
    to: string,
    name: string,
    token?: string,
    extra: Pick<EmailPayload, 'businessName' | 'role' | 'expiresAt'> = {},
  ) {
    if (!this.config.enabled)
      throw new ServiceUnavailableException(
        'Email authentication is temporarily unavailable.',
      );
    const email = to.trim().toLowerCase();
    const safeName = name.trim().replace(/\s+/g, ' ');
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      !safeName ||
      safeName.length > 160
    )
      throw new ServiceUnavailableException(
        'Email authentication is temporarily unavailable.',
      );
    if ((kind === 'verification' || kind === 'password_reset') && !token)
      throw new Error('Token email requires a one-time token.');

    const operationKey = createHash('sha256')
      .update(`${kind}:${token ?? randomUUID()}`)
      .digest('hex');
    const id = randomUUID();
    const encrypted = this.encrypt({
      kind,
      to: email,
      name: safeName,
      ...(token ? { token } : {}),
      ...extra,
    });
    try {
      await this.database.transaction(async (manager) => {
        await manager.query(
          `INSERT INTO public.merchant_email_deliveries(id, operation_key, encrypted_payload)
           VALUES ($1, $2, $3) ON CONFLICT (operation_key) DO NOTHING`,
          [id, operationKey, encrypted],
        );
        const [existing] = await manager.query<Array<{ id: string }>>(
          'SELECT id FROM public.merchant_email_deliveries WHERE operation_key = $1 FOR UPDATE',
          [operationKey],
        );
        if (!existing) throw new Error('Email delivery enqueue failed.');
        await this.outbox.write(manager, {
          id: existing.id,
          operation: 'merchant.email',
          metadata: { deliveryId: existing.id },
        });
      });
    } catch (error) {
      const code = errorCode(error);
      this.logger.error({
        event: 'merchant_email.enqueue_failed',
        ...(code
          ? {
              databaseErrorCode: code,
              databaseCategory: postgresErrorCategory(error),
            }
          : { category: 'outbox_transaction_failed' }),
      });
      throw new ServiceUnavailableException(
        'Email authentication is temporarily unavailable.',
      );
    }
    return { queued: true as const, status: 'queued' as const };
  }

  private render(payload: EmailPayload): TransactionalEmail {
    if (payload.kind === 'verification')
      return verificationEmail(
        payload.name,
        this.link('/verify-email', payload.token!),
      );
    if (payload.kind === 'password_reset')
      return passwordResetEmail(
        payload.name,
        this.link('/reset-password', payload.token!),
      );
    if (payload.kind === 'welcome')
      return welcomeEmail(
        payload.name,
        new URL('/onboarding', this.config.frontendUrl).href,
      );
    if (payload.kind === 'team_invitation')
      return teamInvitationEmail(
        payload.businessName!,
        payload.role!,
        this.link('/invite/consume', payload.token!),
        new Date(payload.expiresAt!),
      );
    return passwordChangedEmail(payload.name);
  }

  private link(path: string, token: string) {
    const url = new URL(path, this.config.frontendUrl);
    url.searchParams.set('token', token);
    return url.href;
  }

  private encrypt(payload: EmailPayload): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.config.encryptionKey, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(payload)),
      cipher.final(),
    ]);
    return Buffer.from(
      JSON.stringify({
        iv: iv.toString('base64url'),
        tag: cipher.getAuthTag().toString('base64url'),
        data: data.toString('base64url'),
      } satisfies StoredPayload),
    );
  }

  private decrypt(encoded: Buffer): EmailPayload {
    const stored = JSON.parse(encoded.toString('utf8')) as StoredPayload;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.config.encryptionKey,
      Buffer.from(stored.iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64url'));
    const data = Buffer.concat([
      decipher.update(Buffer.from(stored.data, 'base64url')),
      decipher.final(),
    ]);
    return JSON.parse(data.toString('utf8')) as EmailPayload;
  }

  private validatePayload(payload: EmailPayload) {
    if (
      ![
        'verification',
        'password_reset',
        'password_changed',
        'welcome',
        'team_invitation',
      ].includes(payload.kind) ||
      typeof payload.to !== 'string' ||
      typeof payload.name !== 'string' ||
      ((payload.kind === 'verification' || payload.kind === 'password_reset') &&
        typeof payload.token !== 'string') ||
      (payload.kind === 'team_invitation' &&
        (typeof payload.token !== 'string' ||
          typeof payload.businessName !== 'string' ||
          !['editor', 'agent'].includes(payload.role ?? '') ||
          typeof payload.expiresAt !== 'string'))
    )
      throw new Error('Invalid encrypted email payload.');
  }

  private async failDelivery(id: string, errorClass: string) {
    await this.database.query(
      `UPDATE public.merchant_email_deliveries SET status = 'FAILED', error_class = $2,
        encrypted_payload = ''::bytea, "updatedAt" = now() WHERE id = $1 AND status = 'PENDING'`,
      [id, errorClass],
    );
  }
}
