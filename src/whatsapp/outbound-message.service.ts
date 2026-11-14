import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { OutboxStore } from '../jobs/outbox.store';
import { UsageService } from '../metering/usage.service';
import type { WhatsAppCloudApiClient } from './interfaces/whatsapp-cloud-api-client.interface';
import { WHATSAPP_CLOUD_API_CLIENT } from './interfaces/whatsapp-cloud-api-client.interface';
import type { OutgoingWhatsAppMessage } from './types/whatsapp.types';
import type { OutboxOperation } from '../database/entities/outbox-operation.entity';

export const whatsappOutboundOperation = 'whatsapp.outbound';
const serviceWindowMs = 24 * 60 * 60 * 1000;

type OutboundRow = {
  id: string;
  business_id: string;
  connection_id: string;
  conversation_id: string | null;
  message_id: string;
  recipient_whatsapp_id: string;
  content: string;
  idempotency_key: string;
  status: string;
  provider_message_id: string | null;
  attempt_count: number;
  response_intent_id: string | null;
};

export class OutboundPolicyError extends Error {}

@Injectable()
export class OutboundMessageService {
  private readonly logger = new Logger(OutboundMessageService.name);

  constructor(
    @InjectDataSource() private readonly database: DataSource,
    private readonly outbox: OutboxStore,
    private readonly usage: UsageService,
    @Inject(WHATSAPP_CLOUD_API_CLIENT)
    private readonly cloud: WhatsAppCloudApiClient,
  ) {}

  async enqueueTextMessage(
    businessId: string,
    message: OutgoingWhatsAppMessage,
    idempotencyKey: string = randomUUID(),
    responseIntentId?: string,
  ): Promise<string> {
    const recipient = message.to.replace(/\D/g, '');
    if (
      !/^[0-9]{1,32}$/.test(recipient) ||
      message.message.length < 1 ||
      message.message.length > 4096
    ) {
      throw new OutboundPolicyError('Invalid recipient or text message.');
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        idempotencyKey,
      )
    ) {
      throw new OutboundPolicyError('Invalid outbound idempotency key.');
    }
    const [prior] = await this.database.query<
      { id: string; content: string; recipient_whatsapp_id: string }[]
    >(
      `SELECT id, content, recipient_whatsapp_id FROM public.whatsapp_outbound_messages
        WHERE business_id = $1 AND idempotency_key = $2`,
      [businessId, idempotencyKey],
    );
    if (prior) {
      if (
        prior.content !== message.message ||
        prior.recipient_whatsapp_id !== recipient
      ) {
        throw new OutboundPolicyError(
          'Outbound idempotency key is already bound to another message.',
        );
      }
      return prior.id;
    }
    const route = await this.validateRoute(businessId);
    const conversationId = await this.validateWindow(businessId, recipient);
    await this.usage.reserveWhatsAppMessage(businessId, idempotencyKey);
    const id = randomUUID();

