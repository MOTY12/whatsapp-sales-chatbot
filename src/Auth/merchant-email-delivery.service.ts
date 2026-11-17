import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { merchantEmailAuthConfig } from '../config/env';

export const MERCHANT_EMAIL_AUTH_CONFIG = Symbol('MERCHANT_EMAIL_AUTH_CONFIG');
export type MerchantEmailAuthConfig = ReturnType<
  typeof merchantEmailAuthConfig
>;

@Injectable()
export class MerchantEmailDeliveryService {
  private readonly logger = new Logger(MerchantEmailDeliveryService.name);
  private readonly transport?: Transporter;

  constructor(
    @Inject(MERCHANT_EMAIL_AUTH_CONFIG)
    private readonly config: MerchantEmailAuthConfig,
  ) {
    if (config.enabled) {
      this.transport = createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.username, pass: config.password },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
      });
    }
  }

  async sendVerification(email: string, fullName: string, rawToken: string) {
    const link = new URL('/verify-email', this.publicOrigin());
    link.searchParams.set('token', rawToken);
    await this.send({
      to: email,
      subject: 'Verify your Kleva merchant account',
      text: `Hello ${fullName},\n\nVerify your email address to finish creating your Kleva merchant account:\n${link.href}\n\nThis link expires in 30 minutes and can only be used once. If you did not request this, ignore this email.`,
    });
  }

  async sendPasswordReset(email: string, fullName: string, rawToken: string) {
    const link = new URL('/reset-password', this.publicOrigin());
    link.searchParams.set('token', rawToken);
    await this.send({
      to: email,
      subject: 'Reset your Kleva password',
      text: `Hello ${fullName},\n\nUse this link to reset your Kleva password:\n${link.href}\n\nThis link expires in 15 minutes and can only be used once. If you did not request this, ignore this email.`,
    });
  }

  async sendPasswordChanged(email: string, fullName: string) {
    await this.send({
      to: email,
      subject: 'Your Kleva password was changed',
      text: `Hello ${fullName},\n\nThe password for your Kleva merchant account was changed. If you did not make this change, contact Kleva support immediately.`,
    });
  }

  private publicOrigin() {
    if (!this.config.enabled) throw this.unavailable();
    return this.config.publicOrigin;
  }

  private async send(message: { to: string; subject: string; text: string }) {
    if (!this.config.enabled || !this.transport) throw this.unavailable();
    let failure: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.transport.sendMail({
          from: this.config.from,
          ...message,
        });
        return;
      } catch (error) {
        failure = error;
        const safeError =
          error && typeof error === 'object'
            ? (error as { code?: unknown; command?: unknown })
            : undefined;
        const connectionFailure =
          ['ETIMEDOUT', 'ECONNECTION', 'ECONNREFUSED'].includes(
            typeof safeError?.code === 'string' ? safeError.code : '',
          ) &&
          (safeError?.command === undefined || safeError.command === 'CONN');
        if (!connectionFailure || attempt > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    {
      const safeError =
        failure && typeof failure === 'object'
          ? (failure as { code?: unknown; command?: unknown })
          : undefined;
      this.logger.error({
        event: 'merchant_auth.email_delivery_failed',
        category: 'SMTP_DELIVERY_FAILED',
        errorCode:
          typeof safeError?.code === 'string' &&
          /^[A-Z0-9_]{1,40}$/.test(safeError.code)
            ? safeError.code
            : 'UNCLASSIFIED',
        smtpCommand:
          typeof safeError?.command === 'string' &&
          /^[A-Z ]{1,40}$/i.test(safeError.command)
            ? safeError.command
            : undefined,
      });
      throw this.unavailable();
    }
  }

  private unavailable() {
    return new ServiceUnavailableException(
      'Email authentication is temporarily unavailable.',
    );
  }
}
