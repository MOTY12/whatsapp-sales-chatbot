import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Native website widget/session schema; existing WhatsApp identifiers remain unchanged. */
export class WebsiteChat1760000000030 implements MigrationInterface {
  name = 'WebsiteChat1760000000030';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE public.customers ALTER COLUMN phone DROP NOT NULL;
      ALTER TABLE public.customers ALTER COLUMN "whatsappId" DROP NOT NULL;
      DROP INDEX public."IDX_customers_businessId_phone";
      CREATE UNIQUE INDEX "IDX_customers_businessId_phone" ON public.customers("businessId",phone)
        WHERE source IS DISTINCT FROM 'website';
      ALTER TABLE public.merchant_leads DROP CONSTRAINT merchant_leads_source_check;
      ALTER TABLE public.merchant_leads ALTER COLUMN source SET DEFAULT 'WHATSAPP';
      ALTER TABLE public.merchant_leads ADD CONSTRAINT merchant_leads_source_check CHECK (source IN ('WHATSAPP','WEBSITE'));
      ALTER TABLE public.conversations ADD COLUMN channel varchar(16) NOT NULL DEFAULT 'WHATSAPP'
        CHECK (channel IN ('WHATSAPP','WEBSITE'));
      ALTER TABLE public.messages ADD COLUMN channel varchar(16) NOT NULL DEFAULT 'WHATSAPP'
        CHECK (channel IN ('WHATSAPP','WEBSITE')),
        ADD COLUMN external_message_id varchar(200),
        ADD COLUMN idempotency_key varchar(100);
      CREATE UNIQUE INDEX uq_messages_channel_external_id
        ON public.messages("businessId",channel,external_message_id) WHERE external_message_id IS NOT NULL;
      CREATE UNIQUE INDEX uq_messages_channel_idempotency
        ON public.messages("businessId",channel,idempotency_key) WHERE idempotency_key IS NOT NULL;
      ALTER TABLE public.ai_response_runs ADD COLUMN channel varchar(16) NOT NULL DEFAULT 'WHATSAPP'
        CHECK (channel IN ('WHATSAPP','WEBSITE')),
        ADD COLUMN website_widget_id uuid;
      ALTER TABLE public.knowledge_gap_occurrences DROP CONSTRAINT knowledge_gap_occurrences_channel_check;
      ALTER TABLE public.knowledge_gap_occurrences ADD CONSTRAINT knowledge_gap_occurrences_channel_check
        CHECK (channel IN ('WHATSAPP','WEBSITE'));

