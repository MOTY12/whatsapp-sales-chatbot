-- Apply as kleva_migration after every migration. Runtime is a trusted service
-- role but is not a superuser, owner, member of another role, or BYPASSRLS role.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.businesses, public.users, public.customers, public.conversations,
  public.messages, public.pipeline_stages, public.follow_ups, public.tasks,
  public.audit_logs, public.notifications, public.onboarding_sessions,
  public.assistant_sessions, public.sales, public.outbox_operations,
  public.accounts, public.business_members, public.channel_connections,
  public.knowledge_faqs, public.knowledge_faq_revisions,
  public.merchant_products, public.merchant_product_revisions,
  public.merchant_leads, public.merchant_lead_events,
  public.ai_response_runs, public.whatsapp_response_intents,
  public.whatsapp_outbound_messages, public.whatsapp_unmatched_statuses,
  public.business_usage_limits, public.usage_reservations
TO kleva_runtime_app;

GRANT SELECT, INSERT ON public.webhook_receipts TO kleva_runtime_app;
GRANT UPDATE (handed_off_at, processed_at, processing_outcome)
  ON public.webhook_receipts TO kleva_runtime_app;
GRANT SELECT ON public.whatsapp_credentials TO kleva_runtime_app;
GRANT UPDATE (expires_at, revision)
  ON public.whatsapp_credentials TO kleva_runtime_app;
GRANT EXECUTE ON FUNCTION public.kleva_published_faqs(uuid) TO kleva_runtime_app;
GRANT EXECUTE ON FUNCTION public.kleva_published_products(uuid) TO kleva_runtime_app;
GRANT EXECUTE ON FUNCTION public.kleva_search_published_knowledge(uuid,text,integer) TO kleva_runtime_app;

DO $$
DECLARE bad_role boolean;
BEGIN
  SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls
    INTO bad_role FROM pg_roles WHERE rolname = 'kleva_runtime_app';
  IF bad_role IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'kleva_runtime_app must remain a restricted non-BYPASSRLS role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = 'kleva_runtime_app'::regrole) THEN
    RAISE EXCEPTION 'kleva_runtime_app must not inherit another role';
  END IF;
END
$$;
