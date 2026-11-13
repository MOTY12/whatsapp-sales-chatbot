import type { MigrationInterface, QueryRunner } from 'typeorm';
import { secureWhatsAppFunctions } from '../merchant-access';

export class SecureWhatsAppCredentials1760000000007 implements MigrationInterface {
  name = 'SecureWhatsAppCredentials1760000000007';

  async up(runner: QueryRunner) {
    await runner.query(`
      ALTER TABLE public.channel_connections ADD CONSTRAINT "UQ_channel_connection_tenant"
        UNIQUE (id, "businessId");
      CREATE TABLE public.whatsapp_credentials (
        business_id uuid PRIMARY KEY,
        connection_id uuid NOT NULL,
        envelope jsonb,
        expires_at timestamptz,
        revision integer NOT NULL DEFAULT 1,
        CONSTRAINT "FK_whatsapp_credentials_tenant" FOREIGN KEY (connection_id, business_id)
          REFERENCES public.channel_connections(id, "businessId") ON DELETE RESTRICT
      );
      ALTER TABLE public.whatsapp_credentials ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.whatsapp_credentials FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_credential_internal ON public.whatsapp_credentials
        USING (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE FUNCTION public.kleva_whatsapp_status()
      RETURNS TABLE (id uuid, "wabaId" varchar, "phoneNumberId" varchar,
        "displayName" varchar, status text, revision integer)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT c.id, c."externalAccountId", c."externalAssetId", c."displayName",
          CASE WHEN w.expires_at <= now() THEN 'inactive' ELSE c.status END, w.revision
        FROM public.whatsapp_credentials w JOIN public.channel_connections c ON c.id = w.connection_id
        WHERE w.business_id = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND public.kleva_current_role() IN ('owner', 'editor', 'agent')
      $$;

      CREATE FUNCTION public.kleva_write_whatsapp(
        operation text, expected_revision integer, connection uuid, asset text,
        account text, label text, encrypted jsonb, expiry timestamptz
      ) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE
        tenant uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        actor uuid := public.kleva_current_account();
        previous public.whatsapp_credentials%ROWTYPE;
        mapped public.channel_connections%ROWTYPE;
      BEGIN
        IF operation NOT IN ('connect','rotate','disconnect') THEN RETURN false; END IF;
        PERFORM 1 FROM public.business_members m
          WHERE m."businessId" = tenant AND m."accountId" = actor
            AND m.role = 'owner' AND m.status = 'active' FOR SHARE;
        IF NOT FOUND THEN RETURN false; END IF;
        PERFORM 1 FROM public.businesses WHERE id = tenant AND status = 'active' FOR UPDATE;
        IF NOT FOUND THEN RETURN false; END IF;
        SELECT * INTO previous FROM public.whatsapp_credentials WHERE business_id = tenant FOR UPDATE;
        IF previous.revision IS DISTINCT FROM expected_revision THEN RETURN false; END IF;
        IF operation = 'disconnect' THEN
          IF previous.connection_id IS NULL THEN RETURN false; END IF;
          UPDATE public.channel_connections SET status = 'inactive', "updatedAt" = now()
            WHERE id = previous.connection_id;
          UPDATE public.whatsapp_credentials SET envelope = NULL, expires_at = NULL, revision = revision + 1
            WHERE business_id = tenant;
          INSERT INTO public.audit_logs ("businessId", "entityType", "entityId", action, "newValue")
            VALUES (tenant, 'whatsapp_connection', previous.connection_id, 'UPDATE',
              jsonb_build_object('operation', operation, 'accountId', actor));
          RETURN true;
        END IF;
        IF encrypted IS NULL OR (expiry IS NOT NULL AND expiry <= now()) THEN RETURN false; END IF;
        IF previous.connection_id IS NOT NULL AND previous.connection_id <> connection THEN RETURN false; END IF;
        IF operation = 'rotate' AND previous.connection_id IS NULL THEN RETURN false; END IF;

        SELECT * INTO mapped FROM public.channel_connections
          WHERE provider = 'whatsapp' AND "externalAssetId" = asset FOR UPDATE;
        IF FOUND THEN
          IF mapped.id <> connection OR mapped."businessId" <> tenant
             OR mapped."externalAccountId" IS DISTINCT FROM account THEN RETURN false; END IF;
          UPDATE public.channel_connections SET status = 'active', "verifiedAt" = now(),
            "legacyBackfill" = false, "displayName" = label, "updatedAt" = now()
            WHERE id = connection;
        ELSE
          INSERT INTO public.channel_connections
            (id, "businessId", provider, "externalAssetId", "externalAccountId", "displayName", status, "verifiedAt")
            VALUES (connection, tenant, 'whatsapp', asset, account, label, 'active', now());
        END IF;
        INSERT INTO public.whatsapp_credentials (business_id, connection_id, envelope, expires_at)
          VALUES (tenant, connection, encrypted, expiry)
          ON CONFLICT (business_id) DO UPDATE SET envelope = EXCLUDED.envelope,
            expires_at = EXCLUDED.expires_at, revision = public.whatsapp_credentials.revision + 1;
        INSERT INTO public.audit_logs ("businessId", "entityType", "entityId", action, "newValue")
          VALUES (tenant, 'whatsapp_connection', connection, 'UPDATE',
            jsonb_build_object('operation', operation, 'accountId', actor));
        RETURN true;
      END
      $$;

      CREATE FUNCTION public.kleva_whatsapp_candidate(asset text)
      RETURNS TABLE (id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT c.id FROM public.channel_connections c
        WHERE c.provider = 'whatsapp' AND c."externalAssetId" = asset
          AND c."businessId" = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND public.kleva_current_role() = 'owner'
      $$;

      CREATE FUNCTION public.kleva_fence_legacy_whatsapp()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        IF ROW(NEW."phoneNumberId", NEW."wabaId", NEW."accessToken", NEW."connectedAt")
          IS DISTINCT FROM ROW(OLD."phoneNumberId", OLD."wabaId", OLD."accessToken", OLD."connectedAt")
          AND EXISTS (SELECT 1 FROM public.whatsapp_credentials WHERE business_id = OLD.id) THEN
          RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Use supervised WhatsApp credential management';
        END IF;
        RETURN NEW;
      END
      $$;
      CREATE TRIGGER kleva_fence_legacy_whatsapp BEFORE UPDATE OF
        "phoneNumberId", "wabaId", "accessToken", "connectedAt" ON public.businesses
        FOR EACH ROW EXECUTE FUNCTION public.kleva_fence_legacy_whatsapp();
      REVOKE ALL ON FUNCTION public.kleva_fence_legacy_whatsapp() FROM PUBLIC;

      REVOKE ALL ON FUNCTION ${secureWhatsAppFunctions.map((fn) => 'public.' + fn).join(', ')} FROM PUBLIC;
    `);
  }

  async down(runner: QueryRunner) {
    await runner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM public.whatsapp_credentials) THEN
          RAISE EXCEPTION 'Secure WhatsApp credentials or fences exist. Keep the migration.';
        END IF;
      END $$;
      DROP FUNCTION ${secureWhatsAppFunctions.map((fn) => 'public.' + fn).join(', ')};
      DROP TRIGGER kleva_fence_legacy_whatsapp ON public.businesses;
      DROP FUNCTION public.kleva_fence_legacy_whatsapp();
      DROP TABLE public.whatsapp_credentials;
      ALTER TABLE public.channel_connections DROP CONSTRAINT "UQ_channel_connection_tenant";
    `);
  }
}
