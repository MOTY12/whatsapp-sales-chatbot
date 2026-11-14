import type { EntityManager } from 'typeorm';
import type { JobHandler } from '../jobs/outbox.store';

export const whatsappReceiptOperation = 'whatsapp.receipt';

type Receipt = {
  id: string;
  business_id: string;
  connection_id: string;
  event_key: string;
  event_type: 'message' | 'delivery';
  payload: Record<string, unknown>;
  status: string;
  verified_at: Date | null;
  message_id: string;
  external_sender_id: string | null;
  message_text: string | null;
  occurred_at: Date | null;
  processed_at: Date | null;
};

async function updateReceipt(
  manager: EntityManager,
  receipt: Receipt,
  outcome: string,
) {
  await manager.query(
    `UPDATE public.webhook_receipts
       SET handed_off_at = COALESCE(handed_off_at, now()), processed_at = now(),
           processing_outcome = $3
     WHERE id = $1 AND business_id = $2`,
    [receipt.id, receipt.business_id, outcome],
  );
}

async function processDelivery(manager: EntityManager, receipt: Receipt) {
  const status = receipt.payload.status;
  if (!['sent', 'delivered', 'read', 'failed'].includes(String(status))) {
    await updateReceipt(manager, receipt, 'unsupported_delivery_status');
    return;
  }
  const [outbound] = await manager.query<{ id: string }[]>(
    `SELECT id FROM public.messages
      WHERE "whatsappMessageId" = $1 AND "businessId" = $2 AND direction = 'outbound'
      FOR UPDATE`,
    [receipt.message_id, receipt.business_id],
  );
  if (!outbound) {
    await updateReceipt(manager, receipt, 'unmatched_delivery');
    return;
  }
  await manager.query(
    `UPDATE public.messages
       SET status = CASE
         WHEN status = 'read' OR $3 = 'read' THEN 'read'
         WHEN status IN ('delivered', 'failed') THEN status
         WHEN $3 = 'failed' THEN 'failed'
         WHEN $3 = 'delivered' AND status <> 'read' THEN 'delivered'
         ELSE status END
     WHERE id = $1 AND "businessId" = $2`,
    [outbound.id, receipt.business_id, status],
  );
  await updateReceipt(manager, receipt, 'delivery_reconciled');
}

