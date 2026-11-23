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
  'merchant_onboarding_progress',
  'merchant_auth_profiles',
  'merchant_password_credentials',
  'merchant_auth_identities',
  'merchant_auth_tokens',
  'merchant_auth_rate_limits',
  'merchant_leads',
  'merchant_lead_events',
  'sales_qualification_policies',
  'merchant_lead_qualifications',
  'merchant_lead_conversions',
  'ai_response_runs',
  'whatsapp_signup_attempts',
  'assistant_configurations',
  'assistant_configuration_audit',
  'ai_playground_rate_limits',
  'ai_playground_usage',
];

const identityFunctions = [
  'kleva_consume_login(text,text)',
  'kleva_issue_session(text,text,text,text,text)',
];
const registrationFunctions = [
  'kleva_read_onboarding_progress(text)',
  'kleva_set_onboarding_step(text,text)',
];
const emailAuthFunctions = [
  'kleva_auth_rate_limit(text,text,integer,integer)',
  'kleva_register_password(text,text,text,text,timestamptz)',
  'kleva_password_account(text)',
  'kleva_create_password_session(text,text,text,text)',
  'kleva_create_auth_token(text,text,text,timestamptz)',
  'kleva_auth_profile_for_delivery(text)',
  'kleva_verify_email(text)',
  'kleva_reset_password(text,text)',
  'kleva_set_password(text,text)',
  'kleva_complete_oidc_auth_v2(text,text,text,text,boolean,text,text,text,text,uuid,text)',
  'kleva_consume_auth_attempt(text,text)',
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
export const embeddedWhatsAppFunctions = [
  'kleva_whatsapp_status_v2()',
  'kleva_whatsapp_signup_start(uuid,timestamptz)',
  'kleva_whatsapp_signup_claim(uuid)',
  'kleva_whatsapp_signup_update(uuid,text,text)',
  'kleva_whatsapp_signup_finish(uuid)',
  'kleva_whatsapp_signup_status()',
  'kleva_write_whatsapp_v2(text,integer,uuid,text,text,text,text,jsonb,timestamptz)',
];
export const inboxFunctions = [
  'kleva_inbox_list(integer,timestamptz,uuid)',
  'kleva_inbox_list_filtered(integer,timestamp,uuid,text,text)',
  'kleva_inbox_conversation_v2(uuid)',
  'kleva_inbox_messages(uuid,integer,timestamptz,uuid)',
  'kleva_inbox_conversation(uuid)',
  'kleva_inbox_change_control(uuid,text)',
  'kleva_inbox_recipient(uuid)',
  'kleva_inbox_members()',
  'kleva_inbox_assign(uuid,uuid)',
  'kleva_inbox_mark_read(uuid)',
  'kleva_inbox_notes(uuid)',
  'kleva_inbox_add_note(uuid,text)',
  'kleva_inbox_set_status(uuid,text)',
  'kleva_inbox_recipient_v2(uuid)',
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
  'kleva_sales_policy_read()',
  'kleva_sales_policy_history()',
  'kleva_sales_policy_save(integer,jsonb)',
  'kleva_lead_qualification_read(uuid)',
  'kleva_lead_qualification_history(uuid)',
  'kleva_lead_qualification_save(uuid,bigint,integer,jsonb,jsonb,boolean)',
  'kleva_lead_convert(uuid,bigint,text,jsonb,uuid)',
  'kleva_lead_conversion_history(uuid)',
];
export const pilotFunctions = [
  'kleva_pilot_status()',
  'kleva_pilot_enroll(uuid,text,boolean,boolean)',
  'kleva_pilot_revoke(uuid)',
];
export const assistantFunctions = [
  'kleva_assistant_config_read()',
  'kleva_assistant_config_save(integer,jsonb)',
  'kleva_ai_playground_admit(uuid)',
  'kleva_ai_playground_finish(uuid,text,integer,integer,integer)',
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
      `GRANT EXECUTE ON FUNCTION ${embeddedWhatsAppFunctions.map((fn) => `public.${fn}`).join(', ')} TO "${role}"`,
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
      `GRANT EXECUTE ON FUNCTION ${pilotFunctions.map((fn) => `public.${fn}`).join(', ')} TO "${role}"`,
    );
    await manager.query(
      `GRANT EXECUTE ON FUNCTION ${assistantFunctions.map((fn) => `public.${fn}`).join(', ')} TO "${role}"`,
    );
    await manager.query(
      `GRANT EXECUTE ON FUNCTION ${[...identityFunctions, 'kleva_list_memberships(text)', ...registrationFunctions, ...emailAuthFunctions].map((fn) => `public.${fn}`).join(', ')} TO "${identityRole}"`,
    );
  });
}
