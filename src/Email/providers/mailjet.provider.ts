import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TransactionalEmail } from '../templates/transactional-email';
import { EMAIL_CONFIG, type EmailConfig } from '../email.config';

export class MailjetDeliveryError extends Error {
  constructor(
    readonly category: 'permanent' | 'transient',
    readonly status?: number,
  ) {
    super('Mailjet did not accept the email request.');
  }
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
export interface EmailProvider {
  send(
    deliveryId: string,
    recipient: string,
    message: TransactionalEmail,
  ): Promise<string>;
}

@Injectable()
export class MailjetProvider implements EmailProvider {
  private readonly logger = new Logger(MailjetProvider.name);

  constructor(@Inject(EMAIL_CONFIG) private readonly config: EmailConfig) {}

  async send(
    deliveryId: string,
    recipient: string,
    message: TransactionalEmail,
  ): Promise<string> {
    const response = await fetch('https://api.mailjet.com/v3.1/send', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Basic ${Buffer.from(`${this.config.apiKey}:${this.config.secretKey}`).toString('base64')}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        Messages: [
          {
            From: {
              Email: this.config.senderEmail,
              Name: this.config.senderName,
            },
            To: [{ Email: recipient }],
            Subject: message.subject,
            TextPart: message.text,
            HTMLPart: message.html,
            CustomID: deliveryId,
          },
        ],
      }),
    }).catch(() => {
      throw new MailjetDeliveryError('transient');
    });

    const body = (await response.json().catch(() => null)) as {
      Messages?: Array<{
        Status?: string;
        To?: Array<{ MessageID?: number | string }>;
      }>;
    } | null;
    if (!response.ok) {
      const permanent = [400, 401, 403].includes(response.status);
      this.logger.warn({
        event: 'merchant_email.mailjet_rejected',
        status: response.status,
        category: permanent ? 'permanent' : 'transient',
      });
      throw new MailjetDeliveryError(
        permanent ? 'permanent' : 'transient',
        response.status,
      );
    }
    const firstMessage = body?.Messages?.[0];
    const providerId = firstMessage?.To?.[0]?.MessageID;
    if (firstMessage?.Status !== 'success' || !providerId) {
      this.logger.warn({
        event: 'merchant_email.mailjet_response_invalid',
        status: response.status,
      });
      throw new MailjetDeliveryError('transient', response.status);
    }
    return String(providerId).slice(0, 100);
  }
}
