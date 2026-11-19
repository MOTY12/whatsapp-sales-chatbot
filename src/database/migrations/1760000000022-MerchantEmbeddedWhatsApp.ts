import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MerchantEmbeddedWhatsApp1760000000022 implements MigrationInterface {
  name = 'MerchantEmbeddedWhatsApp1760000000022';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE public.channel_connections
        ADD COLUMN "displayPhoneNumber" varchar;
      UPDATE public.channel_connections connection
      SET "displayPhoneNumber" = business."displayPhoneNumber"
      FROM public.businesses business
      WHERE connection.provider = 'whatsapp'
        AND connection."businessId" = business.id
        AND connection."legacyBackfill" = true;

      CREATE TABLE public.whatsapp_signup_attempts (
        id uuid PRIMARY KEY,
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
        account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
        status varchar(20) NOT NULL CHECK (status IN
          ('CONNECTING','PROCESSING','ACTION_REQUIRED','FAILED','CANCELLED','COMPLETED')),
        failure_class varchar(48) CHECK (failure_class IS NULL OR failure_class IN
          ('SIGNUP_EXPIRED','META_CODE_EXCHANGE_FAILED','WEBHOOK_SUBSCRIPTION_FAILED',
           'PHONE_REGISTRATION_FAILED','ASSET_VERIFICATION_FAILED','CONNECTION_PERSIST_FAILED',
           'META_REPORTED_ERROR')),
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL))
      );
      CREATE INDEX "IDX_whatsapp_signup_attempt_business"
        ON public.whatsapp_signup_attempts (business_id, created_at DESC);
      CREATE UNIQUE INDEX "UQ_whatsapp_signup_attempt_open"
        ON public.whatsapp_signup_attempts (business_id)
        WHERE status IN ('CONNECTING','PROCESSING');
      ALTER TABLE public.whatsapp_signup_attempts ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.whatsapp_signup_attempts FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_whatsapp_signup_internal
        ON public.whatsapp_signup_attempts
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE FUNCTION public.kleva_whatsapp_status_v2()
      RETURNS TABLE (id uuid, "wabaId" varchar, "phoneNumberId" varchar,
        "displayName" varchar, "displayPhoneNumber" varchar, status text, revision integer)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT c.id, c."externalAccountId", c."externalAssetId", c."displayName",
          c."displayPhoneNumber",
          CASE WHEN w.expires_at <= now() OR w.envelope IS NULL THEN 'inactive' ELSE c.status END,
          w.revision
        FROM public.whatsapp_credentials w
        JOIN public.channel_connections c ON c.id = w.connection_id
        WHERE w.business_id = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND public.kleva_current_role() IN ('owner', 'editor', 'agent')
      $$;

      CREATE FUNCTION public.kleva_whatsapp_signup_start(attempt_id uuid, deadline timestamptz)
      RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE
        tenant uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        actor uuid := public.kleva_current_account();
        existing public.whatsapp_signup_attempts%ROWTYPE;
      BEGIN
        IF actor IS NULL OR public.kleva_current_role() <> 'owner'
          OR deadline <= now() OR deadline > now() + interval '20 minutes' THEN
          RETURN NULL;
        END IF;
        UPDATE public.whatsapp_signup_attempts SET status = 'ACTION_REQUIRED',
          failure_class = 'SIGNUP_EXPIRED', updated_at = now()
        WHERE business_id = tenant AND status IN ('CONNECTING','PROCESSING')
          AND expires_at <= now();
        SELECT * INTO existing FROM public.whatsapp_signup_attempts
        WHERE business_id = tenant AND status IN ('CONNECTING','PROCESSING')
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
        IF FOUND THEN
          IF existing.account_id = actor AND existing.status = 'CONNECTING' THEN
            RETURN existing.id;
          END IF;
          RETURN NULL;
        END IF;
        INSERT INTO public.whatsapp_signup_attempts
          (id,business_id,account_id,status,expires_at)
        SELECT attempt_id, tenant, actor, 'CONNECTING', deadline
        WHERE EXISTS (SELECT 1 FROM public.businesses WHERE id = tenant AND status = 'active');
        IF NOT FOUND THEN RETURN NULL; END IF;
        RETURN attempt_id;
      END $$;

      CREATE FUNCTION public.kleva_whatsapp_signup_claim(attempt_id uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        IF public.kleva_current_role() <> 'owner' THEN RETURN false; END IF;
        UPDATE public.whatsapp_signup_attempts SET status = 'PROCESSING', updated_at = now()
        WHERE id = attempt_id
          AND business_id = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND account_id = public.kleva_current_account()
          AND status = 'CONNECTING' AND expires_at > now();
        RETURN FOUND;
      END $$;

      CREATE FUNCTION public.kleva_whatsapp_signup_update(
        attempt_id uuid, next_status text, next_failure text
      ) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        IF public.kleva_current_role() <> 'owner'
          OR next_status NOT IN ('ACTION_REQUIRED','FAILED','CANCELLED')
          OR (next_failure IS NOT NULL AND next_failure NOT IN
            ('SIGNUP_EXPIRED','META_CODE_EXCHANGE_FAILED','WEBHOOK_SUBSCRIPTION_FAILED',
             'PHONE_REGISTRATION_FAILED','ASSET_VERIFICATION_FAILED','CONNECTION_PERSIST_FAILED',
             'META_REPORTED_ERROR')) THEN
          RETURN false;
        END IF;
        UPDATE public.whatsapp_signup_attempts SET status = next_status,
          failure_class = next_failure, updated_at = now()
        WHERE id = attempt_id
          AND business_id = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND account_id = public.kleva_current_account()
          AND status IN ('CONNECTING','PROCESSING');
        RETURN FOUND;
      END $$;

      CREATE FUNCTION public.kleva_whatsapp_signup_finish(attempt_id uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        IF public.kleva_current_role() <> 'owner' THEN RETURN false; END IF;
        UPDATE public.whatsapp_signup_attempts SET status = 'COMPLETED',
          failure_class = NULL, completed_at = now(), updated_at = now()
        WHERE id = attempt_id
          AND business_id = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND account_id = public.kleva_current_account() AND status = 'PROCESSING';
        RETURN FOUND;
      END $$;

      CREATE FUNCTION public.kleva_whatsapp_signup_status()
      RETURNS TABLE (status text, failure_class text, expires_at timestamptz, updated_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT CASE WHEN a.status IN ('CONNECTING','PROCESSING') AND a.expires_at <= now()
            THEN 'ACTION_REQUIRED' ELSE a.status END,
          CASE WHEN a.status IN ('CONNECTING','PROCESSING') AND a.expires_at <= now()
            THEN 'SIGNUP_EXPIRED' ELSE a.failure_class END,
          a.expires_at, a.updated_at
        FROM public.whatsapp_signup_attempts a
        WHERE a.business_id = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND a.account_id = public.kleva_current_account()
          AND public.kleva_current_role() = 'owner'
        ORDER BY a.created_at DESC LIMIT 1
      $$;

      CREATE FUNCTION public.kleva_write_whatsapp_v2(
        operation text, expected_revision integer, connection uuid, asset text,
        account text, label text, display_phone text, encrypted jsonb, expiry timestamptz
      ) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE
        tenant uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        actor uuid := public.kleva_current_account();
        previous public.whatsapp_credentials%ROWTYPE;
        mapped public.channel_connections%ROWTYPE;
      BEGIN
        IF operation NOT IN ('connect','rotate') OR encrypted IS NULL
          OR display_phone IS NULL OR btrim(display_phone) = ''
          OR (expiry IS NOT NULL AND expiry <= now()) THEN RETURN false; END IF;
        PERFORM 1 FROM public.business_members m
        WHERE m."businessId" = tenant AND m."accountId" = actor
          AND m.role = 'owner' AND m.status = 'active' FOR SHARE;
        IF NOT FOUND THEN RETURN false; END IF;
        PERFORM 1 FROM public.businesses WHERE id = tenant AND status = 'active' FOR UPDATE;
        IF NOT FOUND THEN RETURN false; END IF;
        SELECT * INTO previous FROM public.whatsapp_credentials WHERE business_id = tenant FOR UPDATE;
        IF previous.revision IS DISTINCT FROM expected_revision THEN RETURN false; END IF;
        IF previous.connection_id IS NOT NULL AND previous.connection_id <> connection THEN RETURN false; END IF;
        IF operation = 'rotate' AND previous.connection_id IS NULL THEN RETURN false; END IF;
        SELECT * INTO mapped FROM public.channel_connections
          WHERE provider = 'whatsapp' AND "externalAssetId" = asset FOR UPDATE;
        IF FOUND THEN
          IF mapped.id <> connection OR mapped."businessId" <> tenant
             OR mapped."externalAccountId" IS DISTINCT FROM account THEN RETURN false; END IF;
          UPDATE public.channel_connections SET status = 'active', "verifiedAt" = now(),
            "legacyBackfill" = false, "displayName" = label,
            "displayPhoneNumber" = display_phone, "updatedAt" = now()
          WHERE id = connection;
        ELSE
          INSERT INTO public.channel_connections
            (id,"businessId",provider,"externalAssetId","externalAccountId", "displayName",
             "displayPhoneNumber",status,"verifiedAt")
          VALUES (connection,tenant,'whatsapp',asset,account,label,display_phone,'active',now());
        END IF;
        INSERT INTO public.whatsapp_credentials (business_id,connection_id,envelope,expires_at)
        VALUES (tenant,connection,encrypted,expiry)
        ON CONFLICT (business_id) DO UPDATE SET envelope = EXCLUDED.envelope,
          expires_at = EXCLUDED.expires_at,
          revision = public.whatsapp_credentials.revision + 1;
        INSERT INTO public.audit_logs ("businessId","entityType","entityId",action,"newValue")
        VALUES (tenant,'whatsapp_connection',connection,'UPDATE',
          jsonb_build_object('operation',operation,'accountId',actor));
        RETURN true;
      END $$;
      REVOKE ALL ON FUNCTION public.kleva_whatsapp_status_v2() FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_whatsapp_signup_start(uuid,timestamptz),
        public.kleva_whatsapp_signup_claim(uuid),
        public.kleva_whatsapp_signup_update(uuid,text,text),
        public.kleva_whatsapp_signup_finish(uuid),
        public.kleva_whatsapp_signup_status(),
        public.kleva_write_whatsapp_v2(text,integer,uuid,text,text,text,text,jsonb,timestamptz)
        FROM PUBLIC;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    const [counts] = (await runner.query(`
      SELECT (SELECT count(*) FROM public.whatsapp_signup_attempts) AS attempts,
        (SELECT count(*) FROM public.whatsapp_credentials) AS credentials
    `)) as { attempts: string; credentials: string }[];
    if (Number(counts.attempts) || Number(counts.credentials)) {
      throw new Error(
        'WhatsApp signup or connection history exists; preserving it for rollback.',
      );
    }
    await runner.query(`
      DROP FUNCTION public.kleva_write_whatsapp_v2(text,integer,uuid,text,text,text,text,jsonb,timestamptz);
      DROP FUNCTION public.kleva_whatsapp_signup_status();
      DROP FUNCTION public.kleva_whatsapp_signup_finish(uuid);
      DROP FUNCTION public.kleva_whatsapp_signup_update(uuid,text,text);
      DROP FUNCTION public.kleva_whatsapp_signup_claim(uuid);
      DROP FUNCTION public.kleva_whatsapp_signup_start(uuid,timestamptz);
      DROP FUNCTION public.kleva_whatsapp_status_v2();
      DROP TABLE public.whatsapp_signup_attempts;
      ALTER TABLE public.channel_connections DROP COLUMN "displayPhoneNumber";
    `);
  }
}
