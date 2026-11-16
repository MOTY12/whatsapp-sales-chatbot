-- Run as an administrator after migrations and runtime/merchant grants.
SELECT current_database() AS database_name,
       max("timestamp") AS latest_migration_timestamp,
       count(*) AS migration_count
FROM public.migrations;

SELECT required.table_name,
       coalesce(c.relrowsecurity, false) AS rls_enabled,
       coalesce(c.relforcerowsecurity, false) AS rls_forced
FROM unnest(ARRAY[
  'businesses','users','customers','conversations','messages','follow_ups',
  'tasks','audit_logs','notifications','onboarding_sessions','assistant_sessions',
  'sales','accounts','business_members','merchant_sessions','merchant_login_attempts',
  'channel_connections','whatsapp_credentials','webhook_receipts',
  'whatsapp_response_intents','whatsapp_outbound_messages','whatsapp_unmatched_statuses',
  'business_usage_limits','usage_reservations','conversation_control_audit',
  'knowledge_faqs','knowledge_faq_revisions','knowledge_faq_events',
  'merchant_products','merchant_product_revisions','merchant_product_events',
  'merchant_leads','merchant_lead_events','ai_response_runs'
]) AS required(table_name)
LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || required.table_name)
ORDER BY required.table_name;

SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolinherit
FROM pg_roles
WHERE rolname IN ('kleva_migration','kleva_runtime_app','kleva_merchant_app','kleva_identity_app')
ORDER BY rolname;
