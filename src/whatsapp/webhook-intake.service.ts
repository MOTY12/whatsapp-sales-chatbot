import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { WhatsAppChannelAdapter } from '../channels/adapters/whatsapp/whatsapp.adapter';
import { ChannelConnectionService } from '../channels/channel-connection.service';
import { OutboxStore } from '../jobs/outbox.store';
import { whatsappReceiptOperation } from './webhook-receipt.handler';

@Injectable()
export class WhatsAppWebhookIntake {
  constructor(
    private readonly database: DataSource,
    private readonly adapter: WhatsAppChannelAdapter,
    private readonly channels: ChannelConnectionService,
    private readonly outbox: OutboxStore,
  ) {}

  async accept(body: unknown): Promise<void> {
    if (
      !body ||
      typeof body !== 'object' ||
      !('object' in body) ||
      body.object !== 'whatsapp_business_account' ||
      !('entry' in body) ||
      !Array.isArray(body.entry)
    ) {
      throw new BadRequestException('Invalid WhatsApp webhook envelope.');
    }
    const events = this.adapter
      .normalize(body)
      .filter(
        (event) =>
          /^[^\s\p{Cc}]{1,255}$/u.test(event.externalMessageId) &&
          (event.kind === 'delivery' ||
            (/^\d{1,32}$/.test(event.externalSenderId) &&
              !event.text.includes('\0'))),
      );
    if (events.length > 500)
      throw new BadRequestException('Too many webhook events.');
    if (!events.length) return;

    try {
      await this.database.transaction(async (manager) => {
        const routes = new Map<
          string,
          Awaited<ReturnType<ChannelConnectionService['resolve']>>
        >();
        // Stable acquisition order for batches containing overlapping events.
        const batch = events
          .map((event) => ({
            event,
            key:
              event.kind === 'message'
                ? 'message:' + event.externalMessageId
                : 'delivery:' + event.status + ':' + event.externalMessageId,
          }))
          .sort((a, b) =>
            (a.event.externalAssetId + ':' + a.key).localeCompare(
              b.event.externalAssetId + ':' + b.key,
            ),
          );
        for (const { event, key } of batch) {
          if (!routes.has(event.externalAssetId)) {
            routes.set(
              event.externalAssetId,
              await this.channels.resolve(event, manager),
            );
          }
          const route = routes.get(event.externalAssetId);
          if (
            !route?.connectionId ||
            !event.externalAccountId ||
            route.externalAccountId !== event.externalAccountId
          )
            continue;
          const id = randomUUID();
          const payload =
            event.kind === 'message'
              ? {
                  messageId: event.externalMessageId,
                  senderId: event.externalSenderId,
                  text: event.text,
                  occurredAt: event.occurredAt,
                }
              : {
                  messageId: event.externalMessageId,
                  status: event.status,
                  code: event.error?.code,
                  occurredAt: event.occurredAt,
                };
          const inserted = await manager.query<{ id: string }[]>(
            `
            INSERT INTO public.webhook_receipts (id, provider, connection_id, business_id, event_key, event_type, payload)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT ON CONSTRAINT "UQ_webhook_event" DO NOTHING RETURNING id
          `,
            [
              id,
              event.provider,
              route.connectionId,
              route.businessId,
              key,
              event.kind,
              JSON.stringify(payload),
            ],
          );
          if (inserted.length) {
            await this.outbox.write(manager, {
              id,
              businessId: route.businessId,
              operation: whatsappReceiptOperation,
              metadata: { receiptId: id },
            });
          }
        }
      });
    } catch {
      throw new ServiceUnavailableException(
        'WhatsApp intake could not commit.',
      );
    }
  }
}
