import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AssistantService } from '../assistant/assistant.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import type { OutboxOperation } from '../database/entities/outbox-operation.entity';
import { OutboundMessageService } from './outbound-message.service';
import type { IncomingWhatsAppMessage } from './types/whatsapp.types';

export const whatsappResponseOperation = 'whatsapp.response';

type IntentRow = {
  id: string;
  business_id: string;
  response_kind: 'owner_command' | 'legacy_onboarding';
  status: string;
  response_text: string | null;
  sender: string;
  message_text: string;
  message_id: string;
  occurred_at: Date | null;
  owner_id: string | null;
  timezone: string | null;
};

@Injectable()
export class WhatsAppResponseIntentDispatcher {
  private readonly logger = new Logger(WhatsAppResponseIntentDispatcher.name);

  constructor(
    @InjectDataSource() private readonly database: DataSource,
    private readonly assistant: AssistantService,
    private readonly onboarding: OnboardingService,
    private readonly outbound: OutboundMessageService,
  ) {}

  async execute(operation: Readonly<OutboxOperation>): Promise<void> {
    const intentId = operation.metadata.responseIntentId;
    if (!operation.businessId || intentId !== operation.id)
      throw new Error('Invalid WhatsApp response operation.');
    const [row] = await this.database.query<IntentRow[]>(
      `SELECT i.id, i.business_id, i.response_kind, i.status, i.response_text,
          r.payload->>'senderId' AS sender, m.content AS message_text, m.id AS message_id,
          CASE WHEN r.payload->>'occurredAt' ~ '^\\d+$'
            THEN to_timestamp((r.payload->>'occurredAt')::double precision / 1000)
            ELSE NULLIF(r.payload->>'occurredAt','')::timestamptz END AS occurred_at,
          bm."legacyUserId" AS owner_id, b.timezone
        FROM public.whatsapp_response_intents i
        JOIN public.webhook_receipts r ON r.id = i.receipt_id AND r.business_id = i.business_id
        JOIN public.messages m ON m.id = i.message_id AND m."businessId" = i.business_id
        JOIN public.businesses b ON b.id = i.business_id
        LEFT JOIN public.business_members bm ON bm."businessId" = i.business_id
          AND bm."verifiedWhatsappId" = r.payload->>'senderId' AND bm.role = 'owner' AND bm.status = 'active'
        WHERE i.id = $1 AND i.business_id = $2`,
      [intentId, operation.businessId],
    );
    if (!row) throw new Error('WhatsApp response intent is unavailable.');
    if (['QUEUED', 'COMPLETED', 'FAILED', 'UNCERTAIN'].includes(row.status))
      return;

    let response = row.response_text;
    if (!response) {
      if (row.status === 'GENERATING') {
        await this.database.query(
          `UPDATE public.whatsapp_response_intents SET status = 'FAILED', updated_at = now()
            WHERE id = $1 AND business_id = $2 AND status = 'GENERATING'`,
          [row.id, row.business_id],
        );
        this.logger.error({
          event: 'whatsapp.response_generation_interrupted',
          businessId: row.business_id,
          responseIntentId: row.id,
        });
        return;
      }
      const [claimed] = await this.database.query<{ id: string }[]>(
        `UPDATE public.whatsapp_response_intents SET status = 'GENERATING', updated_at = now()
          WHERE id = $1 AND business_id = $2 AND status = 'PENDING' RETURNING id`,
        [row.id, row.business_id],
      );
      if (!claimed) return;
      const incoming: IncomingWhatsAppMessage = {
        from: row.sender,
        message: row.message_text,
        type: 'text',
        providerMessageId: row.message_id,
        timestamp: row.occurred_at ?? undefined,
      };
      const generated =
        row.response_kind === 'owner_command'
          ? await this.generateOwnerResponse(row, incoming)
          : await this.onboarding.handleIncomingMessage(incoming);
      response = generated.message;
      await this.database.query(
        `UPDATE public.whatsapp_response_intents SET response_text = $3, status = 'GENERATED', updated_at = now()
          WHERE id = $1 AND business_id = $2 AND status = 'GENERATING'`,
        [row.id, row.business_id, response],
      );
    }

    await this.outbound.queueGeneratedIntent(
      row.id,
      row.business_id,
      row.sender,
      response,
    );
  }

  private generateOwnerResponse(
    row: IntentRow,
    message: IncomingWhatsAppMessage,
  ) {
    if (!row.owner_id)
      throw new Error('Owner response has no legacy assistant account.');
    return this.assistant.handleIncomingMessage(message, {
      businessId: row.business_id,
      ownerId: row.owner_id,
      timezone: row.timezone ?? 'UTC',
    });
  }
}
