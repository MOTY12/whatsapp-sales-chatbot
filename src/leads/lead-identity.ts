import type { EntityManager } from 'typeorm';
import type { MerchantLeadStatus } from '../database/entities/merchant-lead.entity';

/** Internal deterministic contract for future agent work: look up only the
 * lead attached to this tenant's conversation. This interface never mutates. */
export type ConversationLead = {
  id: string;
  business_id: string;
  customer_id: string;
  conversation_id: string;
  status: MerchantLeadStatus;
  version: string;
};
export async function findLeadForConversation(
  manager: EntityManager,
  businessId: string,
  conversationId: string,
): Promise<ConversationLead | null> {
  const [row] = await manager.query<ConversationLead[]>(
    `SELECT id,business_id,customer_id,conversation_id,status,version FROM public.merchant_leads WHERE business_id=$1 AND conversation_id=$2`,
    [businessId, conversationId],
  );
  return row ?? null;
}