async function processInbound(manager: EntityManager, receipt: Receipt) {
  if (
    receipt.status !== 'active' ||
    !receipt.verified_at ||
    !/^\d{1,32}$/.test(receipt.external_sender_id ?? '') ||
    typeof receipt.message_text !== 'string'
  ) {
    await updateReceipt(manager, receipt, 'connection_inactive_or_invalid');
    return;
  }

  const existing = await manager.query<{ id: string; businessId: string }[]>(
    `SELECT id, "businessId" FROM public.messages
      WHERE "whatsappMessageId" = $1 FOR UPDATE`,
    [receipt.message_id],
  );
  if (existing.length) {
    if (existing[0].businessId !== receipt.business_id)
      throw new Error('WhatsApp provider message ID tenant collision.');
    await updateReceipt(manager, receipt, 'duplicate_message');
    return;
  }

  const sender = receipt.external_sender_id;
  const occurredAt = receipt.occurred_at ?? new Date();
  await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `${receipt.business_id}:${sender}`,
  ]);
  let [customer] = await manager.query<{ id: string; name: string }[]>(
    `SELECT id, name FROM public.customers
      WHERE "businessId" = $1 AND ("whatsappId" = $2 OR phone = $2)
      ORDER BY CASE WHEN "whatsappId" = $2 THEN 0 ELSE 1 END
      LIMIT 1 FOR UPDATE`,
    [receipt.business_id, sender],
  );
  if (!customer) {
    [customer] = await manager.query<{ id: string; name: string }[]>(
      `INSERT INTO public.customers
       ("businessId", name, phone, "whatsappId", source, "leadStage", "lastInteraction")
     VALUES ($1, $2, $3, $3, 'whatsapp', 'New Lead', $4)
     ON CONFLICT ("businessId", "whatsappId") DO UPDATE
       SET "lastInteraction" = GREATEST(customers."lastInteraction", EXCLUDED."lastInteraction"),
           "updatedAt" = now()
       RETURNING id, name`,
      [receipt.business_id, `WhatsApp ${sender}`, sender, occurredAt],
    );
  } else {
    await manager.query(
      `UPDATE public.customers
          SET "lastInteraction" = GREATEST("lastInteraction", $3), "updatedAt" = now()
        WHERE id = $1 AND "businessId" = $2`,
      [customer.id, receipt.business_id, occurredAt],
    );
  }
  await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `${receipt.business_id}:${customer.id}`,
  ]);
  let [conversation] = await manager.query<{ id: string }[]>(
    `SELECT id FROM public.conversations
      WHERE "businessId" = $1 AND "customerId" = $2
      ORDER BY "updatedAt" DESC, id DESC LIMIT 1 FOR UPDATE`,
    [receipt.business_id, customer.id],
  );
  if (!conversation) {
    [conversation] = await manager.query<{ id: string }[]>(
      `INSERT INTO public.conversations ("businessId", "customerId", status)
       VALUES ($1, $2, 'open') RETURNING id`,
      [receipt.business_id, customer.id],
    );
  }

  const [membership] = await manager.query<
    { id: string; businessId: string }[]
  >(
    `SELECT id, "businessId" FROM public.business_members
      WHERE "businessId" = $1 AND "verifiedWhatsappId" = $2
        AND role = 'owner' AND status = 'active' LIMIT 1`,
    [receipt.business_id, sender],
  );
  const [onboarding] = await manager.query<{ id: string }[]>(
    `SELECT id FROM public.onboarding_sessions
      WHERE "whatsappId" = $1 AND step NOT IN ('IDLE', 'DONE')
        AND ("businessId" IS NULL OR "businessId" = $2) LIMIT 1`,
    [sender, receipt.business_id],
  );
  const classification = membership
    ? 'owner_command'
    : onboarding
      ? 'legacy_onboarding'
      : 'customer_inquiry';
  const [message] = await manager.query<{ id: string }[]>(
    `INSERT INTO public.messages
       ("businessId", "conversationId", direction, content, status, "whatsappMessageId", metadata)
     VALUES ($1, $2, 'inbound', $3, 'delivered', $4, $5)
     ON CONFLICT ("whatsappMessageId") DO NOTHING
     RETURNING id`,
    [
      receipt.business_id,
      conversation.id,
      receipt.message_text,
      receipt.message_id,
      JSON.stringify({
        source: 'whatsapp',
        receiptId: receipt.id,
        classification,
        processingState: 'ready_for_downstream',
      }),
    ],
  );
  if (!message) {
    const [collision] = await manager.query<{ businessId: string }[]>(
      `SELECT "businessId" FROM public.messages WHERE "whatsappMessageId" = $1`,
      [receipt.message_id],
    );
    if (collision?.businessId !== receipt.business_id)
      throw new Error('WhatsApp provider message ID tenant collision.');
    await updateReceipt(manager, receipt, 'duplicate_message');
    return;
  }
  await manager.query(
    `UPDATE public.conversations SET "updatedAt" = now()
      WHERE id = $1 AND "businessId" = $2`,
    [conversation.id, receipt.business_id],
  );

  if (membership || onboarding) {
    await manager.query(
      `INSERT INTO public.whatsapp_response_intents
         (id, business_id, receipt_id, message_id, response_kind)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (receipt_id) DO NOTHING`,
      [
        receipt.id,
        receipt.business_id,
        receipt.id,
        message.id,
        membership ? 'owner_command' : 'legacy_onboarding',
      ],
    );
  }
  await updateReceipt(manager, receipt, classification);
}

export const handoffWhatsAppReceipt: JobHandler = async (
  manager,
  operation,
) => {
  if (!operation.businessId || operation.metadata.receiptId !== operation.id) {
    throw new Error('Invalid WhatsApp receipt intent.');
  }
  const [receipt] = await manager.query<Receipt[]>(
    `SELECT r.id, r.business_id, r.connection_id, r.event_key, r.event_type,
            r.payload, r.processed_at, c.status, c."verifiedAt" AS verified_at,
            r.payload->>'messageId' AS message_id,
            r.payload->>'senderId' AS external_sender_id,
            r.payload->>'text' AS message_text,
            CASE WHEN r.payload->>'occurredAt' ~ '^\\d+$'
              THEN to_timestamp((r.payload->>'occurredAt')::double precision / 1000)
              ELSE NULLIF(r.payload->>'occurredAt', '')::timestamptz END AS occurred_at
       FROM public.webhook_receipts r
       JOIN public.channel_connections c
         ON c.id = r.connection_id AND c."businessId" = r.business_id
      WHERE r.id = $1 AND r.business_id = $2 AND r.provider = 'whatsapp'
      FOR UPDATE OF r, c`,
    [operation.id, operation.businessId],
  );
  if (!receipt) throw new Error('WhatsApp receipt unavailable.');
  if (receipt.processed_at) return;
  if (receipt.event_type === 'delivery') {
    await processDelivery(manager, receipt);
    return;
  }
  await processInbound(manager, receipt);
};
