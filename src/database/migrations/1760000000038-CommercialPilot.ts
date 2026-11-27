import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Commercial agreements and manual billing, isolated from WhatsApp activation. */
export class CommercialPilot1760000000038 implements MigrationInterface {
  name = 'CommercialPilot1760000000038';

  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE public.commercial_pilot_capacity (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
        max_businesses integer,
        max_website_pilots integer,
        max_whatsapp_pilots integer,
        max_pilot_days integer,
        max_monthly_ai_input_tokens integer,
        max_monthly_ai_output_tokens integer,
        max_monthly_embedding_tokens integer,
        max_monthly_whatsapp_outbound integer,
        updated_by text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK(max_businesses IS NULL OR max_businesses>0),
        CHECK(max_website_pilots IS NULL OR max_website_pilots>=0),
        CHECK(max_whatsapp_pilots IS NULL OR max_whatsapp_pilots>=0),
        CHECK(max_pilot_days IS NULL OR max_pilot_days>0)
      );
      INSERT INTO public.commercial_pilot_capacity(singleton) VALUES(true);

      CREATE TABLE public.commercial_pilot_packages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        package_key varchar(80) NOT NULL UNIQUE CHECK(package_key ~ '^[a-z0-9][a-z0-9_-]{1,79}$'),
        current_version integer NOT NULL DEFAULT 0 CHECK(current_version>=0),
        status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','RETIRED')),
        created_by text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.commercial_pilot_package_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        package_id uuid NOT NULL REFERENCES public.commercial_pilot_packages(id) ON DELETE RESTRICT,
        version integer NOT NULL CHECK(version>0),
        name varchar(120) NOT NULL,
        description varchar(2000) NOT NULL DEFAULT '',
        currency char(3) NOT NULL CHECK(currency='NGN'),
        proposed_price numeric(14,2) NOT NULL CHECK(proposed_price>=0),
        billing_period varchar(16) NOT NULL CHECK(billing_period IN ('PILOT','MONTHLY')),
        pilot_days integer NOT NULL CHECK(pilot_days BETWEEN 1 AND 365),
        channels text[] NOT NULL CHECK(cardinality(channels)>0 AND channels <@ ARRAY['WEBSITE','WHATSAPP']::text[]),
        allowances jsonb NOT NULL CHECK(jsonb_typeof(allowances)='object'
          AND COALESCE((allowances->>'aiInputTokens')::integer,-1)>=0
          AND COALESCE((allowances->>'aiOutputTokens')::integer,-1)>=0
          AND COALESCE((allowances->>'embeddingTokens')::integer,-1)>=0
          AND COALESCE((allowances->>'whatsappOutbound')::integer,0)>=0),
        support_coverage jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(support_coverage)='object'),
        per_request_ai_tokens integer NOT NULL CHECK(per_request_ai_tokens>=0),
        status varchar(16) NOT NULL CHECK(status IN ('DRAFT','APPROVED','RETIRED')),
        created_by text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(package_id,version), UNIQUE(id,package_id,version)
      );

      CREATE TABLE public.commercial_pilot_enrollments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
        package_version_id uuid NOT NULL REFERENCES public.commercial_pilot_package_versions(id) ON DELETE RESTRICT,
        package_key varchar(80) NOT NULL,
        package_version integer NOT NULL,
        package_name varchar(120) NOT NULL,
        agreed_price numeric(14,2) NOT NULL CHECK(agreed_price>=0),
        currency char(3) NOT NULL CHECK(currency='NGN'),
        pilot_days integer NOT NULL CHECK(pilot_days BETWEEN 1 AND 365),
        channels text[] NOT NULL CHECK(cardinality(channels)>0 AND channels <@ ARRAY['WEBSITE','WHATSAPP']::text[]),
        allowances jsonb NOT NULL CHECK(jsonb_typeof(allowances)='object'
          AND COALESCE((allowances->>'aiInputTokens')::integer,-1)>=0
          AND COALESCE((allowances->>'aiOutputTokens')::integer,-1)>=0
          AND COALESCE((allowances->>'embeddingTokens')::integer,-1)>=0
          AND COALESCE((allowances->>'whatsappOutbound')::integer,0)>=0),
        per_request_ai_tokens integer NOT NULL CHECK(per_request_ai_tokens>=0),
        support_coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
        agreement_version varchar(80) NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'OFFERED'
          CHECK(status IN ('DRAFT','OFFERED','ACCEPTED','APPROVED','ACTIVE','SUSPENDED','EXPIRED','CANCELLED')),
        offer_key uuid NOT NULL,
        offered_by text NOT NULL,
        offered_at timestamptz NOT NULL DEFAULT now(),
        accepted_by uuid,
        accepted_at timestamptz,
        approved_by text,
        approved_at timestamptz,
        pilot_start_at timestamptz,
        pilot_end_at timestamptz,
        support_owner text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(business_id,id), UNIQUE(business_id,offer_key),
        FOREIGN KEY(accepted_by) REFERENCES public.accounts(id) ON DELETE RESTRICT,
        CHECK((accepted_by IS NULL)=(accepted_at IS NULL)),
        CHECK((approved_by IS NULL)=(approved_at IS NULL)),
        CHECK((pilot_start_at IS NULL)=(pilot_end_at IS NULL)),
        CHECK(pilot_end_at IS NULL OR pilot_end_at>pilot_start_at)
      );
      CREATE UNIQUE INDEX uq_commercial_one_current_offer ON public.commercial_pilot_enrollments(business_id)
        WHERE status IN ('OFFERED','ACCEPTED','APPROVED','ACTIVE','SUSPENDED');
      CREATE INDEX idx_commercial_enrollment_expiry ON public.commercial_pilot_enrollments(status,pilot_end_at);

      CREATE TABLE public.commercial_pilot_agreements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL,
        enrollment_id uuid NOT NULL, account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
        agreement_version varchar(80) NOT NULL, accepted_terms jsonb NOT NULL CHECK(jsonb_typeof(accepted_terms)='object'),
        evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'), accepted_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(business_id,enrollment_id),
        FOREIGN KEY(business_id,enrollment_id) REFERENCES public.commercial_pilot_enrollments(business_id,id) ON DELETE RESTRICT
      );

      CREATE TABLE public.commercial_pilot_invoices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL,
        enrollment_id uuid NOT NULL, invoice_reference varchar(80) NOT NULL UNIQUE,
        package_version_id uuid NOT NULL REFERENCES public.commercial_pilot_package_versions(id) ON DELETE RESTRICT,
        currency char(3) NOT NULL CHECK(currency='NGN'), amount numeric(14,2) NOT NULL CHECK(amount>=0),
        paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(paid_amount>=0 AND paid_amount<=amount),
        issued_at timestamptz, due_at timestamptz NOT NULL, description varchar(1000) NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','OVERDUE','VOID')),
        issued_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(business_id,id),
        FOREIGN KEY(business_id,enrollment_id) REFERENCES public.commercial_pilot_enrollments(business_id,id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_commercial_invoice_business ON public.commercial_pilot_invoices(business_id,created_at DESC);
      CREATE TABLE public.commercial_pilot_payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL,
        invoice_id uuid NOT NULL, currency char(3) NOT NULL CHECK(currency='NGN'),
        amount numeric(14,2) NOT NULL CHECK(amount>0), method varchar(24) NOT NULL
          CHECK(method IN ('BANK_TRANSFER','EXTERNAL_REFERENCE','MANUAL_GATEWAY_CONFIRMATION')),
        reference_scope varchar(80) NOT NULL, external_reference varchar(200) NOT NULL,
        received_at timestamptz NOT NULL, status varchar(16) NOT NULL DEFAULT 'RECORDED'
          CHECK(status IN ('RECORDED','CONFIRMED','REVERSED')),
        confirmed_by text, confirmed_at timestamptz, evidence_reference varchar(200),
        created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(reference_scope,external_reference), UNIQUE(business_id,id),
        FOREIGN KEY(business_id,invoice_id) REFERENCES public.commercial_pilot_invoices(business_id,id) ON DELETE RESTRICT,
        CHECK((confirmed_by IS NULL)=(confirmed_at IS NULL))
      );
      CREATE INDEX idx_commercial_payment_invoice ON public.commercial_pilot_payments(business_id,invoice_id,status);

      CREATE TABLE public.commercial_pilot_entitlement_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL,
        enrollment_id uuid NOT NULL, idempotency_key uuid NOT NULL,
        previous_limits jsonb NOT NULL, next_limits jsonb NOT NULL,
        actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(business_id,idempotency_key),
        FOREIGN KEY(business_id,enrollment_id) REFERENCES public.commercial_pilot_enrollments(business_id,id) ON DELETE RESTRICT
      );
      CREATE TABLE public.commercial_pilot_audit_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid,
        enrollment_id uuid, actor text NOT NULL, action varchar(40) NOT NULL,
        affected_record uuid, summary jsonb NOT NULL DEFAULT '{}'::jsonb,
        evidence_reference varchar(200), created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY(business_id,enrollment_id) REFERENCES public.commercial_pilot_enrollments(business_id,id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_commercial_audit_business ON public.commercial_pilot_audit_events(business_id,created_at DESC);

      CREATE FUNCTION public.kleva_commercial_immutable() RETURNS trigger
      LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
      BEGIN
        IF TG_TABLE_NAME='commercial_pilot_package_versions' THEN
          IF TG_OP='DELETE' OR (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') OR OLD.status<>'DRAFT' OR NEW.status NOT IN ('APPROVED','RETIRED') THEN
            RAISE EXCEPTION 'commercial package terms are immutable' USING ERRCODE='55000';
          END IF;
          RETURN NEW;
        ELSIF TG_TABLE_NAME='commercial_pilot_payments' THEN
          IF TG_OP='DELETE' OR (to_jsonb(NEW)-'status'-'confirmed_by'-'confirmed_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'confirmed_by'-'confirmed_at') OR NOT (OLD.status='RECORDED' AND NEW.status='CONFIRMED' OR OLD.status='CONFIRMED' AND NEW.status='REVERSED') THEN
            RAISE EXCEPTION 'commercial payment history is immutable' USING ERRCODE='55000';
          END IF;
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'commercial history is immutable' USING ERRCODE='55000';
      END $$;
      CREATE TRIGGER trg_commercial_package_version_immutable BEFORE UPDATE OR DELETE ON public.commercial_pilot_package_versions
        FOR EACH ROW EXECUTE FUNCTION public.kleva_commercial_immutable();
      CREATE TRIGGER trg_commercial_agreement_immutable BEFORE UPDATE OR DELETE ON public.commercial_pilot_agreements
        FOR EACH ROW EXECUTE FUNCTION public.kleva_commercial_immutable();
      CREATE TRIGGER trg_commercial_entitlement_immutable BEFORE UPDATE OR DELETE ON public.commercial_pilot_entitlement_events
        FOR EACH ROW EXECUTE FUNCTION public.kleva_commercial_immutable();
      CREATE TRIGGER trg_commercial_payment_immutable BEFORE UPDATE OR DELETE ON public.commercial_pilot_payments
        FOR EACH ROW EXECUTE FUNCTION public.kleva_commercial_immutable();
      CREATE TRIGGER trg_commercial_audit_immutable BEFORE UPDATE OR DELETE ON public.commercial_pilot_audit_events
        FOR EACH ROW EXECUTE FUNCTION public.kleva_commercial_immutable();

      DO $$ DECLARE t text; BEGIN
        FOREACH t IN ARRAY ARRAY['commercial_pilot_enrollments','commercial_pilot_agreements','commercial_pilot_invoices','commercial_pilot_payments','commercial_pilot_entitlement_events','commercial_pilot_audit_events'] LOOP
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
          EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
          EXECUTE format('CREATE POLICY %I ON public.%I USING (business_id=NULLIF(current_setting(''kleva.business_id'',true),'''')::uuid AND public.kleva_current_role() IN (''owner'',''editor'')) WITH CHECK (business_id=NULLIF(current_setting(''kleva.business_id'',true),'''')::uuid AND public.kleva_current_role()=''owner'' )',t||'_tenant',t);
          EXECUTE format('CREATE POLICY %I ON public.%I USING (current_user::text !~ ''^kleva_(merchant|identity|runtime|pilot_operator)_'') WITH CHECK (current_user::text !~ ''^kleva_(merchant|identity|runtime|pilot_operator)_'')',t||'_internal',t);
        END LOOP;
        FOREACH t IN ARRAY ARRAY['commercial_pilot_packages','commercial_pilot_package_versions','commercial_pilot_capacity'] LOOP
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
          EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
          EXECUTE format('CREATE POLICY %I ON public.%I USING (current_user::text !~ ''^kleva_(merchant|identity|runtime|pilot_operator)_'') WITH CHECK (current_user::text !~ ''^kleva_(merchant|identity|runtime|pilot_operator)_'')',t||'_internal',t);
        END LOOP;
      END $$;

      CREATE FUNCTION public.kleva_commercial_read()
      RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE tenant uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; result jsonb;
      BEGIN
        IF tenant IS NULL OR COALESCE(public.kleva_current_role() NOT IN ('owner','editor'),true) THEN RAISE EXCEPTION 'commercial access denied' USING ERRCODE='42501'; END IF;
        SELECT jsonb_build_object(
          'enrollment',(SELECT to_jsonb(e)-'business_id'-'offered_by'-'approved_by' FROM public.commercial_pilot_enrollments e WHERE e.business_id=tenant AND e.status NOT IN ('CANCELLED','EXPIRED') ORDER BY e.created_at DESC LIMIT 1),
          'invoices',COALESCE((SELECT jsonb_agg(to_jsonb(i)-'business_id' ORDER BY i.created_at DESC) FROM public.commercial_pilot_invoices i WHERE i.business_id=tenant),'[]'::jsonb),
          'payments',COALESCE((SELECT jsonb_agg(to_jsonb(p)-'business_id'-'created_by'-'confirmed_by'-'evidence_reference' ORDER BY p.created_at DESC) FROM public.commercial_pilot_payments p WHERE p.business_id=tenant AND p.status='CONFIRMED'),'[]'::jsonb),
          'entitlement_events',COALESCE((SELECT jsonb_agg(to_jsonb(x)-'business_id' ORDER BY x.created_at DESC) FROM public.commercial_pilot_entitlement_events x WHERE x.business_id=tenant),'[]'::jsonb)) INTO result;
        RETURN result;
      END $$;

      CREATE FUNCTION public.kleva_commercial_readiness()
      RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE tenant uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; actor_role text:=public.kleva_current_role(); e public.commercial_pilot_enrollments%ROWTYPE; profile_ok boolean; knowledge_ok boolean; products_ok boolean; assistant_ok boolean; playground_ok boolean; widget_ok boolean; domain_ok boolean; limits_ok boolean; whatsapp_ok boolean; wa_approved boolean; payment_ok boolean; checklist jsonb;
      BEGIN
        IF tenant IS NULL OR COALESCE(actor_role NOT IN ('owner','editor'),true) THEN RAISE EXCEPTION 'commercial readiness access denied' USING ERRCODE='42501'; END IF;
        SELECT * INTO e FROM public.commercial_pilot_enrollments WHERE business_id=tenant AND status NOT IN ('CANCELLED','EXPIRED') ORDER BY created_at DESC LIMIT 1;
        SELECT EXISTS(SELECT 1 FROM public.businesses b WHERE b.id=tenant AND b.status='active' AND length(btrim(b.name))>0 AND length(btrim(COALESCE(b.industry,'')))>0 AND length(btrim(COALESCE(b.phone,'')))>0 AND length(btrim(COALESCE(b.timezone,'')))>0) INTO profile_ok;
        SELECT EXISTS(SELECT 1 FROM public.knowledge_faqs f WHERE f.business_id=tenant AND f.published_revision_id IS NOT NULL)
          OR EXISTS(SELECT 1 FROM public.knowledge_documents d WHERE d.business_id=tenant AND d.published_revision_id IS NOT NULL)
          OR EXISTS(SELECT 1 FROM public.merchant_products p WHERE p.business_id=tenant AND p.published_revision_id IS NOT NULL) INTO knowledge_ok;
        SELECT EXISTS(SELECT 1 FROM public.merchant_products p WHERE p.business_id=tenant AND p.published_revision_id IS NOT NULL) INTO products_ok;
        SELECT EXISTS(SELECT 1 FROM public.assistant_configurations c WHERE c.business_id=tenant) INTO assistant_ok;
        SELECT EXISTS(SELECT 1 FROM public.ai_playground_usage u WHERE u.business_id=tenant AND u.completed_at IS NOT NULL AND u.outcome<>'PENDING') INTO playground_ok;
        SELECT EXISTS(SELECT 1 FROM public.website_widgets w WHERE w.business_id=tenant) INTO widget_ok;
        SELECT EXISTS(SELECT 1 FROM public.website_widget_domains d WHERE d.business_id=tenant) INTO domain_ok;
        SELECT EXISTS(SELECT 1 FROM public.business_usage_limits l WHERE l.business_id=tenant AND l.monthly_ai_input_tokens IS NOT NULL AND l.monthly_ai_output_tokens IS NOT NULL AND l.ai_tokens_per_request>0) INTO limits_ok;
        SELECT EXISTS(SELECT 1 FROM public.channel_connections c WHERE c."businessId"=tenant AND c.provider='whatsapp' AND c.status='active' AND c."verifiedAt" IS NOT NULL) INTO whatsapp_ok;
        SELECT EXISTS(SELECT 1 FROM public.business_pilot_enrollments p WHERE p.business_id=tenant AND p.status='ACTIVE' AND p.connection_id=(SELECT c.id FROM public.channel_connections c WHERE c."businessId"=tenant AND c.provider='whatsapp' AND c.status='active' AND c."verifiedAt" IS NOT NULL ORDER BY c."updatedAt" DESC LIMIT 1)) INTO wa_approved;
        payment_ok:=COALESCE(e.agreed_price=0 OR (SELECT COALESCE(sum(i.paid_amount),0) FROM public.commercial_pilot_invoices i WHERE i.business_id=tenant AND i.enrollment_id=e.id)>=e.agreed_price,false);
        checklist:=jsonb_build_object(
          'businessProfileCompleted',profile_ok,
          'commercialOfferAccepted',COALESCE(e.status IN ('ACCEPTED','APPROVED','ACTIVE','SUSPENDED'),false),
          'knowledgePublished',knowledge_ok,
          'productCatalogConfigured',products_ok,
          'assistantConfigured',assistant_ok,
          'playgroundTested',playground_ok,
          'websiteWidgetCreated',widget_ok,
          'websiteDomainConfigured',domain_ok,
          'widgetInstallationVerified',false,
          'usageAllowancesProvisioned',EXISTS(SELECT 1 FROM public.commercial_pilot_entitlement_events x WHERE x.business_id=tenant AND x.enrollment_id=e.id),
          'commercialApprovalCompleted',COALESCE(e.status IN ('APPROVED','ACTIVE','SUSPENDED'),false),
          'commercialPaymentConfirmed',payment_ok,
          'releaseGatesSatisfied',false,
          'whatsappRequired',COALESCE('WHATSAPP'=ANY(e.channels),false),
          'whatsappConnectedAndVerified',whatsapp_ok,
          'whatsappAiApprovalCompleted',wa_approved,
          'websiteOnly',COALESCE(e.channels=ARRAY['WEBSITE']::text[],false),
          'teamInvitationsOptional',true,
          'productCatalogOptionalWhenNotRelevant',true
        );
        RETURN jsonb_build_object('enrollmentStatus',e.status,'checklist',checklist,
          'aiActivationIsSeparate',true,
          'websiteWidgetInstallationVerificationAvailable',false,
          'blockers',to_jsonb(array_remove(ARRAY[
            CASE WHEN NOT profile_ok THEN 'BUSINESS_PROFILE_INCOMPLETE' END,
            CASE WHEN NOT COALESCE(e.status IN ('ACCEPTED','APPROVED','ACTIVE','SUSPENDED'),false) THEN 'COMMERCIAL_OFFER_NOT_ACCEPTED' END,
            CASE WHEN NOT COALESCE(e.status IN ('APPROVED','ACTIVE','SUSPENDED'),false) THEN 'COMMERCIAL_OPERATOR_APPROVAL_REQUIRED' END,
            CASE WHEN NOT knowledge_ok THEN 'PUBLISHED_KNOWLEDGE_REQUIRED' END,
            CASE WHEN NOT assistant_ok THEN 'ASSISTANT_CONFIGURATION_REQUIRED' END,
            CASE WHEN NOT playground_ok THEN 'PLAYGROUND_TEST_REQUIRED' END,
            CASE WHEN NOT widget_ok THEN 'WEBSITE_WIDGET_REQUIRED' END,
            CASE WHEN NOT domain_ok THEN 'WEBSITE_DOMAIN_REQUIRED' END,
            CASE WHEN NOT COALESCE(EXISTS(SELECT 1 FROM public.commercial_pilot_entitlement_events x WHERE x.business_id=tenant AND x.enrollment_id=e.id),false) THEN 'USAGE_ALLOWANCES_NOT_PROVISIONED' END,
            CASE WHEN NOT payment_ok THEN 'PAYMENT_NOT_CONFIRMED' END,
            CASE WHEN widget_ok THEN 'WIDGET_INSTALLATION_NOT_VERIFIABLE' END,
            'RELEASE_GATES_REQUIRE_QA_APPROVAL',
            CASE WHEN COALESCE('WHATSAPP'=ANY(e.channels),false) AND NOT whatsapp_ok THEN 'WHATSAPP_CONNECTION_NOT_VERIFIED' END,
            CASE WHEN COALESCE('WHATSAPP'=ANY(e.channels),false) AND NOT wa_approved THEN 'WHATSAPP_PILOT_APPROVAL_REQUIRED' END
          ]::text[],NULL))
        );
      END $$;

      CREATE FUNCTION public.kleva_commercial_offer_accept(target_id uuid, request_key uuid)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE tenant uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; actor uuid:=public.kleva_current_account(); e public.commercial_pilot_enrollments%ROWTYPE;
      BEGIN
        IF tenant IS NULL OR actor IS NULL OR public.kleva_current_role() IS DISTINCT FROM 'owner' OR request_key IS NULL THEN RAISE EXCEPTION 'commercial acceptance denied' USING ERRCODE='42501'; END IF;
        SELECT * INTO e FROM public.commercial_pilot_enrollments WHERE business_id=tenant AND id=target_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'offer unavailable' USING ERRCODE='22023'; END IF;
        IF e.status='ACCEPTED' AND e.accepted_by=actor THEN RETURN to_jsonb(e)-'business_id'-'offered_by'-'approved_by'; END IF;
        IF e.status<>'OFFERED' THEN RAISE EXCEPTION 'offer unavailable' USING ERRCODE='22023'; END IF;
        UPDATE public.commercial_pilot_enrollments SET status='ACCEPTED',accepted_by=actor,accepted_at=now(),updated_at=now()
          WHERE id=target_id RETURNING * INTO e;
        INSERT INTO public.commercial_pilot_agreements(business_id,enrollment_id,account_id,agreement_version,accepted_terms,evidence)
        VALUES(tenant,target_id,actor,e.agreement_version,jsonb_build_object('packageVersionId',e.package_version_id,'price',e.agreed_price,'currency',e.currency,'pilotDays',e.pilot_days,'channels',e.channels,'allowances',e.allowances,'supportCoverage',e.support_coverage),jsonb_build_object('requestKey',request_key,'sessionVerified',true));
        INSERT INTO public.commercial_pilot_audit_events(business_id,enrollment_id,actor,action,affected_record,summary)
          VALUES(tenant,target_id,actor::text,'MERCHANT_ACCEPTED',target_id,jsonb_build_object('agreementVersion',e.agreement_version,'packageVersion',e.package_version));
        RETURN to_jsonb(e)-'business_id'-'offered_by'-'approved_by';
      END $$;

      CREATE FUNCTION public.kleva_commercial_create_package(
        p_key text,p_name text,p_description text,p_price numeric,p_period text,p_days integer,p_channels text[],p_allowances jsonb,p_per_request integer,p_support jsonb
      ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE actor text:=session_user::text; package_id uuid; version_id uuid; next_version integer; c commercial_pilot_capacity%ROWTYPE;
      BEGIN
        IF NOT pg_has_role(session_user,'kleva_commercial_package_manager','member') THEN RAISE EXCEPTION 'commercial package permission required' USING ERRCODE='42501'; END IF;
        SELECT * INTO c FROM public.commercial_pilot_capacity WHERE singleton FOR UPDATE;
        IF c.max_pilot_days IS NOT NULL AND p_days>c.max_pilot_days THEN RAISE EXCEPTION 'pilot duration exceeds capacity policy' USING ERRCODE='22023'; END IF;
        INSERT INTO public.commercial_pilot_packages(package_key,current_version,status,created_by) VALUES(p_key,0,'DRAFT',actor) RETURNING id INTO package_id;
        INSERT INTO public.commercial_pilot_package_versions(package_id,version,name,description,currency,proposed_price,billing_period,pilot_days,channels,allowances,support_coverage,per_request_ai_tokens,status,created_by)
        VALUES(package_id,1,p_name,p_description,'NGN',p_price,p_period,p_days,p_channels,p_allowances,p_support,p_per_request,'DRAFT',actor) RETURNING id INTO version_id;
        UPDATE public.commercial_pilot_packages SET current_version=1 WHERE id=package_id;
        INSERT INTO public.commercial_pilot_audit_events(actor,action,affected_record,summary) VALUES(actor,'PACKAGE_CREATED',package_id,jsonb_build_object('packageKey',p_key,'version',1));
        RETURN jsonb_build_object('packageId',package_id,'versionId',version_id,'version',1,'status','DRAFT');
      END $$;

      CREATE FUNCTION public.kleva_commercial_package_approve(target_version uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE v public.commercial_pilot_package_versions%ROWTYPE;
      BEGIN
        IF NOT pg_has_role(session_user,'kleva_commercial_package_manager','member') THEN RAISE EXCEPTION 'commercial package permission required' USING ERRCODE='42501'; END IF;
        SELECT * INTO v FROM public.commercial_pilot_package_versions WHERE id=target_version FOR UPDATE;
        IF NOT FOUND OR v.status<>'DRAFT' THEN RAISE EXCEPTION 'package version is not a draft' USING ERRCODE='22023'; END IF;
        UPDATE public.commercial_pilot_package_versions SET status='APPROVED' WHERE id=target_version;
        UPDATE public.commercial_pilot_packages SET status='ACTIVE',updated_at=now() WHERE id=v.package_id;
        INSERT INTO public.commercial_pilot_audit_events(actor,action,affected_record,summary) VALUES(session_user::text,'PACKAGE_VERSION_APPROVED',target_version,jsonb_build_object('version',v.version));
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_commercial_package_version_create(target_package uuid,p_name text,p_description text,p_price numeric,p_period text,p_days integer,p_channels text[],p_allowances jsonb,p_per_request integer,p_support jsonb)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE p public.commercial_pilot_packages%ROWTYPE; capacity public.commercial_pilot_capacity%ROWTYPE; version_id uuid; next_version integer;
      BEGIN
        IF NOT pg_has_role(session_user,'kleva_commercial_package_manager','member') THEN RAISE EXCEPTION 'commercial package permission required' USING ERRCODE='42501'; END IF;
        SELECT * INTO p FROM public.commercial_pilot_packages WHERE id=target_package AND status<>'RETIRED' FOR UPDATE;
        SELECT * INTO capacity FROM public.commercial_pilot_capacity WHERE singleton FOR SHARE;
        IF p.id IS NULL OR (capacity.max_pilot_days IS NOT NULL AND p_days>capacity.max_pilot_days) THEN RAISE EXCEPTION 'package or capacity unavailable' USING ERRCODE='22023'; END IF;
        next_version:=p.current_version+1;
        INSERT INTO public.commercial_pilot_package_versions(package_id,version,name,description,currency,proposed_price,billing_period,pilot_days,channels,allowances,support_coverage,per_request_ai_tokens,status,created_by)
        VALUES(p.id,next_version,p_name,p_description,'NGN',p_price,p_period,p_days,p_channels,p_allowances,p_support,p_per_request,'DRAFT',session_user::text) RETURNING id INTO version_id;
        UPDATE public.commercial_pilot_packages SET current_version=next_version,updated_at=now() WHERE id=p.id;
        INSERT INTO public.commercial_pilot_audit_events(actor,action,affected_record,summary) VALUES(session_user::text,'PACKAGE_VERSION_CREATED',version_id,jsonb_build_object('packageKey',p.package_key,'version',next_version));
        RETURN jsonb_build_object('packageId',p.id,'versionId',version_id,'version',next_version,'status','DRAFT');
      END $$;

      CREATE FUNCTION public.kleva_commercial_offer_create(target_business uuid,target_version uuid,offer_key uuid,terms_version text,support_owner_value text)
      RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE v public.commercial_pilot_package_versions%ROWTYPE; c public.commercial_pilot_capacity%ROWTYPE; result uuid; active_count integer; web_count integer; wa_count integer;
      BEGIN
        IF NOT pg_has_role(session_user,'kleva_commercial_enrollment_manager','member') THEN RAISE EXCEPTION 'commercial enrollment permission required' USING ERRCODE='42501'; END IF;
        IF offer_key IS NULL OR terms_version IS NULL OR length(btrim(terms_version)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'invalid offer terms' USING ERRCODE='22023'; END IF;
        SELECT * INTO c FROM public.commercial_pilot_capacity WHERE singleton FOR UPDATE;
        SELECT * INTO v FROM public.commercial_pilot_package_versions WHERE id=target_version AND status='APPROVED';
        IF NOT FOUND THEN RAISE EXCEPTION 'approved package version required' USING ERRCODE='22023'; END IF;
        IF c.max_businesses IS NULL OR c.max_website_pilots IS NULL OR c.max_whatsapp_pilots IS NULL OR c.max_pilot_days IS NULL THEN RAISE EXCEPTION 'commercial pilot capacity is not configured' USING ERRCODE='55000'; END IF;
        IF v.pilot_days>c.max_pilot_days OR COALESCE((v.allowances->>'aiInputTokens')::bigint,0)>COALESCE(c.max_monthly_ai_input_tokens,2147483647)
          OR COALESCE((v.allowances->>'aiOutputTokens')::bigint,0)>COALESCE(c.max_monthly_ai_output_tokens,2147483647)
          OR COALESCE((v.allowances->>'embeddingTokens')::bigint,0)>COALESCE(c.max_monthly_embedding_tokens,2147483647)
          OR COALESCE((v.allowances->>'whatsappOutbound')::bigint,0)>COALESCE(c.max_monthly_whatsapp_outbound,2147483647) THEN RAISE EXCEPTION 'package exceeds configured pilot allocation' USING ERRCODE='22023'; END IF;
        SELECT count(*),count(*) FILTER(WHERE 'WEBSITE'=ANY(channels)),count(*) FILTER(WHERE 'WHATSAPP'=ANY(channels)) INTO active_count,web_count,wa_count
          FROM public.commercial_pilot_enrollments WHERE status IN ('OFFERED','ACCEPTED','APPROVED','ACTIVE','SUSPENDED');
        IF active_count>=c.max_businesses OR ('WEBSITE'=ANY(v.channels) AND web_count>=c.max_website_pilots) OR ('WHATSAPP'=ANY(v.channels) AND wa_count>=c.max_whatsapp_pilots) THEN RAISE EXCEPTION 'commercial pilot capacity reached' USING ERRCODE='54000'; END IF;
        INSERT INTO public.commercial_pilot_enrollments(business_id,package_version_id,package_key,package_version,package_name,agreed_price,currency,pilot_days,channels,allowances,per_request_ai_tokens,support_coverage,agreement_version,offer_key,offered_by,support_owner)
        SELECT target_business,v.id,p.package_key,v.version,v.name,v.proposed_price,v.currency,v.pilot_days,v.channels,v.allowances,v.per_request_ai_tokens,v.support_coverage,terms_version,offer_key,session_user::text,support_owner_value
          FROM public.commercial_pilot_packages p WHERE p.id=v.package_id AND p.status='ACTIVE' RETURNING id INTO result;
        IF result IS NULL THEN RAISE EXCEPTION 'package is not active' USING ERRCODE='22023'; END IF;
        INSERT INTO public.commercial_pilot_audit_events(business_id,enrollment_id,actor,action,affected_record,summary) VALUES(target_business,result,session_user::text,'OFFER_CREATED',result,jsonb_build_object('packageVersion',v.version,'channels',v.channels));
        RETURN result;
      END $$;

      CREATE FUNCTION public.kleva_commercial_approve(target_enrollment uuid,pilot_start timestamptz)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE e public.commercial_pilot_enrollments%ROWTYPE; c public.commercial_pilot_capacity%ROWTYPE;
      BEGIN
        IF NOT pg_has_role(session_user,'kleva_commercial_enrollment_manager','member') THEN RAISE EXCEPTION 'commercial enrollment permission required' USING ERRCODE='42501'; END IF;
        SELECT * INTO e FROM public.commercial_pilot_enrollments WHERE id=target_enrollment FOR UPDATE;
        SELECT * INTO c FROM public.commercial_pilot_capacity WHERE singleton FOR UPDATE;
        IF e.status<>'ACCEPTED' OR pilot_start IS NULL THEN RAISE EXCEPTION 'accepted offer required' USING ERRCODE='22023'; END IF;
        UPDATE public.commercial_pilot_enrollments SET status='APPROVED',approved_by=session_user::text,approved_at=now(),pilot_start_at=pilot_start,pilot_end_at=pilot_start+make_interval(days=>e.pilot_days),updated_at=now() WHERE id=e.id;
        INSERT INTO public.commercial_pilot_audit_events(business_id,enrollment_id,actor,action,affected_record,summary) VALUES(e.business_id,e.id,session_user::text,'OPERATOR_APPROVED',e.id,jsonb_build_object('pilotStart',pilot_start,'pilotDays',e.pilot_days));
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_commercial_activate(target_enrollment uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE e public.commercial_pilot_enrollments%ROWTYPE; settled numeric(14,2);
      BEGIN
        IF NOT pg_has_role(session_user,'kleva_commercial_enrollment_manager','member') THEN RAISE EXCEPTION 'commercial enrollment permission required' USING ERRCODE='42501'; END IF;
        SELECT * INTO e FROM public.commercial_pilot_enrollments WHERE id=target_enrollment FOR UPDATE;
        IF NOT FOUND OR e.status<>'APPROVED' OR e.pilot_start_at>now() OR e.pilot_end_at<=now() THEN RAISE EXCEPTION 'approved, in-window enrollment required' USING ERRCODE='22023'; END IF;
        SELECT COALESCE(sum(p.amount),0) INTO settled FROM public.commercial_pilot_payments p
          JOIN public.commercial_pilot_invoices i ON i.business_id=p.business_id AND i.id=p.invoice_id
          WHERE p.business_id=e.business_id AND i.enrollment_id=e.id AND p.status='CONFIRMED';
        IF settled<e.agreed_price AND e.agreed_price>0 THEN RAISE EXCEPTION 'confirmed payment required before commercial activation' USING ERRCODE='55000'; END IF;
        IF NOT EXISTS(SELECT 1 FROM public.commercial_pilot_entitlement_events WHERE business_id=e.business_id AND enrollment_id=e.id) THEN RAISE EXCEPTION 'usage entitlements must be provisioned' USING ERRCODE='55000'; END IF;
        UPDATE public.commercial_pilot_enrollments SET status='ACTIVE',updated_at=now() WHERE id=e.id;
        INSERT INTO public.commercial_pilot_audit_events(business_id,enrollment_id,actor,action,affected_record,summary) VALUES(e.business_id,e.id,session_user::text,'COMMERCIAL_PILOT_ACTIVATED',e.id,jsonb_build_object('commercialOnly',true));
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_commercial_invoice_create(target_enrollment uuid,reference text,due_at_value timestamptz,description_value text)
      RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE e public.commercial_pilot_enrollments%ROWTYPE; invoice_id uuid;
      BEGIN
        IF NOT pg_has_role(session_user,'kleva_commercial_invoice_manager','member') THEN RAISE EXCEPTION 'commercial invoice permission required' USING ERRCODE='42501'; END IF;
        SELECT * INTO e FROM public.commercial_pilot_enrollments WHERE id=target_enrollment AND status IN ('ACCEPTED','APPROVED','ACTIVE') FOR SHARE;
        IF NOT FOUND OR reference !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{2,79}$' OR due_at_value<=now() OR length(btrim(description_value)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid invoice request' USING ERRCODE='22023'; END IF;
        INSERT INTO public.commercial_pilot_invoices(business_id,enrollment_id,invoice_reference,package_version_id,currency,amount,due_at,description)
        VALUES(e.business_id,e.id,reference,e.package_version_id,e.currency,e.agreed_price,due_at_value,description_value) RETURNING id INTO invoice_id;
        INSERT INTO public.commercial_pilot_audit_events(business_id,enrollment_id,actor,action,affected_record,summary) VALUES(e.business_id,e.id,session_user::text,'INVOICE_DRAFTED',invoice_id,jsonb_build_object('amount',e.agreed_price,'currency',e.currency));
        RETURN invoice_id;
      END $$;

      CREATE FUNCTION public.kleva_commercial_invoice_issue(target_invoice uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE i public.commercial_pilot_invoices%ROWTYPE;
      BEGIN
        IF NOT pg_has_role(session_user,'kleva_commercial_invoice_manager','member') THEN RAISE EXCEPTION 'commercial invoice permission required' USING ERRCODE='42501'; END IF;
        SELECT * INTO i FROM public.commercial_pilot_invoices WHERE id=target_invoice FOR UPDATE;
        IF NOT FOUND OR i.status<>'DRAFT' THEN RAISE EXCEPTION 'invoice is not a draft' USING ERRCODE='22023'; END IF;
        UPDATE public.commercial_pilot_invoices SET status='ISSUED',issued_at=now(),issued_by=session_user::text,updated_at=now() WHERE id=i.id;
        INSERT INTO public.commercial_pilot_audit_events(business_id,enrollment_id,actor,action,affected_record,summary) VALUES(i.business_id,i.enrollment_id,session_user::text,'INVOICE_ISSUED',i.id,jsonb_build_object('reference',i.invoice_reference,'amount',i.amount));
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_commercial_payment_record(target_invoice uuid,amount_value numeric,method_value text,reference_scope_value text,external_ref text,received timestamptz,evidence text)
      RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE i public.commercial_pilot_invoices%ROWTYPE; payment_id uuid;
      BEGIN
        IF NOT pg_has_role(session_user,'kleva_commercial_payment_recorder','member') THEN RAISE EXCEPTION 'commercial payment recording permission required' USING ERRCODE='42501'; END IF;
        SELECT * INTO i FROM public.commercial_pilot_invoices WHERE id=target_invoice AND status IN ('ISSUED','PARTIALLY_PAID','OVERDUE') FOR UPDATE;
        IF NOT FOUND OR amount_value<=0 OR received IS NULL OR method_value NOT IN ('BANK_TRANSFER','EXTERNAL_REFERENCE','MANUAL_GATEWAY_CONFIRMATION') OR reference_scope_value !~ '^[A-Za-z0-9._-]{2,80}$' OR external_ref !~ '^[A-Za-z0-9._:/-]{3,200}$' THEN RAISE EXCEPTION 'invalid payment record' USING ERRCODE='22023'; END IF;
        IF amount_value>i.amount-i.paid_amount THEN RAISE EXCEPTION 'payment exceeds outstanding invoice balance' USING ERRCODE='22023'; END IF;
        INSERT INTO public.commercial_pilot_payments(business_id,invoice_id,currency,amount,method,reference_scope,external_reference,received_at,evidence_reference,created_by)
        VALUES(i.business_id,i.id,i.currency,amount_value,method_value,reference_scope_value,external_ref,received,evidence,session_user::text) RETURNING id INTO payment_id;
        INSERT INTO public.commercial_pilot_audit_events(business_id,enrollment_id,actor,action,affected_record,summary,evidence_reference) VALUES(i.business_id,i.enrollment_id,session_user::text,'PAYMENT_RECORDED',payment_id,jsonb_build_object('amount',amount_value,'currency',i.currency),evidence);
        RETURN payment_id;
      END $$;

      CREATE FUNCTION public.kleva_commercial_payment_confirm(target_payment uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE p public.commercial_pilot_payments%ROWTYPE; i public.commercial_pilot_invoices%ROWTYPE; next_paid numeric(14,2);
      BEGIN
        IF NOT pg_has_role(session_user,'kleva_commercial_payment_confirmer','member') THEN RAISE EXCEPTION 'commercial payment confirmation permission required' USING ERRCODE='42501'; END IF;
        SELECT * INTO p FROM public.commercial_pilot_payments WHERE id=target_payment FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'payment unavailable' USING ERRCODE='22023'; END IF;
        IF p.status='CONFIRMED' THEN RETURN true; END IF;
        IF p.status<>'RECORDED' THEN RAISE EXCEPTION 'payment is not confirmable' USING ERRCODE='22023'; END IF;
        SELECT * INTO i FROM public.commercial_pilot_invoices WHERE id=p.invoice_id AND business_id=p.business_id FOR UPDATE;
        IF p.currency<>i.currency OR p.amount>i.amount-i.paid_amount THEN RAISE EXCEPTION 'payment no longer fits invoice balance' USING ERRCODE='22023'; END IF;
        next_paid:=i.paid_amount+p.amount;
        UPDATE public.commercial_pilot_payments SET status='CONFIRMED',confirmed_by=session_user::text,confirmed_at=now() WHERE id=p.id;
        UPDATE public.commercial_pilot_invoices SET paid_amount=next_paid,status=CASE WHEN next_paid=amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END,updated_at=now() WHERE id=i.id;
        INSERT INTO public.commercial_pilot_audit_events(business_id,enrollment_id,actor,action,affected_record,summary,evidence_reference) SELECT i.business_id,i.enrollment_id,session_user::text,'PAYMENT_CONFIRMED',p.id,jsonb_build_object('amount',p.amount,'invoicePaid',next_paid),p.evidence_reference;
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_commercial_payment_reverse(target_payment uuid,reason text)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE p public.commercial_pilot_payments%ROWTYPE; i public.commercial_pilot_invoices%ROWTYPE;
      BEGIN
        IF NOT pg_has_role(session_user,'kleva_commercial_payment_confirmer','member') THEN RAISE EXCEPTION 'commercial payment confirmation permission required' USING ERRCODE='42501'; END IF;
        IF length(btrim(reason)) NOT BETWEEN 6 AND 200 THEN RAISE EXCEPTION 'reversal reason required' USING ERRCODE='22023'; END IF;
        SELECT * INTO p FROM public.commercial_pilot_payments WHERE id=target_payment FOR UPDATE;
        IF NOT FOUND OR p.status<>'CONFIRMED' THEN RAISE EXCEPTION 'confirmed payment required' USING ERRCODE='22023'; END IF;
        SELECT * INTO i FROM public.commercial_pilot_invoices WHERE id=p.invoice_id FOR UPDATE;
        UPDATE public.commercial_pilot_payments SET status='REVERSED' WHERE id=p.id;
        UPDATE public.commercial_pilot_invoices SET paid_amount=paid_amount-p.amount,status=CASE WHEN paid_amount-p.amount=0 THEN CASE WHEN due_at<now() THEN 'OVERDUE' ELSE 'ISSUED' END ELSE 'PARTIALLY_PAID' END,updated_at=now() WHERE id=i.id;
        INSERT INTO public.commercial_pilot_audit_events(business_id,enrollment_id,actor,action,affected_record,summary,evidence_reference) VALUES(i.business_id,i.enrollment_id,session_user::text,'PAYMENT_REVERSED',p.id,jsonb_build_object('reason',reason,'amount',p.amount),p.evidence_reference);
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_commercial_provision(target_enrollment uuid,event_key uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE e public.commercial_pilot_enrollments%ROWTYPE; old_limits jsonb; next_limits jsonb; period date:=date_trunc('month',now() AT TIME ZONE 'UTC')::date; used_ai bigint; used_output bigint; used_out bigint; used_emb bigint;
      BEGIN
        IF NOT pg_has_role(session_user,'kleva_commercial_entitlement_manager','member') THEN RAISE EXCEPTION 'commercial entitlement permission required' USING ERRCODE='42501'; END IF;
        IF event_key IS NULL THEN RAISE EXCEPTION 'idempotency key required' USING ERRCODE='22023'; END IF;
        SELECT * INTO e FROM public.commercial_pilot_enrollments WHERE id=target_enrollment AND status IN ('APPROVED','ACTIVE') FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'approved enrollment required' USING ERRCODE='22023'; END IF;
        IF EXISTS(SELECT 1 FROM public.commercial_pilot_entitlement_events WHERE business_id=e.business_id AND idempotency_key=event_key) THEN RETURN true; END IF;
        SELECT to_jsonb(l) INTO old_limits FROM public.business_usage_limits l WHERE business_id=e.business_id FOR UPDATE;
        old_limits:=COALESCE(old_limits,'{}'::jsonb);
        SELECT COALESCE(sum(reserved_amount-released_amount) FILTER(WHERE category='ai_input_tokens'),0),
          COALESCE(sum(reserved_amount-released_amount) FILTER(WHERE category='ai_output_tokens'),0),
          COALESCE(sum(reserved_amount-released_amount) FILTER(WHERE category='whatsapp_outbound'),0),
          COALESCE(sum(reserved_amount-released_amount) FILTER(WHERE category IN ('knowledge_embedding_tokens','live_embedding_tokens','playground_embedding_tokens')),0)
          INTO used_ai,used_output,used_out,used_emb FROM public.usage_reservations WHERE business_id=e.business_id AND period_start=period;
        IF COALESCE((e.allowances->>'aiInputTokens')::integer,0)<COALESCE(used_ai,0)
          OR COALESCE((e.allowances->>'aiOutputTokens')::integer,0)<COALESCE(used_output,0)
          OR COALESCE((e.allowances->>'whatsappOutbound')::integer,0)<COALESCE(used_out,0)
          OR COALESCE((e.allowances->>'embeddingTokens')::integer,0)<COALESCE(used_emb,0) THEN RAISE EXCEPTION 'new limits are below consumed or reserved usage' USING ERRCODE='22023'; END IF;
        next_limits:=jsonb_build_object('monthly_ai_input_tokens',COALESCE((e.allowances->>'aiInputTokens')::integer,0),'monthly_ai_output_tokens',COALESCE((e.allowances->>'aiOutputTokens')::integer,0),'monthly_embedding_tokens',COALESCE((e.allowances->>'embeddingTokens')::integer,0),'monthly_whatsapp_messages',CASE WHEN 'WHATSAPP'=ANY(e.channels) THEN COALESCE((e.allowances->>'whatsappOutbound')::integer,0) ELSE 0 END,'ai_tokens_per_request',e.per_request_ai_tokens);
        INSERT INTO public.business_usage_limits(business_id,monthly_ai_input_tokens,monthly_ai_output_tokens,monthly_embedding_tokens,monthly_whatsapp_messages,ai_tokens_per_request)
        VALUES(e.business_id,(next_limits->>'monthly_ai_input_tokens')::integer,(next_limits->>'monthly_ai_output_tokens')::integer,(next_limits->>'monthly_embedding_tokens')::integer,(next_limits->>'monthly_whatsapp_messages')::integer,(next_limits->>'ai_tokens_per_request')::integer)
        ON CONFLICT(business_id) DO UPDATE SET monthly_ai_input_tokens=EXCLUDED.monthly_ai_input_tokens,monthly_ai_output_tokens=EXCLUDED.monthly_ai_output_tokens,monthly_embedding_tokens=EXCLUDED.monthly_embedding_tokens,monthly_whatsapp_messages=EXCLUDED.monthly_whatsapp_messages,ai_tokens_per_request=EXCLUDED.ai_tokens_per_request;
        INSERT INTO public.commercial_pilot_entitlement_events(business_id,enrollment_id,idempotency_key,previous_limits,next_limits,actor) VALUES(e.business_id,e.id,event_key,old_limits,next_limits,session_user::text);
        INSERT INTO public.commercial_pilot_audit_events(business_id,enrollment_id,actor,action,affected_record,summary) VALUES(e.business_id,e.id,session_user::text,'ENTITLEMENTS_PROVISIONED',e.id,jsonb_build_object('eventKey',event_key,'limits',next_limits));
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_commercial_capacity_set(max_biz integer,max_web integer,max_wa integer,max_days integer,max_input integer,max_output integer,max_embed integer,max_whatsapp integer)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        IF NOT pg_has_role(session_user,'kleva_commercial_capacity_manager','member') THEN RAISE EXCEPTION 'commercial capacity permission required' USING ERRCODE='42501'; END IF;
        IF max_biz<=0 OR max_web<0 OR max_wa<0 OR max_days<=0 OR max_input<0 OR max_output<0 OR max_embed<0 OR max_whatsapp<0 THEN RAISE EXCEPTION 'invalid capacity values' USING ERRCODE='22023'; END IF;
        UPDATE public.commercial_pilot_capacity SET max_businesses=max_biz,max_website_pilots=max_web,max_whatsapp_pilots=max_wa,max_pilot_days=max_days,max_monthly_ai_input_tokens=max_input,max_monthly_ai_output_tokens=max_output,max_monthly_embedding_tokens=max_embed,max_monthly_whatsapp_outbound=max_whatsapp,updated_by=session_user::text,updated_at=now() WHERE singleton;
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_commercial_invoice_status_refresh()
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE changed integer; expired integer;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' THEN RAISE EXCEPTION 'commercial expiry worker role required' USING ERRCODE='42501'; END IF;
        WITH overdue_rows AS (
          UPDATE public.commercial_pilot_invoices SET status='OVERDUE',updated_at=now()
          WHERE status IN ('ISSUED','PARTIALLY_PAID') AND due_at<now()
          RETURNING business_id,enrollment_id,id
        ) INSERT INTO public.commercial_pilot_audit_events(business_id,enrollment_id,actor,action,affected_record,summary)
          SELECT business_id,enrollment_id,'kleva_commercial_expiry_worker','INVOICE_OVERDUE',id,jsonb_build_object('checkedAt',now()) FROM overdue_rows;
        GET DIAGNOSTICS changed=ROW_COUNT;
        WITH expired_rows AS (
          UPDATE public.commercial_pilot_enrollments SET status='EXPIRED',updated_at=now()
          WHERE status='ACTIVE' AND pilot_end_at<=now()
          RETURNING business_id,id
        ) INSERT INTO public.commercial_pilot_audit_events(business_id,enrollment_id,actor,action,affected_record,summary)
          SELECT business_id,id,'kleva_commercial_expiry_worker','PILOT_EXPIRED',id,jsonb_build_object('expiredAt',now()) FROM expired_rows;
        GET DIAGNOSTICS expired=ROW_COUNT;
        RETURN jsonb_build_object('overdueInvoices',changed,'expiredPilots',expired);
      END $$;

      REVOKE ALL ON FUNCTION public.kleva_commercial_read(),public.kleva_commercial_readiness(),public.kleva_commercial_offer_accept(uuid,uuid),public.kleva_commercial_create_package(text,text,text,numeric,text,integer,text[],jsonb,integer,jsonb),public.kleva_commercial_package_version_create(uuid,text,text,numeric,text,integer,text[],jsonb,integer,jsonb),public.kleva_commercial_package_approve(uuid),public.kleva_commercial_offer_create(uuid,uuid,uuid,text,text),public.kleva_commercial_approve(uuid,timestamptz),public.kleva_commercial_activate(uuid),public.kleva_commercial_invoice_create(uuid,text,timestamptz,text),public.kleva_commercial_invoice_issue(uuid),public.kleva_commercial_payment_record(uuid,numeric,text,text,text,timestamptz,text),public.kleva_commercial_payment_confirm(uuid),public.kleva_commercial_payment_reverse(uuid,text),public.kleva_commercial_provision(uuid,uuid),public.kleva_commercial_capacity_set(integer,integer,integer,integer,integer,integer,integer,integer),public.kleva_commercial_invoice_status_refresh() FROM PUBLIC;
      DO $$ DECLARE r text; BEGIN
        FOR r IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_merchant_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_commercial_read(),public.kleva_commercial_readiness(),public.kleva_commercial_offer_accept(uuid,uuid) TO %I',r);
        END LOOP;
        IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='kleva_commercial_package_manager') THEN
          GRANT EXECUTE ON FUNCTION public.kleva_commercial_create_package(text,text,text,numeric,text,integer,text[],jsonb,integer,jsonb),public.kleva_commercial_package_version_create(uuid,text,text,numeric,text,integer,text[],jsonb,integer,jsonb),public.kleva_commercial_package_approve(uuid) TO kleva_commercial_package_manager;
        END IF;
        IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='kleva_commercial_enrollment_manager') THEN
          GRANT EXECUTE ON FUNCTION public.kleva_commercial_offer_create(uuid,uuid,uuid,text,text),public.kleva_commercial_approve(uuid,timestamptz),public.kleva_commercial_activate(uuid) TO kleva_commercial_enrollment_manager;
        END IF;
        IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='kleva_commercial_invoice_manager') THEN
          GRANT EXECUTE ON FUNCTION public.kleva_commercial_invoice_create(uuid,text,timestamptz,text),public.kleva_commercial_invoice_issue(uuid) TO kleva_commercial_invoice_manager;
        END IF;
        IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='kleva_commercial_payment_recorder') THEN
          GRANT EXECUTE ON FUNCTION public.kleva_commercial_payment_record(uuid,numeric,text,text,text,timestamptz,text) TO kleva_commercial_payment_recorder;
        END IF;
        IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='kleva_commercial_payment_confirmer') THEN
          GRANT EXECUTE ON FUNCTION public.kleva_commercial_payment_confirm(uuid),public.kleva_commercial_payment_reverse(uuid,text) TO kleva_commercial_payment_confirmer;
        END IF;
        IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='kleva_commercial_entitlement_manager') THEN
          GRANT EXECUTE ON FUNCTION public.kleva_commercial_provision(uuid,uuid) TO kleva_commercial_entitlement_manager;
        END IF;
        IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='kleva_commercial_capacity_manager') THEN
          GRANT EXECUTE ON FUNCTION public.kleva_commercial_capacity_set(integer,integer,integer,integer,integer,integer,integer,integer) TO kleva_commercial_capacity_manager;
        END IF;
        FOR r IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_commercial_invoice_status_refresh() TO %I',r);
        END LOOP;
      END $$;
    `);
  }

  async down(r: QueryRunner): Promise<void> {
    await r.query(`
      REVOKE EXECUTE ON FUNCTION public.kleva_commercial_read(),public.kleva_commercial_readiness(),public.kleva_commercial_offer_accept(uuid,uuid),public.kleva_commercial_create_package(text,text,text,numeric,text,integer,text[],jsonb,integer,jsonb),public.kleva_commercial_package_version_create(uuid,text,text,numeric,text,integer,text[],jsonb,integer,jsonb),public.kleva_commercial_package_approve(uuid),public.kleva_commercial_offer_create(uuid,uuid,uuid,text,text),public.kleva_commercial_approve(uuid,timestamptz),public.kleva_commercial_activate(uuid),public.kleva_commercial_invoice_create(uuid,text,timestamptz,text),public.kleva_commercial_invoice_issue(uuid),public.kleva_commercial_payment_record(uuid,numeric,text,text,text,timestamptz,text),public.kleva_commercial_payment_confirm(uuid),public.kleva_commercial_payment_reverse(uuid,text),public.kleva_commercial_provision(uuid,uuid),public.kleva_commercial_capacity_set(integer,integer,integer,integer,integer,integer,integer,integer),public.kleva_commercial_invoice_status_refresh() FROM PUBLIC;
      DROP FUNCTION public.kleva_commercial_invoice_status_refresh();
      DROP FUNCTION public.kleva_commercial_capacity_set(integer,integer,integer,integer,integer,integer,integer,integer);
      DROP FUNCTION public.kleva_commercial_provision(uuid,uuid);
      DROP FUNCTION public.kleva_commercial_payment_reverse(uuid,text);
      DROP FUNCTION public.kleva_commercial_payment_confirm(uuid);
      DROP FUNCTION public.kleva_commercial_payment_record(uuid,numeric,text,text,text,timestamptz,text);
      DROP FUNCTION public.kleva_commercial_invoice_issue(uuid);
      DROP FUNCTION public.kleva_commercial_invoice_create(uuid,text,timestamptz,text);
      DROP FUNCTION public.kleva_commercial_approve(uuid,timestamptz);
      DROP FUNCTION public.kleva_commercial_activate(uuid);
      DROP FUNCTION public.kleva_commercial_offer_create(uuid,uuid,uuid,text,text);
      DROP FUNCTION public.kleva_commercial_package_approve(uuid);
      DROP FUNCTION public.kleva_commercial_package_version_create(uuid,text,text,numeric,text,integer,text[],jsonb,integer,jsonb);
      DROP FUNCTION public.kleva_commercial_create_package(text,text,text,numeric,text,integer,text[],jsonb,integer,jsonb);
      DROP FUNCTION public.kleva_commercial_offer_accept(uuid,uuid);
      DROP FUNCTION public.kleva_commercial_readiness();
      DROP FUNCTION public.kleva_commercial_read();
      DROP TABLE public.commercial_pilot_audit_events,public.commercial_pilot_entitlement_events,public.commercial_pilot_payments,public.commercial_pilot_invoices,public.commercial_pilot_agreements,public.commercial_pilot_enrollments,public.commercial_pilot_package_versions,public.commercial_pilot_packages,public.commercial_pilot_capacity;
      DROP FUNCTION public.kleva_commercial_immutable();
    `);
  }
}
