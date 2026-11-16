import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Merchant consent is recorded separately from the operator's pilot approval. */
export class MerchantPilotApproval1760000000018 implements MigrationInterface {
  name = 'MerchantPilotApproval1760000000018';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE public.business_pilot_enrollments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
        connection_id uuid NOT NULL REFERENCES public.channel_connections(id) ON DELETE RESTRICT,
        merchant_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
        consent_version varchar(40) NOT NULL,
        consented_at timestamptz NOT NULL DEFAULT now(),
        ai_provider_disclosed_at timestamptz NOT NULL,
        escalation_acknowledged_at timestamptz NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'PENDING_REVIEW'
          CHECK (status IN ('PENDING_REVIEW','ACTIVE','REVOKED')),
        activated_at timestamptz,
        activated_by varchar(120),
        activation_reference varchar(200),
        revoked_at timestamptz,
        revoked_by_account_id uuid REFERENCES public.accounts(id) ON DELETE RESTRICT,
        revoked_by_operator varchar(120),
        revocation_reference varchar(200),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_pilot_activation_audit CHECK (
          status <> 'ACTIVE' OR (activated_at IS NOT NULL AND activated_by IS NOT NULL
            AND activation_reference IS NOT NULL)
        ),
        CONSTRAINT chk_pilot_revocation_audit CHECK (
          status <> 'REVOKED' OR (revoked_at IS NOT NULL AND
            (revoked_by_account_id IS NOT NULL OR revoked_by_operator IS NOT NULL))
        )
      );
      CREATE UNIQUE INDEX uq_pilot_current_business ON public.business_pilot_enrollments(business_id)
        WHERE status IN ('PENDING_REVIEW','ACTIVE');
      CREATE INDEX idx_pilot_business_history ON public.business_pilot_enrollments(business_id, created_at DESC);
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('GRANT SELECT ON public.business_pilot_enrollments TO %I', role_name);
        END LOOP;
      END $$;
      ALTER TABLE public.business_pilot_enrollments ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.business_pilot_enrollments FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_pilot_internal ON public.business_pilot_enrollments
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE FUNCTION public.kleva_pilot_status()
      RETURNS TABLE(enrollment_id uuid, status varchar, connection_id uuid, consent_version varchar,
        consented_at timestamptz, activated_at timestamptz, revoked_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT e.id, e.status, e.connection_id, e.consent_version, e.consented_at, e.activated_at, e.revoked_at
        FROM public.business_pilot_enrollments e
        WHERE e.business_id = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND public.kleva_current_role() = 'owner'
        ORDER BY e.created_at DESC LIMIT 1
      $$;

      CREATE FUNCTION public.kleva_pilot_enroll(target_connection uuid, version text,
        ai_provider_ack boolean, escalation_ack boolean)
      RETURNS TABLE(enrollment_id uuid, status varchar, created_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE business_key uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        account_key uuid := public.kleva_current_account();
        existing public.business_pilot_enrollments%ROWTYPE;
        created public.business_pilot_enrollments%ROWTYPE;
      BEGIN
        IF public.kleva_current_role() IS DISTINCT FROM 'owner' OR account_key IS NULL THEN
          RAISE EXCEPTION 'owner authorization required' USING ERRCODE = '42501';
        END IF;
        IF version <> 'pilot-merchant-v1' OR ai_provider_ack IS DISTINCT FROM true
          OR escalation_ack IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'pilot consent requirements not met' USING ERRCODE = '22023';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.channel_connections c WHERE c.id = target_connection
          AND c."businessId" = business_key AND c.provider = 'whatsapp' AND c.status = 'active'
          AND c."verifiedAt" IS NOT NULL) THEN
          RAISE EXCEPTION 'verified active WhatsApp connection required' USING ERRCODE = '22023';
        END IF;
        PERFORM 1 FROM public.businesses b WHERE b.id = business_key AND b.status = 'active' FOR UPDATE;
        SELECT * INTO existing FROM public.business_pilot_enrollments e WHERE e.business_id = business_key
          AND e.status IN ('PENDING_REVIEW','ACTIVE') FOR UPDATE;
        IF FOUND THEN
          IF existing.connection_id <> target_connection OR existing.merchant_account_id <> account_key
            OR existing.consent_version <> version THEN
            RAISE EXCEPTION 'existing pilot enrollment must be revoked before changing it' USING ERRCODE = '23505';
          END IF;
          RETURN QUERY SELECT existing.id, existing.status, existing.created_at;
          RETURN;
        END IF;
        INSERT INTO public.business_pilot_enrollments(business_id, connection_id, merchant_account_id,
          consent_version, ai_provider_disclosed_at, escalation_acknowledged_at)
        VALUES (business_key, target_connection, account_key, version, now(), now()) RETURNING * INTO created;
        RETURN QUERY SELECT created.id, created.status, created.created_at;
      END $$;

      CREATE FUNCTION public.kleva_pilot_revoke(target_enrollment uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE business_key uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        account_key uuid := public.kleva_current_account(); changed integer;
      BEGIN
        IF public.kleva_current_role() IS DISTINCT FROM 'owner' OR account_key IS NULL THEN
          RAISE EXCEPTION 'owner authorization required' USING ERRCODE = '42501';
        END IF;
        UPDATE public.business_pilot_enrollments SET status='REVOKED', revoked_at=now(),
          revoked_by_account_id=account_key, updated_at=now()
        WHERE id=target_enrollment AND business_id=business_key AND status IN ('PENDING_REVIEW','ACTIVE');
        GET DIAGNOSTICS changed = ROW_COUNT;
        RETURN changed = 1;
      END $$;

      REVOKE ALL ON FUNCTION public.kleva_pilot_status() FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_pilot_enroll(uuid,text,boolean,boolean) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_pilot_revoke(uuid) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_merchant_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_pilot_status() TO %I', role_name);
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_pilot_enroll(uuid,text,boolean,boolean) TO %I', role_name);
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_pilot_revoke(uuid) TO %I', role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM public.business_pilot_enrollments) THEN
          RAISE EXCEPTION 'Pilot consent and approval evidence exists; preserve it during rollback.';
        END IF;
      END $$;
      REVOKE ALL ON FUNCTION public.kleva_pilot_status() FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_pilot_enroll(uuid,text,boolean,boolean) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_pilot_revoke(uuid) FROM PUBLIC;
      DROP FUNCTION public.kleva_pilot_status();
      DROP FUNCTION public.kleva_pilot_enroll(uuid,text,boolean,boolean);
      DROP FUNCTION public.kleva_pilot_revoke(uuid);
      DROP TABLE public.business_pilot_enrollments;
    `);
  }
}