    await this.database.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`outbound:${businessId}:${idempotencyKey}`],
      );
      const [existing] = await manager.query<
        { id: string; content: string; recipient_whatsapp_id: string }[]
      >(
        `SELECT id, content, recipient_whatsapp_id FROM public.whatsapp_outbound_messages
          WHERE business_id = $1 AND idempotency_key = $2`,
        [businessId, idempotencyKey],
      );
      if (existing) {
        if (
          existing.content !== message.message ||
          existing.recipient_whatsapp_id !== recipient
        ) {
          throw new OutboundPolicyError(
            'Outbound idempotency key is already bound to another message.',
          );
        }
        return;
      }
      await this.outbox.write(manager, {
        id,
        businessId,
        operation: whatsappOutboundOperation,
        metadata: { outboundMessageId: id },
      });
      const [messageRow] = await manager.query<{ id: string }[]>(
        `INSERT INTO public.messages ("businessId", "conversationId", direction, content, status, metadata)
         VALUES ($1,$2,'outbound',$3,'pending',$4) RETURNING id`,
        [
          businessId,
          conversationId,
          message.message,
          JSON.stringify({ source: 'whatsapp', outboundId: id }),
        ],
      );
      await manager.query(
        `INSERT INTO public.whatsapp_outbound_messages
          (id, business_id, connection_id, conversation_id, message_id, recipient_whatsapp_id,
           content, idempotency_key, usage_idempotency_key, status, response_intent_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'RESERVED',$10)
         ON CONFLICT (business_id, idempotency_key) DO NOTHING`,
        [
          id,
          businessId,
          route.connection_id,
          conversationId,
          messageRow?.id ?? null,
          recipient,
          message.message,
          idempotencyKey,
          idempotencyKey,
          responseIntentId ?? null,
        ],
      );
      if (!messageRow) {
        throw new OutboundPolicyError(
          'Outbound idempotency key is already bound to another message.',
        );
      }
    });
    return id;
  }

  async execute(operation: Readonly<OutboxOperation>): Promise<void> {
    const messageId = operation.metadata.outboundMessageId;
    if (!operation.businessId || messageId !== operation.id)
      throw new Error('Invalid outbound operation.');
    const [row] = await this.database.query<OutboundRow[]>(
      `SELECT * FROM public.whatsapp_outbound_messages WHERE id = $1 AND business_id = $2`,
      [messageId, operation.businessId],
    );
    if (!row) throw new Error('Outbound message is unavailable.');
    if (
      ['ACCEPTED', 'DELIVERED', 'READ', 'FAILED', 'UNCERTAIN'].includes(
        row.status,
      )
    ) {
      const usageStatus =
        row.status === 'FAILED'
          ? 'failed'
          : row.status === 'UNCERTAIN'
            ? 'unknown'
            : 'accepted';
      await this.usage.reconcileWhatsAppStatus(
        row.business_id,
        row.idempotency_key,
        usageStatus,
      );
      return;
    }
    if (row.status === 'SENDING') {
      await this.setTerminal(row, 'UNCERTAIN', 'WORKER_RESTART_DURING_SEND');
      return;
    }
    if (row.status !== 'RESERVED')
      throw new Error('Outbound message has an invalid state.');

    const [claimed] = await this.database.query<OutboundRow[]>(
      `UPDATE public.whatsapp_outbound_messages SET status = 'SENDING',
         attempt_count = attempt_count + 1, updated_at = now()
        WHERE id = $1 AND business_id = $2 AND status = 'RESERVED' RETURNING *`,
      [row.id, row.business_id],
    );
    if (!claimed) return;

    let providerMessageId: string | null;
    try {
      await this.validateRoute(row.business_id, row.connection_id);
      await this.validateWindow(
        row.business_id,
        row.recipient_whatsapp_id,
        row.conversation_id,
      );
      providerMessageId = await this.cloud.sendTextMessage(
        { to: row.recipient_whatsapp_id, message: row.content },
        row.business_id,
      );
    } catch (error) {
      const definite =
        error instanceof OutboundPolicyError ||
        Boolean(
          error &&
          typeof error === 'object' &&
          'definitive' in error &&
          (error as { definitive?: unknown }).definitive === true,
        );
      await this.setTerminal(
        row,
        definite ? 'FAILED' : 'UNCERTAIN',
        definite ? 'PROVIDER_REJECTED' : 'PROVIDER_OUTCOME_UNKNOWN',
      );
      return;
    }
    await this.database.query(
      `UPDATE public.whatsapp_outbound_messages SET status = 'ACCEPTED',
         provider_message_id = $3, last_error = NULL, updated_at = now()
        WHERE id = $1 AND business_id = $2 AND status = 'SENDING'`,
      [row.id, row.business_id, providerMessageId],
    );
    await this.database.query(
      `UPDATE public.messages SET status = 'sent', "whatsappMessageId" = $3
        WHERE id = $1 AND "businessId" = $2`,
      [row.message_id, row.business_id, providerMessageId],
    );
    await this.usage.reconcileWhatsAppStatus(
      row.business_id,
      row.idempotency_key,
      'accepted',
    );
    await this.markResponseIntent(row, 'QUEUED');
    if (providerMessageId)
      await this.reconcileUnmatchedStatuses(row.business_id, providerMessageId);
    this.logger.log({
      event: 'whatsapp.outbound_accepted',
      businessId: row.business_id,
      outboundId: row.id,
    });
  }

  async reconcileProviderStatus(
    businessId: string,
    providerMessageId: string,
    status: string,
  ): Promise<boolean> {
    const [row] = await this.database.query<OutboundRow[]>(
      `SELECT * FROM public.whatsapp_outbound_messages
        WHERE business_id = $1 AND provider_message_id = $2 FOR UPDATE`,
      [businessId, providerMessageId],
    );
    if (!row) return false;
    const next =
      status === 'read'
        ? 'READ'
        : status === 'delivered'
          ? 'DELIVERED'
          : status === 'sent'
            ? 'ACCEPTED'
            : 'FAILED';
    const precedence: Record<string, number> = {
      RESERVED: 0,
      SENDING: 1,
      UNCERTAIN: 1,
      ACCEPTED: 2,
      FAILED: 2,
      DELIVERED: 3,
      READ: 4,
    };
    if (precedence[row.status] >= precedence[next]) return true;
    await this.database.query(
      `UPDATE public.whatsapp_outbound_messages SET status = $3, updated_at = now()
        WHERE id = $1 AND business_id = $2`,
      [row.id, businessId, next],
    );
    await this.database.query(
      `UPDATE public.messages SET status = CASE WHEN $3 = 'READ' THEN 'read'
          WHEN $3 = 'DELIVERED' THEN 'delivered' WHEN $3 = 'FAILED' THEN 'failed' ELSE 'sent' END
        WHERE id = $1 AND "businessId" = $2`,
      [row.message_id, businessId, next],
    );
    await this.usage.reconcileWhatsAppStatus(
      businessId,
      row.idempotency_key,
      status,
    );
    await this.markResponseIntent(row, next);
    return true;
  }

  async markGeneratedIntent(intentId: string, response: string): Promise<void> {
    await this.database.query(
      `UPDATE public.whatsapp_response_intents SET response_text = $2, status = 'GENERATED', updated_at = now()
        WHERE id = $1 AND status = 'GENERATING'`,
      [intentId, response],
    );
  }

  async queueGeneratedIntent(
    intentId: string,
    businessId: string,
    recipient: string,
    response: string,
  ): Promise<void> {
    const outboundId = await this.enqueueTextMessage(
      businessId,
      { to: recipient, message: response },
      intentId,
      intentId,
    );
    await this.database.query(
      `UPDATE public.whatsapp_response_intents SET outbound_message_id = $3, status = 'QUEUED', updated_at = now()
        WHERE id = $1 AND business_id = $2 AND status IN ('GENERATED','QUEUED')`,
      [intentId, businessId, outboundId],
    );
  }

  private async markResponseIntent(row: OutboundRow, status: string) {
    if (!row.response_intent_id) return;
    const next = ['FAILED', 'UNCERTAIN'].includes(status)
      ? status
      : status === 'READ' || status === 'DELIVERED' || status === 'ACCEPTED'
        ? 'COMPLETED'
        : 'QUEUED';
    await this.database.query(
      `UPDATE public.whatsapp_response_intents SET status = $3, updated_at = now()
        WHERE id = $1 AND business_id = $2 AND status <> 'FAILED'`,
      [row.response_intent_id, row.business_id, next],
    );
  }

  private async reconcileUnmatchedStatuses(
    businessId: string,
    providerMessageId: string,
  ) {
    const pending = await this.database.query<
      { id: string; provider_status: string }[]
    >(
      `SELECT id, provider_status FROM public.whatsapp_unmatched_statuses
        WHERE business_id = $1 AND provider_message_id = $2 AND reconciled_at IS NULL
        ORDER BY occurred_at NULLS LAST, received_at, id`,
      [businessId, providerMessageId],
    );
    for (const status of pending) {
      await this.reconcileProviderStatus(
        businessId,
        providerMessageId,
        status.provider_status,
      );
      await this.database.query(
        `UPDATE public.whatsapp_unmatched_statuses SET reconciled_at = now() WHERE id = $1 AND business_id = $2`,
        [status.id, businessId],
      );
    }
  }

  private async setTerminal(
    row: OutboundRow,
    status: 'FAILED' | 'UNCERTAIN',
    classification: string,
  ) {
    await this.database.query(
      `UPDATE public.whatsapp_outbound_messages SET status = $3, last_error = $4, updated_at = now()
        WHERE id = $1 AND business_id = $2 AND status IN ('RESERVED','SENDING')`,
      [row.id, row.business_id, status, classification],
    );
    await this.usage.reconcileWhatsAppStatus(
      row.business_id,
      row.idempotency_key,
      status === 'FAILED' ? 'failed' : 'unknown',
    );
    await this.database.query(
      `UPDATE public.messages SET status = $3 WHERE id = $1 AND "businessId" = $2`,
      [
        row.message_id,
        row.business_id,
        status === 'FAILED' ? 'failed' : 'pending',
      ],
    );
    await this.markResponseIntent(row, status);
    this.logger.warn({
      event: 'whatsapp.outbound_terminal',
      businessId: row.business_id,
      outboundId: row.id,
      classification,
    });
  }

  private async validateRoute(
    businessId: string,
    expectedConnectionId?: string,
  ) {
    const [route] = await this.database.query<{ connection_id: string }[]>(
      `SELECT c.id AS connection_id
         FROM public.channel_connections c
         JOIN public.businesses b ON b.id = c."businessId"
         JOIN public.whatsapp_credentials w ON w.connection_id = c.id AND w.business_id = c."businessId"
        WHERE c."businessId" = $1 AND c.provider = 'whatsapp' AND c.status = 'active'
          AND c."verifiedAt" IS NOT NULL AND b.status = 'active' AND w.envelope IS NOT NULL
          AND (w.expires_at IS NULL OR w.expires_at > now())
          AND ($2::uuid IS NULL OR c.id = $2)
        LIMIT 1`,
      [businessId, expectedConnectionId ?? null],
    );
    if (!route)
      throw new OutboundPolicyError(
        'Verified WhatsApp connection is unavailable.',
      );
    return route;
  }

  private async validateWindow(
    businessId: string,
    recipient: string,
    preferredConversationId?: string | null,
  ) {
    const [window] = await this.database.query<
      { last_inbound: Date | null; conversation_id: string | null }[]
    >(
      `SELECT m."createdAt" AS last_inbound, m."conversationId" AS conversation_id
         FROM public.messages m JOIN public.conversations v ON v.id = m."conversationId"
         JOIN public.customers c ON c.id = v."customerId"
        WHERE m."businessId" = $1 AND m.direction = 'inbound' AND c."whatsappId" = $2
        ORDER BY m."createdAt" DESC LIMIT 1`,
      [businessId, recipient],
    );
    const lastInbound = window?.last_inbound
      ? new Date(window.last_inbound).getTime()
      : 0;
    if (lastInbound === 0 || Date.now() - lastInbound > serviceWindowMs) {
      throw new OutboundPolicyError(
        'Free-form WhatsApp messages require an open customer-service window.',
      );
    }
    if (
      preferredConversationId &&
      window.conversation_id !== preferredConversationId
    ) {
      const [preferred] = await this.database.query<{ valid: boolean }[]>(
        `SELECT EXISTS (SELECT 1 FROM public.messages WHERE "businessId" = $1 AND "conversationId" = $2 AND direction = 'inbound' AND "createdAt" > now() - interval '24 hours') AS valid`,
        [businessId, preferredConversationId],
      );
      if (!preferred?.valid)
        throw new OutboundPolicyError('Conversation window is closed.');
      return preferredConversationId;
    }
    return window.conversation_id;
  }
}