      CREATE TABLE public.website_widgets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        channel_connection_id uuid UNIQUE,
        public_id varchar(48) NOT NULL UNIQUE CHECK (public_id ~ '^[A-Za-z0-9_-]{32,48}$'),
        name varchar(80) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
        enabled boolean NOT NULL DEFAULT false,
        ai_enabled boolean NOT NULL DEFAULT false,
        configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_website_widgets_business_id UNIQUE (business_id,id),
        CHECK (jsonb_typeof(configuration)='object'),
        CONSTRAINT fk_website_widgets_business FOREIGN KEY (business_id)
          REFERENCES public.businesses(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_website_widgets_business ON public.website_widgets(business_id,created_at DESC);
      CREATE TABLE public.website_widget_domains (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        widget_id uuid NOT NULL,
        origin varchar(300) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (business_id,widget_id,origin),
        FOREIGN KEY (business_id,widget_id) REFERENCES public.website_widgets(business_id,id) ON DELETE CASCADE
      );
      CREATE INDEX idx_website_widget_domains_origin ON public.website_widget_domains(widget_id,origin);

      CREATE TABLE public.website_visitors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        widget_id uuid NOT NULL,
        customer_id uuid NOT NULL,
        contact_consent_at timestamptz,
        contact_consent_notice varchar(500),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (business_id,id),
        UNIQUE (business_id,widget_id,customer_id),
        FOREIGN KEY (business_id,widget_id) REFERENCES public.website_widgets(business_id,id) ON DELETE CASCADE,
        FOREIGN KEY (business_id,customer_id) REFERENCES public.customers("businessId",id) ON DELETE CASCADE
      );
      CREATE TABLE public.website_visitor_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        widget_id uuid NOT NULL,
        visitor_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        credential_hash char(64) NOT NULL UNIQUE CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
        origin varchar(300) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        FOREIGN KEY (business_id,widget_id) REFERENCES public.website_widgets(business_id,id) ON DELETE CASCADE,
        FOREIGN KEY (business_id,visitor_id) REFERENCES public.website_visitors(business_id,id) ON DELETE CASCADE,
        FOREIGN KEY (business_id,conversation_id) REFERENCES public.conversations("businessId",id) ON DELETE CASCADE,
        CHECK (expires_at > created_at)
      );
      CREATE INDEX idx_website_sessions_expiry ON public.website_visitor_sessions(expires_at) WHERE revoked_at IS NULL;
      CREATE INDEX idx_website_sessions_conversation ON public.website_visitor_sessions(business_id,conversation_id);
      ALTER TABLE public.conversations ADD COLUMN website_widget_id uuid,
        ADD COLUMN website_visitor_id uuid,
        ADD CONSTRAINT fk_conversation_website_widget FOREIGN KEY ("businessId",website_widget_id)
          REFERENCES public.website_widgets(business_id,id),
        ADD CONSTRAINT fk_conversation_website_visitor FOREIGN KEY ("businessId",website_visitor_id)
          REFERENCES public.website_visitors(business_id,id),
        ADD CONSTRAINT chk_conversation_website_context CHECK (
          (channel='WHATSAPP' AND website_widget_id IS NULL AND website_visitor_id IS NULL)
          OR (channel='WEBSITE' AND website_widget_id IS NOT NULL AND website_visitor_id IS NOT NULL)
        );
      ALTER TABLE public.ai_response_runs ADD CONSTRAINT fk_ai_response_website_widget
        FOREIGN KEY (business_id,website_widget_id) REFERENCES public.website_widgets(business_id,id);
      ALTER TABLE public.ai_response_runs ADD COLUMN website_outbound_message_id uuid,
        ADD CONSTRAINT fk_ai_response_website_outbound FOREIGN KEY (website_outbound_message_id)
          REFERENCES public.messages(id) ON DELETE SET NULL;
      ALTER TABLE public.website_widgets ADD CONSTRAINT fk_website_widget_channel_connection
        FOREIGN KEY (channel_connection_id) REFERENCES public.channel_connections(id) ON DELETE RESTRICT;

      CREATE TABLE public.website_handoff_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL,
        conversation_id uuid NOT NULL, visitor_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (business_id,conversation_id) REFERENCES public.conversations("businessId",id) ON DELETE CASCADE,
        FOREIGN KEY (business_id,visitor_id) REFERENCES public.website_visitors(business_id,id) ON DELETE CASCADE,
        UNIQUE (business_id,conversation_id,visitor_id)
      );
      CREATE FUNCTION public.kleva_inbox_channel_info(target_id uuid)
      RETURNS TABLE(channel text,widget_id uuid,website_domain text,contact_email text,contact_phone text)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
        SELECT v.channel::text,v.website_widget_id,(SELECT d.origin::text FROM public.website_widget_domains d
          WHERE d.business_id=v."businessId" AND d.widget_id=v.website_widget_id ORDER BY d.origin LIMIT 1),c.email::text,c.phone::text
        FROM public.conversations v JOIN public.customers c ON c.id=v."customerId" AND c."businessId"=v."businessId"
        WHERE v.id=target_id AND v."businessId"=NULLIF(current_setting('kleva.business_id',true),'')::uuid
          AND public.kleva_current_role() IN ('owner','agent')
      $$;
      REVOKE ALL ON FUNCTION public.kleva_inbox_channel_info(uuid) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_merchant_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_inbox_channel_info(uuid) TO %I',role_name);
        END LOOP;
      END $$;
      CREATE FUNCTION public.kleva_inbox_list_channel_filtered(
        page_size integer,before_time timestamp without time zone,before_id uuid,
        status_filter text,search_text text,channel_filter text
      ) RETURNS TABLE (
        id uuid,customer_name text,customer_whatsapp_id text,last_activity timestamp without time zone,
        preview text,status text,control_mode text,control_version bigint,in_flight bigint,handoff_needed boolean,
        assigned_to_account_id uuid,unread_count bigint,channel text,website_domain text
      ) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        normalized_status text:=lower(COALESCE(status_filter,'all'));
        normalized_search text:=NULLIF(btrim(search_text),'');
        normalized_channel text:=upper(COALESCE(channel_filter,'all'));
      BEGIN
        IF public.kleva_current_role() NOT IN ('owner','agent') THEN RAISE EXCEPTION 'inbox access denied' USING ERRCODE='42501'; END IF;
        IF normalized_status NOT IN ('all','open','closed') OR normalized_channel NOT IN ('ALL','WHATSAPP','WEBSITE') THEN RAISE EXCEPTION 'invalid conversation filter' USING ERRCODE='22023'; END IF;
        IF normalized_search IS NOT NULL AND length(normalized_search)>100 THEN RAISE EXCEPTION 'search text too long' USING ERRCODE='22023'; END IF;
        RETURN QUERY SELECT v.id,c.name::text,c."whatsappId"::text,v."updatedAt",
          (SELECT m.content FROM public.messages m WHERE m."businessId"=v."businessId" AND m."conversationId"=v.id ORDER BY m."createdAt" DESC,m.id DESC LIMIT 1),
          v.status::text,v.control_mode::text,v.control_version,
          (SELECT count(*) FROM public.whatsapp_outbound_messages o WHERE o.business_id=v."businessId" AND o.conversation_id=v.id AND o.status='SENDING'),
          (EXISTS(SELECT 1 FROM public.ai_response_runs a WHERE a.business_id=v."businessId" AND a.conversation_id=v.id AND a.status='HANDOFF_REQUIRED')
            OR (v.control_mode='HUMAN' AND EXISTS(SELECT 1 FROM public.website_handoff_requests h WHERE h.business_id=v."businessId" AND h.conversation_id=v.id))),
          s.assigned_to_account_id,
          (SELECT count(*) FROM public.messages unread WHERE unread."businessId"=v."businessId" AND unread."conversationId"=v.id AND unread.direction='inbound'
            AND (reads.last_read_at IS NULL OR unread."createdAt">reads.last_read_at)),
          v.channel::text,domain.origin::text
        FROM public.conversations v JOIN public.customers c ON c.id=v."customerId" AND c."businessId"=v."businessId"
        LEFT JOIN public.conversation_inbox_state s ON s.business_id=v."businessId" AND s.conversation_id=v.id
        LEFT JOIN public.conversation_inbox_reads reads ON reads.business_id=v."businessId" AND reads.conversation_id=v.id AND reads.account_id=public.kleva_current_account()
        LEFT JOIN LATERAL (SELECT d.origin FROM public.website_widget_domains d WHERE d.business_id=v."businessId" AND d.widget_id=v.website_widget_id ORDER BY d.origin LIMIT 1) domain ON true
        WHERE v."businessId"=tenant_id AND (normalized_channel='ALL' OR v.channel=normalized_channel)
          AND (normalized_status='all' OR (normalized_status='open' AND COALESCE(lower(v.status),'open') NOT IN ('closed','resolved')) OR (normalized_status='closed' AND lower(v.status) IN ('closed','resolved')))
          AND (before_time IS NULL OR (v."updatedAt",v.id)<(before_time,before_id))
          AND (normalized_search IS NULL OR strpos(lower(COALESCE(c.name,'')),lower(normalized_search))>0
            OR strpos(lower(COALESCE(c."whatsappId",'')),lower(normalized_search))>0
            OR strpos(lower(COALESCE(domain.origin,'')),lower(normalized_search))>0
            OR EXISTS(SELECT 1 FROM public.messages sm WHERE sm."businessId"=v."businessId" AND sm."conversationId"=v.id AND strpos(lower(sm.content),lower(normalized_search))>0))
        ORDER BY v."updatedAt" DESC,v.id DESC LIMIT LEAST(GREATEST(page_size,1),101);
      END $$;
      REVOKE ALL ON FUNCTION public.kleva_inbox_list_channel_filtered(integer,timestamp without time zone,uuid,text,text,text) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_merchant_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_inbox_list_channel_filtered(integer,timestamp without time zone,uuid,text,text,text) TO %I',role_name);
        END LOOP;
      END $$;
      CREATE TABLE public.website_rate_limits (
        bucket_hash char(64) NOT NULL CHECK (bucket_hash ~ '^[0-9a-f]{64}$'),
        bucket_start timestamptz NOT NULL,
        requests integer NOT NULL CHECK (requests > 0),
        PRIMARY KEY(bucket_hash,bucket_start)
      );

      CREATE FUNCTION public.kleva_website_widget_list()
      RETURNS TABLE(id uuid,public_id text,name text,enabled boolean,ai_enabled boolean,
        configuration jsonb,domains text[],created_at timestamptz,updated_at timestamptz,connection_status text)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner') THEN
          RAISE EXCEPTION 'website widget access denied' USING ERRCODE='42501';
        END IF;
        RETURN QUERY SELECT w.id,w.public_id::text,w.name::text,w.enabled,w.ai_enabled,w.configuration,
          COALESCE(array_agg(d.origin ORDER BY d.origin) FILTER (WHERE d.id IS NOT NULL),'{}'),
          w.created_at,w.updated_at,c.status::text
        FROM public.website_widgets w LEFT JOIN public.website_widget_domains d
          ON d.business_id=w.business_id AND d.widget_id=w.id
        LEFT JOIN public.channel_connections c ON c.id=w.channel_connection_id AND c."businessId"=w.business_id
        WHERE w.business_id=tenant_id GROUP BY w.id,c.status ORDER BY w.created_at DESC,w.id;
      END $$;

      CREATE FUNCTION public.kleva_website_widget_create(new_public_id text,new_name text)
      RETURNS TABLE(id uuid,public_id text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; widget_uuid uuid:=gen_random_uuid(); channel_uuid uuid:=gen_random_uuid();
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner')
          OR new_public_id !~ '^[A-Za-z0-9_-]{32,48}$' OR length(btrim(new_name)) NOT BETWEEN 1 AND 80 THEN
          RAISE EXCEPTION 'website widget create denied' USING ERRCODE='42501';
        END IF;
        INSERT INTO public.website_widgets(id,business_id,public_id,name,channel_connection_id)
          VALUES(widget_uuid,tenant_id,new_public_id,btrim(new_name),channel_uuid);
        INSERT INTO public.channel_connections(id,"businessId",provider,"externalAssetId","displayName",status)
          VALUES(channel_uuid,tenant_id,'website',new_public_id,btrim(new_name),'pending');
        RETURN QUERY SELECT widget_uuid,new_public_id;
      END $$;

      CREATE FUNCTION public.kleva_website_widget_domains_set(target_id uuid,new_origins text[])
      RETURNS TABLE(origin_count integer)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; is_enabled boolean;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner')
          OR COALESCE(cardinality(new_origins),0)>10 OR EXISTS(SELECT 1 FROM unnest(COALESCE(new_origins,'{}')) x WHERE x IS NULL OR length(x)>300 OR x !~ '^https?://[^/]+$') THEN
          RAISE EXCEPTION 'website domain update denied' USING ERRCODE='42501';
        END IF;
        SELECT w.enabled INTO is_enabled FROM public.website_widgets w WHERE w.id=target_id AND w.business_id=tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        IF is_enabled AND cardinality(new_origins)=0 THEN RAISE EXCEPTION 'an enabled widget must retain an authorized domain' USING ERRCODE='22023'; END IF;
        DELETE FROM public.website_widget_domains d WHERE d.business_id=tenant_id AND d.widget_id=target_id;
        INSERT INTO public.website_widget_domains(business_id,widget_id,origin)
          SELECT tenant_id,target_id,origin FROM unnest(new_origins) origin ON CONFLICT DO NOTHING;
        UPDATE public.website_widgets SET updated_at=now() WHERE id=target_id AND business_id=tenant_id;
        RETURN QUERY SELECT cardinality(new_origins);
      END $$;

      CREATE FUNCTION public.kleva_website_widget_update(target_id uuid,new_name text,new_enabled boolean,new_ai_enabled boolean,new_configuration jsonb)
      RETURNS TABLE(id uuid,enabled boolean,ai_enabled boolean,updated_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; widget_row public.website_widgets%ROWTYPE;
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner')
          OR length(btrim(new_name)) NOT BETWEEN 1 AND 80 OR jsonb_typeof(new_configuration)<>'object' THEN
          RAISE EXCEPTION 'website widget update denied' USING ERRCODE='42501';
        END IF;
        SELECT * INTO widget_row FROM public.website_widgets w WHERE w.id=target_id AND w.business_id=tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        IF new_enabled AND NOT EXISTS(SELECT 1 FROM public.website_widget_domains d WHERE d.business_id=tenant_id AND d.widget_id=target_id) THEN
          RAISE EXCEPTION 'add an authorized domain before enabling the widget' USING ERRCODE='22023';
        END IF;
        IF new_ai_enabled AND (NOT new_enabled OR NOT EXISTS(SELECT 1 FROM public.businesses b WHERE b.id=tenant_id AND b.status='active')
          OR NOT EXISTS(SELECT 1 FROM public.assistant_configurations a WHERE a.business_id=tenant_id)
          OR NOT (EXISTS(SELECT 1 FROM public.knowledge_faqs f WHERE f.business_id=tenant_id AND f.published_revision_id IS NOT NULL)
            OR EXISTS(SELECT 1 FROM public.merchant_products p WHERE p.business_id=tenant_id AND p.published_revision_id IS NOT NULL))) THEN
          RAISE EXCEPTION 'website AI prerequisites are incomplete' USING ERRCODE='22023';
        END IF;
        UPDATE public.website_widgets SET name=btrim(new_name),enabled=new_enabled,ai_enabled=new_ai_enabled,
          configuration=new_configuration,updated_at=now() WHERE id=target_id AND business_id=tenant_id
          RETURNING website_widgets.enabled,website_widgets.ai_enabled,website_widgets.updated_at INTO new_enabled,new_ai_enabled,updated_at;
        UPDATE public.channel_connections c SET status=CASE WHEN new_enabled THEN 'active' ELSE 'inactive' END,
          "displayName"=btrim(new_name),"updatedAt"=now()
          WHERE c.id=widget_row.channel_connection_id AND c."businessId"=tenant_id;
        RETURN QUERY SELECT target_id,new_enabled,new_ai_enabled,updated_at;
      END $$;

      CREATE FUNCTION public.kleva_website_widget_rotate(target_id uuid,new_public_id text)
      RETURNS TABLE(public_id text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; widget_row public.website_widgets%ROWTYPE; new_channel uuid:=gen_random_uuid();
      BEGIN
        IF tenant_id IS NULL OR public.kleva_current_role() NOT IN ('owner') OR new_public_id !~ '^[A-Za-z0-9_-]{32,48}$' THEN
          RAISE EXCEPTION 'website widget rotation denied' USING ERRCODE='42501';
        END IF;
        SELECT * INTO widget_row FROM public.website_widgets w WHERE w.id=target_id AND w.business_id=tenant_id FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        UPDATE public.channel_connections SET status='inactive',"verifiedAt"=NULL,"updatedAt"=now()
          WHERE id=widget_row.channel_connection_id AND "businessId"=tenant_id;
        INSERT INTO public.channel_connections(id,"businessId",provider,"externalAssetId","displayName",status)
          VALUES(new_channel,tenant_id,'website',new_public_id,widget_row.name,CASE WHEN widget_row.enabled THEN 'active' ELSE 'pending' END);
        UPDATE public.website_widgets SET public_id=new_public_id,channel_connection_id=new_channel,updated_at=now()
          WHERE id=target_id AND business_id=tenant_id;
        RETURN QUERY SELECT new_public_id;
      END $$;

      REVOKE ALL ON FUNCTION public.kleva_website_widget_list(),public.kleva_website_widget_create(text,text),
        public.kleva_website_widget_domains_set(uuid,text[]),public.kleva_website_widget_update(uuid,text,boolean,boolean,jsonb),
        public.kleva_website_widget_rotate(uuid,text) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_merchant_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_website_widget_list(),public.kleva_website_widget_create(text,text),public.kleva_website_widget_domains_set(uuid,text[]),public.kleva_website_widget_update(uuid,text,boolean,boolean,jsonb),public.kleva_website_widget_rotate(uuid,text) TO %I',role_name);
        END LOOP;
      END $$;

      DO $$ DECLARE t text; role_name text; BEGIN
        FOREACH t IN ARRAY ARRAY['website_widgets','website_widget_domains','website_visitors','website_visitor_sessions','website_handoff_requests','website_rate_limits'] LOOP
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
          EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
          EXECUTE format('CREATE POLICY kleva_website_internal ON public.%I USING (current_user::text !~ ''^kleva_(merchant|identity)_'') WITH CHECK (current_user::text !~ ''^kleva_(merchant|identity)_'')',t);
        END LOOP;
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.website_widgets,public.website_widget_domains,public.website_visitors,public.website_visitor_sessions,public.website_handoff_requests,public.website_rate_limits TO %I',role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    const [row] = (await runner.query(`SELECT
      (SELECT count(*) FROM public.website_visitors)::int AS visitors,
      (SELECT count(*) FROM public.website_widgets)::int AS widgets,
      (SELECT count(*) FROM public.knowledge_gap_occurrences WHERE channel='WEBSITE')::int AS gaps`)) as Array<{
      visitors: number;
      widgets: number;
      gaps: number;
    }>;
    if (
      Number(row?.visitors ?? 0) > 0 ||
      Number(row?.widgets ?? 0) > 0 ||
      Number(row?.gaps ?? 0) > 0
    ) {
      throw new Error(
        'Website widget or visitor history exists; preserve the schema for rollback.',
      );
    }
    await runner.query(`
      DROP FUNCTION public.kleva_inbox_list_channel_filtered(integer,timestamp without time zone,uuid,text,text,text);
      DROP FUNCTION public.kleva_inbox_channel_info(uuid);
      DROP FUNCTION public.kleva_website_widget_rotate(uuid,text);
      DROP FUNCTION public.kleva_website_widget_update(uuid,text,boolean,boolean,jsonb);
      DROP FUNCTION public.kleva_website_widget_domains_set(uuid,text[]);
      DROP FUNCTION public.kleva_website_widget_create(text,text);
      DROP FUNCTION public.kleva_website_widget_list();
      DROP TABLE public.website_handoff_requests;
      ALTER TABLE public.ai_response_runs DROP CONSTRAINT fk_ai_response_website_widget;
      ALTER TABLE public.website_widgets DROP CONSTRAINT fk_website_widget_channel_connection;
      ALTER TABLE public.conversations DROP CONSTRAINT chk_conversation_website_context,
        DROP CONSTRAINT fk_conversation_website_visitor,DROP CONSTRAINT fk_conversation_website_widget,
        DROP COLUMN website_visitor_id,DROP COLUMN website_widget_id,DROP COLUMN channel;
      DROP TABLE public.website_visitor_sessions,public.website_visitors,public.website_widget_domains,public.website_widgets,public.website_rate_limits;
      DROP INDEX public.uq_messages_channel_external_id;
      ALTER TABLE public.ai_response_runs DROP COLUMN website_widget_id,DROP COLUMN channel;
      DROP INDEX public.uq_messages_channel_idempotency;
      ALTER TABLE public.messages DROP COLUMN idempotency_key,DROP COLUMN external_message_id,DROP COLUMN channel;
      ALTER TABLE public.ai_response_runs DROP CONSTRAINT fk_ai_response_website_outbound,DROP COLUMN website_outbound_message_id;
      ALTER TABLE public.knowledge_gap_occurrences DROP CONSTRAINT knowledge_gap_occurrences_channel_check;
      ALTER TABLE public.knowledge_gap_occurrences ADD CONSTRAINT knowledge_gap_occurrences_channel_check CHECK (channel='WHATSAPP');
      ALTER TABLE public.merchant_leads DROP CONSTRAINT merchant_leads_source_check;
      ALTER TABLE public.merchant_leads ADD CONSTRAINT merchant_leads_source_check CHECK (source='WHATSAPP');
      DROP INDEX public."IDX_customers_businessId_phone";
      CREATE UNIQUE INDEX "IDX_customers_businessId_phone" ON public.customers("businessId",phone);
    `);
  }
}
