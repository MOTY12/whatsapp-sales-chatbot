import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MerchantLeads1760000000016 implements MigrationInterface {
  name = 'MerchantLeads1760000000016';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE public.merchant_leads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        customer_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        source varchar(16) NOT NULL DEFAULT 'WHATSAPP' CHECK (source = 'WHATSAPP'),
        status varchar(16) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONTACTED','QUALIFIED','WON','LOST')),
        first_contact_at timestamptz NOT NULL,
        last_activity_at timestamptz NOT NULL,
        version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_merchant_leads_customer FOREIGN KEY (business_id, customer_id)
          REFERENCES public.customers("businessId", id) ON DELETE CASCADE,
        CONSTRAINT fk_merchant_leads_conversation FOREIGN KEY (business_id, conversation_id)
          REFERENCES public.conversations("businessId", id) ON DELETE CASCADE,
        CONSTRAINT uq_merchant_leads_conversation UNIQUE (business_id, conversation_id),
        CONSTRAINT uq_merchant_leads_tenant_id UNIQUE (business_id, id)
      );
      CREATE INDEX idx_merchant_leads_activity ON public.merchant_leads(business_id, last_activity_at DESC, id DESC);
      CREATE INDEX idx_merchant_leads_status_activity ON public.merchant_leads(business_id, status, last_activity_at DESC, id DESC);
      CREATE TABLE public.merchant_lead_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        lead_id uuid NOT NULL,
        event_type varchar(16) NOT NULL CHECK (event_type IN ('CREATED','STATUS_CHANGED')),
        previous_status varchar(16) CHECK (previous_status IN ('NEW','CONTACTED','QUALIFIED','WON','LOST')),
        next_status varchar(16) NOT NULL CHECK (next_status IN ('NEW','CONTACTED','QUALIFIED','WON','LOST')),
        actor_kind varchar(8) NOT NULL CHECK (actor_kind IN ('SYSTEM','MERCHANT')),
        actor_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (business_id, lead_id) REFERENCES public.merchant_leads(business_id,id) ON DELETE CASCADE,
        CHECK ((actor_kind = 'SYSTEM' AND actor_account_id IS NULL) OR actor_kind = 'MERCHANT'),
        UNIQUE (lead_id, event_type, created_at)
      );
      CREATE INDEX idx_merchant_lead_events_tenant ON public.merchant_lead_events(business_id, lead_id, created_at DESC);
      ALTER TABLE public.merchant_leads ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.merchant_leads FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.merchant_lead_events ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.merchant_lead_events FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_merchant_leads_internal ON public.merchant_leads
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
      CREATE POLICY kleva_merchant_lead_events_internal ON public.merchant_lead_events
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE FUNCTION public.kleva_leads_list(page_size integer, before_time timestamptz, before_id uuid, status_filter text)
      RETURNS TABLE(id uuid, customer_id uuid, conversation_id uuid, customer_name text, customer_whatsapp_id text,
        source text, status text, first_contact_at timestamptz, last_activity_at timestamptz, version bigint, updated_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT l.id,l.customer_id,l.conversation_id,c.name::text,c."whatsappId"::text,l.source,l.status,
          l.first_contact_at,l.last_activity_at,l.version,l.updated_at
        FROM public.merchant_leads l JOIN public.customers c ON c.id=l.customer_id AND c."businessId"=l.business_id
        WHERE l.business_id=NULLIF(current_setting('kleva.business_id',true),'')::uuid
          AND public.kleva_current_role() IN ('owner','agent')
          AND (status_filter IS NULL OR l.status=status_filter)
          AND (before_time IS NULL OR (l.last_activity_at,l.id)<(before_time,before_id))
        ORDER BY l.last_activity_at DESC,l.id DESC LIMIT LEAST(GREATEST(page_size,1),101)
      $$;
      CREATE FUNCTION public.kleva_lead_detail(target_id uuid)
      RETURNS TABLE(id uuid, customer_id uuid, conversation_id uuid, customer_name text, customer_whatsapp_id text,
        source text,status text,first_contact_at timestamptz,last_activity_at timestamptz,version bigint,updated_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT l.id,l.customer_id,l.conversation_id,c.name::text,c."whatsappId"::text,l.source,l.status,
          l.first_contact_at,l.last_activity_at,l.version,l.updated_at
        FROM public.merchant_leads l JOIN public.customers c ON c.id=l.customer_id AND c."businessId"=l.business_id
        WHERE l.id=target_id AND l.business_id=NULLIF(current_setting('kleva.business_id',true),'')::uuid
          AND public.kleva_current_role() IN ('owner','agent')
      $$;
      CREATE FUNCTION public.kleva_lead_change_status(target_id uuid,next_value text,expected_version bigint)
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
      REVOKE ALL ON FUNCTION public.kleva_leads_list(integer,timestamptz,uuid,text), public.kleva_lead_detail(uuid),
        public.kleva_lead_change_status(uuid,text,bigint) FROM PUBLIC;
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DROP FUNCTION public.kleva_lead_change_status(uuid,text,bigint);
      DROP FUNCTION public.kleva_lead_detail(uuid);
      DROP FUNCTION public.kleva_leads_list(integer,timestamptz,uuid,text);
      DROP TABLE public.merchant_lead_events;
      DROP TABLE public.merchant_leads;
    `);
  }
}
