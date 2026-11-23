import type { MigrationInterface, QueryRunner } from 'typeorm';

export class LeadQualification1760000000026 implements MigrationInterface {
  name = 'LeadQualification1760000000026';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE public.sales_qualification_policies (
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
        version integer NOT NULL CHECK (version > 0),
        fields jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'array'),
        changed_by uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (business_id, version)
      );
      CREATE TABLE public.merchant_lead_qualifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        lead_id uuid NOT NULL,
        revision integer NOT NULL CHECK (revision > 0),
        policy_version integer NOT NULL,
        field_values jsonb NOT NULL CHECK (jsonb_typeof(field_values) = 'object'),
        consent_evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(consent_evidence) = 'object'),
        qualification_status varchar(16) NOT NULL CHECK (qualification_status IN ('IN_PROGRESS','QUALIFIED')),
        qualified_by uuid REFERENCES public.accounts(id) ON DELETE RESTRICT,
        qualified_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (business_id, lead_id) REFERENCES public.merchant_leads(business_id,id) ON DELETE CASCADE,
        FOREIGN KEY (business_id, policy_version) REFERENCES public.sales_qualification_policies(business_id,version) ON DELETE RESTRICT,
        UNIQUE (business_id, lead_id, revision),
        CHECK ((qualification_status = 'QUALIFIED' AND qualified_by IS NOT NULL AND qualified_at IS NOT NULL)
          OR (qualification_status = 'IN_PROGRESS' AND qualified_at IS NULL))
      );
      CREATE INDEX idx_lead_qualifications_latest ON public.merchant_lead_qualifications(business_id,lead_id,revision DESC);
      CREATE TABLE public.merchant_lead_conversions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        lead_id uuid NOT NULL,
        outcome varchar(8) NOT NULL CHECK (outcome IN ('WON','LOST')),
        reference varchar(120),
        conversion_value numeric(14,2) CHECK (conversion_value IS NULL OR conversion_value >= 0),
        currency char(3),
        conversion_date date,
        loss_reason varchar(500),
        converted_by uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
        idempotency_key uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (business_id, lead_id) REFERENCES public.merchant_leads(business_id,id) ON DELETE CASCADE,
        UNIQUE (business_id, lead_id),
        UNIQUE (business_id, idempotency_key),
        CHECK ((outcome = 'WON' AND loss_reason IS NULL)
          OR (outcome = 'LOST' AND reference IS NULL AND conversion_value IS NULL AND currency IS NULL)),
        CHECK ((conversion_value IS NULL AND currency IS NULL) OR (conversion_value IS NOT NULL AND currency IS NOT NULL))
      );
      CREATE INDEX idx_lead_conversions_tenant ON public.merchant_lead_conversions(business_id,lead_id,created_at DESC);

      ALTER TABLE public.sales_qualification_policies ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.sales_qualification_policies FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.merchant_lead_qualifications ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.merchant_lead_qualifications FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.merchant_lead_conversions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.merchant_lead_conversions FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_sales_qualification_internal ON public.sales_qualification_policies
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
      CREATE POLICY kleva_lead_qualifications_internal ON public.merchant_lead_qualifications
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
      CREATE POLICY kleva_lead_conversions_internal ON public.merchant_lead_conversions
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE FUNCTION public.kleva_sales_policy_read()
      RETURNS TABLE(version integer, fields jsonb, changed_by uuid, updated_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT p.version,p.fields,p.changed_by,p.created_at
        FROM public.sales_qualification_policies p
        WHERE p.business_id=NULLIF(current_setting('kleva.business_id',true),'')::uuid
          AND public.kleva_current_role() IN ('owner','editor')
        ORDER BY p.version DESC LIMIT 1
      $$;

      CREATE FUNCTION public.kleva_sales_policy_history()
      RETURNS TABLE(version integer, fields jsonb, changed_by uuid, created_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT p.version,p.fields,p.changed_by,p.created_at
        FROM public.sales_qualification_policies p
        WHERE p.business_id=NULLIF(current_setting('kleva.business_id',true),'')::uuid
          AND public.kleva_current_role() IN ('owner','editor')
        ORDER BY p.version DESC LIMIT 20
      $$;

      CREATE FUNCTION public.kleva_sales_policy_save(expected_version integer, new_fields jsonb)
      RETURNS TABLE(version integer, fields jsonb, changed_by uuid, updated_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        actor_id uuid:=public.kleva_current_account(); current_version integer;
      BEGIN
        IF public.kleva_current_role() NOT IN ('owner','editor') OR actor_id IS NULL
          OR jsonb_typeof(new_fields) <> 'array' OR jsonb_array_length(new_fields) > 20 THEN
          RAISE EXCEPTION 'sales policy access denied' USING ERRCODE='42501';
        END IF;
        SELECT max(p.version) INTO current_version FROM public.sales_qualification_policies p WHERE p.business_id=tenant_id;
        current_version:=COALESCE(current_version,0);
        IF current_version<>expected_version THEN RAISE EXCEPTION 'sales policy version conflict' USING ERRCODE='40001'; END IF;
        INSERT INTO public.sales_qualification_policies(business_id,version,fields,changed_by)
          VALUES(tenant_id,current_version+1,new_fields,actor_id);
        RETURN QUERY SELECT current_version+1,new_fields,actor_id,now();
      END $$;

      CREATE FUNCTION public.kleva_lead_qualification_read(target_id uuid)
      RETURNS TABLE(id uuid,lead_id uuid,revision integer,policy_version integer,field_values jsonb,
        consent_evidence jsonb,qualification_status text,qualified_by uuid,qualified_at timestamptz,created_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT q.id,q.lead_id,q.revision,q.policy_version,q.field_values,q.consent_evidence,
          q.qualification_status,q.qualified_by,q.qualified_at,q.created_at
        FROM public.merchant_lead_qualifications q
        WHERE q.lead_id=target_id
          AND q.business_id=NULLIF(current_setting('kleva.business_id',true),'')::uuid
          AND public.kleva_current_role() IN ('owner','agent','editor')
        ORDER BY q.revision DESC LIMIT 1
      $$;

      CREATE FUNCTION public.kleva_lead_qualification_history(target_id uuid)
      RETURNS TABLE(id uuid,revision integer,policy_version integer,field_values jsonb,consent_evidence jsonb,
        qualification_status text,qualified_by uuid,qualified_at timestamptz,created_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT q.id,q.revision,q.policy_version,q.field_values,q.consent_evidence,
          q.qualification_status,q.qualified_by,q.qualified_at,q.created_at
        FROM public.merchant_lead_qualifications q
        WHERE q.lead_id=target_id
          AND q.business_id=NULLIF(current_setting('kleva.business_id',true),'')::uuid
          AND public.kleva_current_role() IN ('owner','agent','editor')
        ORDER BY q.revision DESC LIMIT 20
      $$;

      CREATE FUNCTION public.kleva_lead_qualification_save(target_id uuid, expected_lead_version bigint,
        target_policy_version integer, new_values jsonb, new_consent jsonb, mark_qualified boolean)
      RETURNS TABLE(lead_id uuid,revision integer,policy_version integer,qualification_status text,
        lead_status text,lead_version bigint,qualified_by uuid,qualified_at timestamptz,created_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        actor_id uuid:=public.kleva_current_account(); old_status text; current_version bigint;
        revision_no integer; qualified_time timestamptz;
      BEGIN
        IF public.kleva_current_role() NOT IN ('owner','agent','editor') OR actor_id IS NULL
          OR jsonb_typeof(new_values)<>'object' OR jsonb_typeof(new_consent)<>'object' THEN
          RAISE EXCEPTION 'lead qualification access denied' USING ERRCODE='42501';
        END IF;
        SELECT l.status,l.version INTO old_status,current_version FROM public.merchant_leads l
          WHERE l.id=target_id AND l.business_id=tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        IF current_version<>expected_lead_version THEN RAISE EXCEPTION 'lead version conflict' USING ERRCODE='40001'; END IF;
        IF old_status IN ('WON','LOST') THEN RAISE EXCEPTION 'lead is already closed' USING ERRCODE='23514'; END IF;
        IF mark_qualified AND old_status<>'CONTACTED' AND old_status<>'QUALIFIED' THEN
          RAISE EXCEPTION 'lead must be contacted before qualification' USING ERRCODE='23514';
        END IF;
        IF old_status='QUALIFIED' AND NOT mark_qualified THEN
          RAISE EXCEPTION 'qualified leads must stay qualified while editing details' USING ERRCODE='23514';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.sales_qualification_policies p
          WHERE p.business_id=tenant_id AND p.version=target_policy_version) THEN
          RAISE EXCEPTION 'sales policy version is stale' USING ERRCODE='40001';
        END IF;
        SELECT COALESCE(max(q.revision),0)+1 INTO revision_no FROM public.merchant_lead_qualifications q
          WHERE q.business_id=tenant_id AND q.lead_id=target_id;
        IF mark_qualified THEN qualified_time:=now(); END IF;
        INSERT INTO public.merchant_lead_qualifications(business_id,lead_id,revision,policy_version,field_values,
          consent_evidence,qualification_status,qualified_by,qualified_at)
          VALUES(tenant_id,target_id,revision_no,target_policy_version,new_values,new_consent,
            CASE WHEN mark_qualified THEN 'QUALIFIED' ELSE 'IN_PROGRESS' END,
            CASE WHEN mark_qualified THEN actor_id ELSE NULL END,qualified_time);
        UPDATE public.merchant_leads SET status=CASE WHEN mark_qualified THEN 'QUALIFIED' ELSE old_status END,
          version=current_version+1,updated_at=now()
          WHERE id=target_id AND business_id=tenant_id RETURNING version INTO current_version;
        IF mark_qualified AND old_status<>'QUALIFIED' THEN
          INSERT INTO public.merchant_lead_events(business_id,lead_id,event_type,previous_status,next_status,actor_kind,actor_account_id)
            VALUES(tenant_id,target_id,'STATUS_CHANGED',old_status,'QUALIFIED','MERCHANT',actor_id);
        END IF;
        RETURN QUERY SELECT target_id,revision_no,target_policy_version,
          CASE WHEN mark_qualified THEN 'QUALIFIED' ELSE 'IN_PROGRESS' END,
          CASE WHEN mark_qualified THEN 'QUALIFIED' ELSE old_status END,current_version,
          CASE WHEN mark_qualified THEN actor_id ELSE NULL END,qualified_time,now();
      END $$;

      CREATE FUNCTION public.kleva_lead_convert(target_id uuid,expected_lead_version bigint,outcome_value text,
        conversion_data jsonb,request_key uuid)
      RETURNS TABLE(lead_id uuid,outcome text,lead_version bigint,conversion_id uuid,created_at timestamptz,changed boolean)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        actor_id uuid:=public.kleva_current_account(); old_status text; current_version bigint;
        conversion_row public.merchant_lead_conversions%ROWTYPE; new_status text;
      BEGIN
        IF public.kleva_current_role() NOT IN ('owner','agent') OR actor_id IS NULL
          OR outcome_value NOT IN ('WON','LOST') OR jsonb_typeof(conversion_data)<>'object' OR request_key IS NULL THEN
          RAISE EXCEPTION 'lead conversion access denied' USING ERRCODE='42501';
        END IF;
        SELECT c.* INTO conversion_row FROM public.merchant_lead_conversions c
          WHERE c.business_id=tenant_id AND c.lead_id=target_id;
        IF FOUND THEN
          IF conversion_row.idempotency_key=request_key THEN
            RETURN QUERY SELECT target_id,conversion_row.outcome::text,
              (SELECT l.version FROM public.merchant_leads l WHERE l.id=target_id AND l.business_id=tenant_id),
              conversion_row.id,conversion_row.created_at,false;
            RETURN;
          END IF;
          RAISE EXCEPTION 'lead already converted' USING ERRCODE='23505';
        END IF;
        SELECT l.status,l.version INTO old_status,current_version FROM public.merchant_leads l
          WHERE l.id=target_id AND l.business_id=tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        SELECT c.* INTO conversion_row FROM public.merchant_lead_conversions c
          WHERE c.business_id=tenant_id AND c.lead_id=target_id;
        IF FOUND THEN
          IF conversion_row.idempotency_key=request_key THEN
            RETURN QUERY SELECT target_id,conversion_row.outcome::text,
              (SELECT l.version FROM public.merchant_leads l WHERE l.id=target_id AND l.business_id=tenant_id),
              conversion_row.id,conversion_row.created_at,false;
            RETURN;
          END IF;
          RAISE EXCEPTION 'lead already converted' USING ERRCODE='23505';
        END IF;
        IF current_version<>expected_lead_version THEN RAISE EXCEPTION 'lead version conflict' USING ERRCODE='40001'; END IF;
        IF old_status IN ('WON','LOST') THEN RAISE EXCEPTION 'lead is already closed' USING ERRCODE='23505'; END IF;
        IF outcome_value='WON' AND old_status<>'QUALIFIED' THEN
          RAISE EXCEPTION 'only qualified leads can be marked won' USING ERRCODE='23514';
        END IF;
        new_status:=outcome_value;
        INSERT INTO public.merchant_lead_conversions(business_id,lead_id,outcome,reference,conversion_value,currency,
          conversion_date,loss_reason,converted_by,idempotency_key)
          VALUES(tenant_id,target_id,outcome_value,conversion_data->>'reference',
            NULLIF(conversion_data->>'value','')::numeric,conversion_data->>'currency',
            NULLIF(conversion_data->>'conversionDate','')::date,conversion_data->>'lossReason',actor_id,request_key)
          RETURNING * INTO conversion_row;
        UPDATE public.merchant_leads SET status=new_status,version=current_version+1,updated_at=now()
          WHERE id=target_id AND business_id=tenant_id RETURNING version INTO current_version;
        INSERT INTO public.merchant_lead_events(business_id,lead_id,event_type,previous_status,next_status,actor_kind,actor_account_id)
          VALUES(tenant_id,target_id,'STATUS_CHANGED',old_status,new_status,'MERCHANT',actor_id);
        RETURN QUERY SELECT target_id,new_status,current_version,conversion_row.id,conversion_row.created_at,true;
      END $$;

      CREATE FUNCTION public.kleva_lead_conversion_history(target_id uuid)
      RETURNS TABLE(id uuid,outcome text,reference text,conversion_value numeric,currency text,conversion_date date,
        loss_reason text,converted_by uuid,created_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT c.id,c.outcome,c.reference,c.conversion_value,c.currency,c.conversion_date,c.loss_reason,c.converted_by,c.created_at
        FROM public.merchant_lead_conversions c
        WHERE c.lead_id=target_id AND c.business_id=NULLIF(current_setting('kleva.business_id',true),'')::uuid
          AND public.kleva_current_role() IN ('owner','agent') ORDER BY c.created_at DESC LIMIT 20
      $$;

      CREATE OR REPLACE FUNCTION public.kleva_lead_change_status(target_id uuid,next_value text,expected_version bigint)
      RETURNS TABLE(id uuid,status text,version bigint,updated_at timestamptz,changed boolean)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        actor_id uuid:=public.kleva_current_account(); old_value text; current_version bigint; changed_at timestamptz;
      BEGIN
        IF public.kleva_current_role() NOT IN ('owner','agent') OR actor_id IS NULL
          OR next_value NOT IN ('NEW','CONTACTED') THEN
          RAISE EXCEPTION 'lead access denied' USING ERRCODE='42501';
        END IF;
        SELECT l.status,l.version,l.updated_at INTO old_value,current_version,changed_at
          FROM public.merchant_leads l WHERE l.id=target_id AND l.business_id=tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        IF old_value IN ('QUALIFIED','WON','LOST') THEN RAISE EXCEPTION 'lead must be updated through qualification or conversion' USING ERRCODE='23514'; END IF;
        IF old_value='CONTACTED' AND next_value='NEW' THEN
          RAISE EXCEPTION 'lead lifecycle cannot move backwards' USING ERRCODE='23514';
        END IF;
        IF old_value=next_value THEN RETURN QUERY SELECT target_id,old_value,current_version,changed_at,false; RETURN; END IF;
        IF current_version<>expected_version THEN RAISE EXCEPTION 'lead version conflict' USING ERRCODE='40001'; END IF;
        UPDATE public.merchant_leads SET status=next_value,version=current_version+1,updated_at=now()
          WHERE merchant_leads.id=target_id AND merchant_leads.business_id=tenant_id
          RETURNING merchant_leads.version,merchant_leads.updated_at INTO current_version,changed_at;
        INSERT INTO public.merchant_lead_events(business_id,lead_id,event_type,previous_status,next_status,actor_kind,actor_account_id)
          VALUES(tenant_id,target_id,'STATUS_CHANGED',old_value,next_value,'MERCHANT',actor_id);
        RETURN QUERY SELECT target_id,next_value,current_version,changed_at,true;
      END $$;
      REVOKE ALL ON FUNCTION public.kleva_sales_policy_read(), public.kleva_sales_policy_history(),
        public.kleva_sales_policy_save(integer,jsonb), public.kleva_lead_qualification_read(uuid),
        public.kleva_lead_qualification_history(uuid), public.kleva_lead_qualification_save(uuid,bigint,integer,jsonb,jsonb,boolean),
        public.kleva_lead_convert(uuid,bigint,text,jsonb,uuid), public.kleva_lead_conversion_history(uuid),
        public.kleva_lead_change_status(uuid,text,bigint) FROM PUBLIC;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM public.sales_qualification_policies)
          OR EXISTS (SELECT 1 FROM public.merchant_lead_qualifications)
          OR EXISTS (SELECT 1 FROM public.merchant_lead_conversions) THEN
          RAISE EXCEPTION 'Lead qualification history exists; preserve this migration.';
        END IF;
      END $$;
      DROP FUNCTION public.kleva_lead_conversion_history(uuid);
      DROP FUNCTION public.kleva_lead_convert(uuid,bigint,text,jsonb,uuid);
      DROP FUNCTION public.kleva_lead_qualification_save(uuid,bigint,integer,jsonb,jsonb,boolean);
      DROP FUNCTION public.kleva_lead_qualification_history(uuid);
      DROP FUNCTION public.kleva_lead_qualification_read(uuid);
      DROP FUNCTION public.kleva_sales_policy_save(integer,jsonb);
      DROP FUNCTION public.kleva_sales_policy_history();
      DROP FUNCTION public.kleva_sales_policy_read();
      DROP TABLE public.merchant_lead_conversions;
      DROP TABLE public.merchant_lead_qualifications;
      DROP TABLE public.sales_qualification_policies;
      CREATE OR REPLACE FUNCTION public.kleva_lead_change_status(target_id uuid,next_value text,expected_version bigint)
      RETURNS TABLE(id uuid,status text,version bigint,updated_at timestamptz,changed boolean)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        actor_id uuid:=public.kleva_current_account(); old_value text; current_version bigint; changed_at timestamptz;
      BEGIN
        IF public.kleva_current_role() NOT IN ('owner','agent') OR actor_id IS NULL
          OR next_value NOT IN ('NEW','CONTACTED','QUALIFIED','WON','LOST') THEN
          RAISE EXCEPTION 'lead access denied' USING ERRCODE='42501';
        END IF;
        SELECT l.status,l.version,l.updated_at INTO old_value,current_version,changed_at
          FROM public.merchant_leads l WHERE l.id=target_id AND l.business_id=tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        IF old_value=next_value THEN RETURN QUERY SELECT target_id,old_value,current_version,changed_at,false; RETURN; END IF;
        IF current_version<>expected_version THEN RAISE EXCEPTION 'lead version conflict' USING ERRCODE='40001'; END IF;
        UPDATE public.merchant_leads SET status=next_value,version=current_version+1,updated_at=now()
          WHERE merchant_leads.id=target_id AND merchant_leads.business_id=tenant_id
          RETURNING merchant_leads.version,merchant_leads.updated_at INTO current_version,changed_at;
        INSERT INTO public.merchant_lead_events(business_id,lead_id,event_type,previous_status,next_status,actor_kind,actor_account_id)
          VALUES(tenant_id,target_id,'STATUS_CHANGED',old_value,next_value,'MERCHANT',actor_id);
        RETURN QUERY SELECT target_id,next_value,current_version,changed_at,true;
      END $$;
    `);
  }
}
