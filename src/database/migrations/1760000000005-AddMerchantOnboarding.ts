import type { MigrationInterface, QueryRunner } from 'typeorm';
import { onboardingFunctions } from '../merchant-access';

export class AddMerchantOnboarding1760000000005 implements MigrationInterface {
  name = 'AddMerchantOnboarding1760000000005';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE public.businesses ALTER COLUMN "whatsappNumber" DROP NOT NULL;

      CREATE TABLE public.merchant_business_requests (
        account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
        request_key uuid NOT NULL,
        request_digest bytea NOT NULL,
        business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
        PRIMARY KEY (account_id, request_key)
      );
      ALTER TABLE public.merchant_business_requests ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.merchant_business_requests FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_onboarding_owner ON public.merchant_business_requests
        USING (current_user = pg_get_userbyid(
          (SELECT relowner FROM pg_class WHERE oid = 'public.merchant_business_requests'::regclass)
        ));

      CREATE FUNCTION public.kleva_create_merchant_business(session_key text, request_id uuid, fields jsonb)
      RETURNS TABLE (business_id uuid, outcome text) LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp AS $$
      DECLARE
        actor uuid := public.kleva_session_account(session_key);
        fingerprint bytea := sha256(convert_to(fields::text, 'UTF8'));
        existing public.merchant_business_requests%ROWTYPE;
        created uuid;
      BEGIN
        IF actor IS NULL THEN
          RETURN QUERY SELECT NULL::uuid, 'unauthorized'::text;
          RETURN;
        END IF;

        INSERT INTO public.merchant_business_requests (account_id, request_key, request_digest)
        VALUES (actor, request_id, fingerprint)
        ON CONFLICT (account_id, request_key) DO NOTHING;
        IF NOT FOUND THEN
          SELECT * INTO STRICT existing FROM public.merchant_business_requests r
            WHERE r.account_id = actor AND r.request_key = request_id;
          IF existing.request_digest <> fingerprint THEN
            RETURN QUERY SELECT NULL::uuid, 'conflict'::text;
          ELSE
            RETURN QUERY SELECT existing.business_id, 'replayed'::text;
          END IF;
          RETURN;
        END IF;

        INSERT INTO public.businesses (name, industry, phone, timezone, config)
        VALUES (fields->>'name', fields->>'industry', fields->>'phone', fields->>'timezone',
          jsonb_build_object('profile', jsonb_strip_nulls(jsonb_build_object(
            'description', fields->>'description', 'openingHours', fields->>'openingHours'
          ))))
        RETURNING id INTO created;

        INSERT INTO public.business_members ("businessId", "accountId", role, status)
        VALUES (created, actor, 'owner', 'active');

        UPDATE public.merchant_business_requests r SET business_id = created
          WHERE r.account_id = actor AND r.request_key = request_id;
        RETURN QUERY SELECT created, 'created'::text;
      END
      $$;

      CREATE FUNCTION public.kleva_read_merchant_profile()
      RETURNS TABLE (id uuid, name varchar, status varchar, industry varchar, phone varchar,
        timezone varchar, description text, "openingHours" text)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT b.id, b.name, b.status, b.industry, b.phone, b.timezone,
          b.config #>> '{profile,description}', b.config #>> '{profile,openingHours}'
        FROM public.businesses b
        WHERE b.id = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND public.kleva_current_role() IN ('owner', 'agent', 'editor')
      $$;

      CREATE FUNCTION public.kleva_update_merchant_profile(fields jsonb)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE
        target uuid := NULLIF(current_setting('kleva.business_id', true), '')::uuid;
        actor uuid := public.kleva_current_account();
      BEGIN
        PERFORM 1 FROM public.business_members m
          WHERE m."businessId" = target AND m."accountId" = actor
            AND m.role = 'owner' AND m.status = 'active'
          FOR SHARE;
        IF NOT FOUND THEN RETURN false; END IF;

        UPDATE public.businesses b SET
          name = COALESCE(fields->>'name', b.name),
          industry = COALESCE(fields->>'industry', b.industry),
          phone = COALESCE(fields->>'phone', b.phone),
          timezone = COALESCE(fields->>'timezone', b.timezone),
          config = CASE WHEN fields ?| ARRAY['description', 'openingHours'] THEN
            jsonb_set(COALESCE(b.config, '{}'::jsonb), '{profile}',
              COALESCE(NULLIF(b.config->'profile', 'null'::jsonb), '{}'::jsonb) ||
              (CASE WHEN fields ? 'description' THEN jsonb_build_object('description', fields->>'description') ELSE '{}'::jsonb END) ||
              (CASE WHEN fields ? 'openingHours' THEN jsonb_build_object('openingHours', fields->>'openingHours') ELSE '{}'::jsonb END))
            ELSE b.config END,
          "updatedAt" = now()
        WHERE b.id = target AND b.status = 'active';
        RETURN FOUND;
      END
      $$;
      REVOKE ALL ON FUNCTION ${onboardingFunctions.map((fn) => 'public.' + fn).join(', ')} FROM PUBLIC;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM public.merchant_business_requests)
          OR EXISTS (SELECT 1 FROM public.businesses WHERE "whatsappNumber" IS NULL) THEN
          RAISE EXCEPTION 'Merchant onboarding data exists. Roll back the application without reverting this migration.';
        END IF;
      END $$;
      DROP FUNCTION ${onboardingFunctions.map((fn) => 'public.' + fn).join(', ')};
      DROP TABLE public.merchant_business_requests;
      ALTER TABLE public.businesses ALTER COLUMN "whatsappNumber" SET NOT NULL;
    `);
  }
}
