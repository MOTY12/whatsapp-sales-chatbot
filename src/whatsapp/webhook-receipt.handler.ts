import type { JobHandler } from '../jobs/outbox.store';

export const whatsappReceiptOperation = 'whatsapp.receipt';

export const handoffWhatsAppReceipt: JobHandler = async (
  manager,
  operation,
) => {
  if (!operation.businessId || operation.metadata.receiptId !== operation.id) {
    throw new Error('Invalid WhatsApp receipt intent.');
  }

  const [receipt] = await manager.query<{ id: string }[]>(
    `
    WITH handoff AS (
      UPDATE public.webhook_receipts
      SET handed_off_at = COALESCE(handed_off_at, now())
      WHERE id = $1 AND business_id = $2 AND provider = 'whatsapp'
      RETURNING id
    ) SELECT id FROM handoff
  `,
    [operation.id, operation.businessId],
  );
  if (!receipt) throw new Error('WhatsApp receipt unavailable.');
};
