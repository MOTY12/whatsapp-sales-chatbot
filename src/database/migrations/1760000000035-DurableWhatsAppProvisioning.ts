import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Durable, recoverable continuation for Embedded Signup. */
export class DurableWhatsAppProvisioning1760000000035 implements MigrationInterface {
  name = 'DurableWhatsAppProvisioning1760000000035';

  async up(runner: QueryRunner): Promise<void> {
    try {
      await runner.query(`
      ALTER TABLE public.whatsapp_signup_attempts
        ADD COLUMN session_digest text,
        ADD COLUMN attempt_version integer NOT NULL DEFAULT 1 CHECK (attempt_version > 0),
        ADD COLUMN selected_waba_id text,
        ADD COLUMN selected_phone_number_id text,
        ADD COLUMN processing_stage text NOT NULL DEFAULT 'AUTHORIZATION_PENDING',
        ADD COLUMN operation_id uuid UNIQUE,
        ADD COLUMN connection_id uuid,
        ADD COLUMN expected_revision integer,
        ADD COLUMN reconnect boolean NOT NULL DEFAULT false;
      ALTER TABLE public.whatsapp_signup_attempts
        ADD CONSTRAINT UQ_whatsapp_signup_attempt_tenant UNIQUE(id,business_id),
        ADD CONSTRAINT CHK_whatsapp_signup_session_digest
          CHECK (session_digest IS NULL OR session_digest ~ '^[0-9a-f]{64}$'),
        ADD CONSTRAINT CHK_whatsapp_signup_stage CHECK (processing_stage IN (
          'AUTHORIZATION_PENDING','EXCHANGING_CODE','CREDENTIAL_STAGED','VERIFYING_ASSETS',
          'SUBSCRIBING_WEBHOOKS','REGISTERING_PHONE','VERIFYING_READINESS',
          'ACTIVE','ACTION_REQUIRED','FAILED'
        ));

      ALTER TABLE public.outbox_operations ADD CONSTRAINT UQ_outbox_operation_tenant UNIQUE(id,"businessId");
      CREATE TABLE public.whatsapp_pending_credentials (
        attempt_id uuid PRIMARY KEY,
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
        connection_id uuid NOT NULL,
        operation_id uuid NOT NULL UNIQUE REFERENCES public.outbox_operations(id) ON DELETE RESTRICT,
        waba_id text NOT NULL CHECK (waba_id ~ '^[0-9]{1,32}$'),
        phone_number_id text NOT NULL CHECK (phone_number_id ~ '^[0-9]{1,32}$'),
        credential_envelope jsonb NOT NULL,
        registration_pin_envelope jsonb,
        expires_at timestamptz,
        expected_revision integer,
        reconnect boolean NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT FK_whatsapp_pending_attempt_tenant FOREIGN KEY(attempt_id,business_id)
          REFERENCES public.whatsapp_signup_attempts(id,business_id) ON DELETE RESTRICT,
        CONSTRAINT FK_whatsapp_pending_operation_tenant FOREIGN KEY(operation_id,business_id)
          REFERENCES public.outbox_operations(id,"businessId") ON DELETE RESTRICT
      );
      ALTER TABLE public.whatsapp_pending_credentials ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.whatsapp_pending_credentials FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_whatsapp_pending_credentials_owner
        ON public.whatsapp_pending_credentials
        USING (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.whatsapp_pending_credentials'::regclass)))
        WITH CHECK (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.whatsapp_pending_credentials'::regclass)));

      CREATE FUNCTION public.kleva_whatsapp_signup_start_v2(attempt_id uuid, deadline timestamptz)
      RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE tenant uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        actor uuid := public.kleva_current_account(); existing public.whatsapp_signup_attempts%ROWTYPE;
        session_hash text := NULLIF(current_setting('kleva.session_digest', true), '');
      BEGIN
        IF actor IS NULL OR session_hash IS NULL OR public.kleva_current_role() <> 'owner'
          OR deadline <= now() OR deadline > now() + interval '20 minutes' THEN RETURN NULL; END IF;
        -- Serialize starts even when the business has no active attempt row yet.
        PERFORM 1 FROM public.businesses WHERE id=tenant AND status='active' FOR UPDATE;
        IF NOT FOUND THEN RETURN NULL; END IF;
        UPDATE public.whatsapp_signup_attempts SET status='ACTION_REQUIRED',failure_class='SIGNUP_EXPIRED',
          processing_stage='ACTION_REQUIRED',updated_at=now(),attempt_version=attempt_version+1
        WHERE business_id=tenant AND status IN ('CONNECTING','PROCESSING') AND expires_at<=now();
        SELECT * INTO existing FROM public.whatsapp_signup_attempts
          WHERE business_id=tenant AND status IN ('CONNECTING','PROCESSING')
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
        IF FOUND THEN
          IF existing.account_id=actor AND existing.session_digest=session_hash AND existing.status='CONNECTING'
            THEN RETURN existing.id; END IF;
          RETURN NULL;
        END IF;
        INSERT INTO public.whatsapp_signup_attempts
          (id,business_id,account_id,status,expires_at,session_digest,processing_stage)
        SELECT attempt_id,tenant,actor,'CONNECTING',deadline,session_hash,'AUTHORIZATION_PENDING'
          WHERE EXISTS(SELECT 1 FROM public.businesses WHERE id=tenant AND status='active');
        IF NOT FOUND THEN RETURN NULL; END IF; RETURN attempt_id;
      END $$;

      CREATE FUNCTION public.kleva_whatsapp_signup_claim_v2(attempt_id uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        IF public.kleva_current_role()<>'owner' THEN RETURN false; END IF;
        UPDATE public.whatsapp_signup_attempts SET status='PROCESSING',processing_stage='EXCHANGING_CODE',
          updated_at=now(),attempt_version=attempt_version+1
        WHERE id=attempt_id AND business_id=NULLIF(current_setting('kleva.business_id',true),'')::uuid
          AND account_id=public.kleva_current_account()
          AND session_digest=NULLIF(current_setting('kleva.session_digest',true),'')
          AND status='CONNECTING' AND expires_at>now();
        RETURN FOUND;
      END $$;

      CREATE FUNCTION public.kleva_whatsapp_stage_provisioning(
        p_attempt_id uuid, p_operation_id uuid, p_connection uuid, p_selected_waba text, p_selected_phone text,
        p_encrypted_credential jsonb, p_encrypted_pin jsonb, p_token_expiry timestamptz,
        p_expected integer, p_is_reconnect boolean
      ) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        actor uuid:=public.kleva_current_account(); attempt public.whatsapp_signup_attempts%ROWTYPE;
      BEGIN
        IF actor IS NULL OR public.kleva_current_role()<>'owner' OR p_encrypted_credential IS NULL
          OR p_selected_waba !~ '^[0-9]{1,32}$' OR p_selected_phone !~ '^[0-9]{1,32}$'
          OR (p_token_expiry IS NOT NULL AND p_token_expiry<=now()) THEN RETURN false; END IF;
        SELECT * INTO attempt FROM public.whatsapp_signup_attempts WHERE id=p_attempt_id
          AND business_id=tenant AND account_id=actor
          AND session_digest=NULLIF(current_setting('kleva.session_digest',true),'')
          AND status='PROCESSING' AND expires_at>now() FOR UPDATE;
        IF NOT FOUND OR attempt.operation_id IS NOT NULL THEN RETURN false; END IF;
        IF NOT EXISTS(SELECT 1 FROM public.business_members WHERE "businessId"=tenant
          AND "accountId"=actor AND role='owner' AND status='active') THEN RETURN false; END IF;
        INSERT INTO public.outbox_operations(id,"businessId",operation,metadata)
          VALUES(p_operation_id,tenant,'whatsapp.connection.provision',jsonb_build_object('attemptId',p_attempt_id));
        INSERT INTO public.whatsapp_pending_credentials(attempt_id,business_id,connection_id,operation_id,
          waba_id,phone_number_id,credential_envelope,registration_pin_envelope,expires_at,
          expected_revision,reconnect)
        VALUES(p_attempt_id,tenant,p_connection,p_operation_id,p_selected_waba,p_selected_phone,p_encrypted_credential,
          p_encrypted_pin,p_token_expiry,p_expected,p_is_reconnect);
        UPDATE public.whatsapp_signup_attempts SET selected_waba_id=p_selected_waba,
          selected_phone_number_id=p_selected_phone,connection_id=p_connection,expected_revision=p_expected,
          reconnect=p_is_reconnect,operation_id=p_operation_id,processing_stage='CREDENTIAL_STAGED',updated_at=now(),
          attempt_version=attempt_version+1,
          expires_at=COALESCE(p_token_expiry, now() + interval '24 hours') WHERE id=p_attempt_id;
        RETURN true;
      EXCEPTION WHEN unique_violation THEN RETURN false;
      END $$;

      CREATE FUNCTION public.kleva_whatsapp_provision_read(attempt uuid, operation uuid, lease uuid)
      RETURNS TABLE(business_id uuid,connection_id uuid,waba_id text,phone_number_id text,
        credential_envelope jsonb,registration_pin_envelope jsonb,expires_at timestamptz,
        expected_revision integer,reconnect boolean,processing_stage text)
      LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
        SELECT p.business_id,p.connection_id,p.waba_id,p.phone_number_id,p.credential_envelope,
          p.registration_pin_envelope,p.expires_at,p.expected_revision,p.reconnect,a.processing_stage
        FROM public.whatsapp_pending_credentials p
        JOIN public.whatsapp_signup_attempts a ON a.id=p.attempt_id AND a.business_id=p.business_id
        JOIN public.outbox_operations o ON o.id=p.operation_id AND o."businessId"=p.business_id
        WHERE p.attempt_id=$1 AND p.operation_id=$2 AND o.status='PROCESSING'
          AND o."leaseToken"=$3 AND o."dueAt">now() AND a.status='PROCESSING'
          AND a.expires_at>now()
          AND a.account_id=public.kleva_session_account(a.session_digest)
          AND EXISTS(SELECT 1 FROM public.businesses b WHERE b.id=p.business_id AND b.status='active')
          AND EXISTS(SELECT 1 FROM public.business_members m WHERE m."businessId"=p.business_id
            AND m."accountId"=a.account_id AND m.role='owner' AND m.status='active')
      $$;

      CREATE FUNCTION public.kleva_whatsapp_provision_checkpoint(
        attempt uuid,operation uuid,lease uuid,next_stage text
      ) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE changed integer;
      BEGIN
        IF next_stage NOT IN ('VERIFYING_ASSETS','SUBSCRIBING_WEBHOOKS','REGISTERING_PHONE','VERIFYING_READINESS')
          OR NOT EXISTS(SELECT 1 FROM public.outbox_operations WHERE id=operation AND status='PROCESSING'
            AND "leaseToken"=lease AND "dueAt">now()) THEN RETURN false; END IF;
        UPDATE public.whatsapp_signup_attempts SET processing_stage=next_stage,updated_at=now()
          WHERE id=attempt AND operation_id=operation AND status='PROCESSING' AND expires_at>now();
        GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed=1;
      END $$;

      CREATE FUNCTION public.kleva_whatsapp_provision_finish(attempt uuid,operation uuid,lease uuid,
        verified_name text,verified_phone text,token_expiry timestamptz)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE p public.whatsapp_pending_credentials%ROWTYPE; a public.whatsapp_signup_attempts%ROWTYPE;
        old public.whatsapp_credentials%ROWTYPE; mapped public.channel_connections%ROWTYPE;
      BEGIN
        SELECT * INTO p FROM public.whatsapp_pending_credentials WHERE attempt_id=attempt AND operation_id=operation FOR UPDATE;
        IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.outbox_operations WHERE id=operation AND "businessId"=p.business_id
          AND status='PROCESSING' AND "leaseToken"=lease AND "dueAt">now()) THEN RETURN false; END IF;
        SELECT * INTO a FROM public.whatsapp_signup_attempts WHERE id=attempt AND operation_id=operation
          AND status='PROCESSING' AND expires_at>now() FOR UPDATE;
        IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.businesses WHERE id=p.business_id AND status='active')
          OR NOT EXISTS(SELECT 1 FROM public.business_members WHERE "businessId"=p.business_id
            AND "accountId"=a.account_id AND role='owner' AND status='active')
          OR public.kleva_session_account(a.session_digest) IS DISTINCT FROM a.account_id THEN RETURN false; END IF;
        IF token_expiry IS NOT NULL AND token_expiry<=now() THEN RETURN false; END IF;
        PERFORM 1 FROM public.businesses WHERE id=p.business_id FOR UPDATE;
        SELECT * INTO old FROM public.whatsapp_credentials WHERE business_id=p.business_id FOR UPDATE;
        IF old.revision IS DISTINCT FROM p.expected_revision THEN RETURN false; END IF;
        IF old.connection_id IS NOT NULL AND (old.connection_id<>p.connection_id OR NOT p.reconnect) THEN RETURN false; END IF;
        SELECT * INTO mapped FROM public.channel_connections WHERE provider='whatsapp'
          AND "externalAssetId"=p.phone_number_id FOR UPDATE;
        IF FOUND AND (mapped.id<>p.connection_id OR mapped."businessId"<>p.business_id
          OR mapped."externalAccountId"<>p.waba_id) THEN RETURN false; END IF;
        IF mapped.id IS NULL THEN
          INSERT INTO public.channel_connections(id,"businessId",provider,"externalAccountId","externalAssetId",
            "displayName","displayPhoneNumber",status,"verifiedAt")
          VALUES(p.connection_id,p.business_id,'whatsapp',p.waba_id,p.phone_number_id,
            NULLIF(left(verified_name,255),''),NULLIF(left(verified_phone,64),''),'active',now());
        ELSE
          UPDATE public.channel_connections SET status='active',"displayName"=NULLIF(left(verified_name,255),''),
            "displayPhoneNumber"=NULLIF(left(verified_phone,64),''),"verifiedAt"=now(),"legacyBackfill"=false,"updatedAt"=now()
            WHERE id=p.connection_id;
        END IF;
        INSERT INTO public.whatsapp_credentials(business_id,connection_id,envelope,expires_at)
          VALUES(p.business_id,p.connection_id,p.credential_envelope,token_expiry)
          ON CONFLICT(business_id) DO UPDATE SET connection_id=excluded.connection_id,
            envelope=excluded.envelope,expires_at=excluded.expires_at,
            revision=public.whatsapp_credentials.revision+1;
        INSERT INTO public.audit_logs("businessId","entityType","entityId",action,"newValue")
          VALUES(p.business_id,'whatsapp_connection',p.connection_id,'UPDATE',
            jsonb_build_object('operation',CASE WHEN p.reconnect THEN 'rotate' ELSE 'connect' END,
              'accountId',a.account_id,'source','embedded_signup'));
        UPDATE public.whatsapp_signup_attempts SET status='COMPLETED',failure_class=NULL,
          processing_stage='ACTIVE',completed_at=now(),updated_at=now(),attempt_version=attempt_version+1
          WHERE id=attempt;
        DELETE FROM public.whatsapp_pending_credentials WHERE attempt_id=attempt;
        RETURN true;
      EXCEPTION WHEN unique_violation THEN RETURN false;
      END $$;

      CREATE FUNCTION public.kleva_whatsapp_provision_fail(attempt uuid,operation uuid,lease uuid,failure text)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      BEGIN
        IF failure NOT IN ('META_CODE_EXCHANGE_FAILED','WEBHOOK_SUBSCRIPTION_FAILED','PHONE_REGISTRATION_FAILED',
          'ASSET_VERIFICATION_FAILED','CONNECTION_PERSIST_FAILED','META_REPORTED_ERROR') THEN RETURN false; END IF;
        IF NOT EXISTS(SELECT 1 FROM public.outbox_operations WHERE id=operation AND status='PROCESSING'
          AND "leaseToken"=lease AND "dueAt">now()) THEN RETURN false; END IF;
        UPDATE public.whatsapp_signup_attempts SET status='FAILED',failure_class=failure,
          processing_stage='FAILED',updated_at=now(),attempt_version=attempt_version+1
          WHERE id=attempt AND operation_id=operation AND status='PROCESSING';
        DELETE FROM public.whatsapp_pending_credentials WHERE attempt_id=attempt;
        RETURN FOUND;
      END $$;

      CREATE FUNCTION public.kleva_whatsapp_signup_status_v2()
      RETURNS TABLE(status text,failure_class text,expires_at timestamptz,updated_at timestamptz,processing_stage text,attempt_version integer)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
        SELECT CASE WHEN a.status IN ('CONNECTING','PROCESSING') AND a.expires_at<=now() THEN 'ACTION_REQUIRED' ELSE a.status END,
          CASE WHEN a.status IN ('CONNECTING','PROCESSING') AND a.expires_at<=now() THEN 'SIGNUP_EXPIRED' ELSE a.failure_class END,
          a.expires_at,a.updated_at,a.processing_stage,a.attempt_version
        FROM public.whatsapp_signup_attempts a WHERE a.business_id=NULLIF(current_setting('kleva.business_id',true),'')::uuid
          AND a.account_id=public.kleva_current_account() AND public.kleva_current_role()='owner'
        ORDER BY a.created_at DESC LIMIT 1
      $$;
      REVOKE ALL ON FUNCTION public.kleva_whatsapp_signup_start_v2(uuid,timestamptz),
        public.kleva_whatsapp_signup_claim_v2(uuid), public.kleva_whatsapp_signup_status_v2() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.kleva_whatsapp_signup_start_v2(uuid,timestamptz),
        public.kleva_whatsapp_signup_claim_v2(uuid), public.kleva_whatsapp_signup_status_v2() TO CURRENT_USER;
      REVOKE ALL ON FUNCTION public.kleva_whatsapp_stage_provisioning(uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz,integer,boolean),
        public.kleva_whatsapp_provision_read(uuid,uuid,uuid),
        public.kleva_whatsapp_provision_checkpoint(uuid,uuid,uuid,text),
        public.kleva_whatsapp_provision_finish(uuid,uuid,uuid,text,text,timestamptz),
        public.kleva_whatsapp_provision_fail(uuid,uuid,uuid,text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.kleva_whatsapp_stage_provisioning(uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz,integer,boolean),
        public.kleva_whatsapp_provision_read(uuid,uuid,uuid),
        public.kleva_whatsapp_provision_checkpoint(uuid,uuid,uuid,text),
        public.kleva_whatsapp_provision_finish(uuid,uuid,uuid,text,text,timestamptz),
        public.kleva_whatsapp_provision_fail(uuid,uuid,uuid,text) TO CURRENT_USER;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_whatsapp_provision_read(uuid,uuid,uuid), public.kleva_whatsapp_provision_checkpoint(uuid,uuid,uuid,text), public.kleva_whatsapp_provision_finish(uuid,uuid,uuid,text,text,timestamptz), public.kleva_whatsapp_provision_fail(uuid,uuid,uuid,text) TO %I', role_name);
        END LOOP;
      END $$;
      `);
    } catch (error) {
      const driverError = (error as { driverError?: Record<string, unknown> })
        .driverError;
      console.error({
        migration: this.name,
        code: driverError?.code,
        position: driverError?.position,
        where: driverError?.where,
      });
      throw error;
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    const [state] = (await runner.query(`
      SELECT (SELECT count(*) FROM public.whatsapp_pending_credentials) AS pending,
        (SELECT count(*) FROM public.whatsapp_signup_attempts WHERE operation_id IS NOT NULL) AS attempts
    `)) as { pending: string; attempts: string }[];
    if (Number(state.pending) || Number(state.attempts)) {
      throw new Error(
        'WhatsApp provisioning history exists; preserve the migration and its data.',
      );
    }
    await runner.query(`
      DROP FUNCTION public.kleva_whatsapp_provision_fail(uuid,uuid,uuid,text);
      DROP FUNCTION public.kleva_whatsapp_provision_finish(uuid,uuid,uuid,text,text,timestamptz);
      DROP FUNCTION public.kleva_whatsapp_provision_checkpoint(uuid,uuid,uuid,text);
      DROP FUNCTION public.kleva_whatsapp_provision_read(uuid,uuid,uuid);
      DROP FUNCTION public.kleva_whatsapp_stage_provisioning(uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz,integer,boolean);
      DROP FUNCTION public.kleva_whatsapp_signup_status_v2();
      DROP FUNCTION public.kleva_whatsapp_signup_claim_v2(uuid);
      DROP FUNCTION public.kleva_whatsapp_signup_start_v2(uuid,timestamptz);
      DROP TABLE public.whatsapp_pending_credentials;
      ALTER TABLE public.whatsapp_signup_attempts
        DROP CONSTRAINT CHK_whatsapp_signup_session_digest,
        DROP CONSTRAINT CHK_whatsapp_signup_stage,
        DROP CONSTRAINT UQ_whatsapp_signup_attempt_tenant,
        DROP COLUMN session_digest,
        DROP COLUMN attempt_version,
        DROP COLUMN selected_waba_id,
        DROP COLUMN selected_phone_number_id,
        DROP COLUMN processing_stage,
        DROP COLUMN operation_id,
        DROP COLUMN connection_id,
        DROP COLUMN expected_revision,
        DROP COLUMN reconnect;
      ALTER TABLE public.outbox_operations DROP CONSTRAINT UQ_outbox_operation_tenant;
    `);
  }
}
