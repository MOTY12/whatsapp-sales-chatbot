import type { DataSource } from 'typeorm';
import { tenantTables } from './tenant-integrity';

import { identityRolePattern, merchantRolePattern } from '../config/env';
export const initialMerchantPolicyTables = [
  ...tenantTables,
  'businesses',
  'business_members',
  'accounts',
  'merchant_sessions',
  'merchant_login_attempts',
];
export const merchantPolicyTables = [
  ...initialMerchantPolicyTables,
  'merchant_leads',
  'merchant_lead_events',
];

const identityFunctions = [
  'kleva_consume_login(text,text)',
  'kleva_issue_session(text,text,text,text,text)',
];
const sessionFunctions = [
  'kleva_session_account(text,text)',
  'kleva_revoke_session(text,text)',
  'kleva_list_memberships(text)',
];
export const onboardingFunctions = [
  'kleva_create_merchant_business(text,uuid,jsonb)',
  'kleva_read_merchant_profile()',
  'kleva_update_merchant_profile(jsonb)',
];
export const secureWhatsAppFunctions = [
  'kleva_whatsapp_status()',
  'kleva_write_whatsapp(text,integer,uuid,text,text,text,jsonb,timestamptz)',
  'kleva_whatsapp_candidate(text)',
];
export const inboxFunctions = [
  'kleva_inbox_list(integer,timestamptz,uuid)',
  'kleva_inbox_messages(uuid,integer,timestamptz,uuid)',
  'kleva_inbox_conversation(uuid)',
  'kleva_inbox_change_control(uuid,text)',
  'kleva_inbox_recipient(uuid)',
];
export const knowledgeFunctions = [
  'kleva_faq_list()',
  'kleva_faq_detail(uuid)',
  'kleva_faq_create(uuid,text,text)',
  'kleva_faq_edit(uuid,integer,text,text)',
  'kleva_faq_publish(uuid)',
  'kleva_faq_unpublish(uuid)',
];
export const catalogFunctions = [
  'kleva_product_list(integer,integer)',
  'kleva_product_detail(uuid)',
  'kleva_product_create(uuid,text,text,text,numeric,text,text)',
  'kleva_product_edit(uuid,integer,text,text,text,numeric,text,text)',
  'kleva_product_publish(uuid)',
  'kleva_product_unpublish(uuid)',
];
export const leadFunctions = [
  'kleva_leads_list(integer,timestamptz,uuid,text)',
  'kleva_lead_detail(uuid)',
  'kleva_lead_change_status(uuid,text,bigint)',
];
export const policyFunctions = [
  'kleva_current_account()',
  'kleva_current_role()',
];
export const merchantFunctions = [
  ...identityFunctions,
  ...sessionFunctions,
  ...policyFunctions,
];

export async function grantMerchantAccess(
  source: DataSource,
  role: string,
  identityRole: string,
) {
  if (
    !merchantRolePattern.test(role) ||
    !identityRolePattern.test(identityRole)
  ) {
    throw new Error('Invalid merchant or identity database role name.');
  }
  await source.transaction(async (manager) => {
    await manager.query(
      `GRANT INSERT ON public.merchant_login_attempts TO "${identityRole}"`,
    );
    await manager.query(
      `GRANT SELECT (id, name, status) ON public.businesses TO "${role}"`,
    );
    await manager.query(
      `GRANT SELECT ("businessId", "accountId", role, status) ON public.business_members TO "${role}"`,
    );
    await manager.query(
      `GRANT EXECUTE ON FUNCTION ${[...sessionFunctions, ...onboardingFunctions, ...secureWhatsAppFunctions].map((fn) => `public.${fn}`).join(', ')} TO "${role}"`,
    );
    await manager.query(
      `GRANT EXECUTE ON FUNCTION ${inboxFunctions.map((fn) => `public.${fn}`).join(', ')} TO "${role}"`,
    );
    await manager.query(
      `GRANT EXECUTE ON FUNCTION ${knowledgeFunctions.map((fn) => `public.${fn}`).join(', ')} TO "${role}"`,
    );
    await manager.query(
      `GRANT EXECUTE ON FUNCTION ${catalogFunctions.map((fn) => `public.${fn}`).join(', ')} TO "${role}"`,
    );
    await manager.query(
      `GRANT EXECUTE ON FUNCTION ${leadFunctions.map((fn) => `public.${fn}`).join(', ')} TO "${role}"`,
    );
    await manager.query(
      `GRANT EXECUTE ON FUNCTION ${identityFunctions.map((fn) => `public.${fn}`).join(', ')} TO "${identityRole}"`,
    );
  });
}
