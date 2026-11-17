import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MerchantSignupAndOnboarding1760000000019 implements MigrationInterface {
  name = 'MerchantSignupAndOnboarding1760000000019';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE public.merchant_login_attempts
        ADD COLUMN intent varchar(16) NOT NULL DEFAULT 'login'
          CHECK (intent IN ('signup', 'login'));

      CREATE TABLE public.merchant_onboarding_progress (
        account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
        current_step varchar(32) NOT NULL DEFAULT 'business_profile'
          CHECK (current_step IN ('business_profile','whatsapp','products_faq','ai_assistant','dashboard')),
        completed_steps text[] NOT NULL DEFAULT ARRAY['account']::text[],
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_onboarding_completed_steps CHECK (
          completed_steps <@ ARRAY['account','business_profile']::text[]
        )
      );
      ALTER TABLE public.merchant_onboarding_progress ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.merchant_onboarding_progress FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_onboarding_progress_owner
        ON public.merchant_onboarding_progress
        USING (current_user = pg_get_userbyid(
          (SELECT relowner FROM pg_class
           WHERE oid = 'public.merchant_onboarding_progress'::regclass)
        ))
        WITH CHECK (current_user = pg_get_userbyid(
          (SELECT relowner FROM pg_class
           WHERE oid = 'public.merchant_onboarding_progress'::regclass)
        ));

      INSERT INTO public.merchant_onboarding_progress (account_id, current_step, completed_steps)
      SELECT a.id,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.business_members m
          JOIN public.businesses b ON b.id = m."businessId" AND b.status = 'active'
          WHERE m."accountId" = a.id AND m.status = 'active'
        ) THEN 'whatsapp' ELSE 'business_profile' END,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.business_members m
          JOIN public.businesses b ON b.id = m."businessId" AND b.status = 'active'
          WHERE m."accountId" = a.id AND m.status = 'active'
        ) THEN ARRAY['account','business_profile']::text[]
          ELSE ARRAY['account']::text[] END
      FROM public.accounts a;

      CREATE FUNCTION public.kleva_consume_login_intent(state_key text, binding_key text)
      RETURNS TABLE (nonce text, verifier text, intent varchar)
      LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        DELETE FROM public.merchant_login_attempts a
        WHERE a.state_digest = state_key AND a.binding_digest = binding_key
          AND a.expires_at > now()
        RETURNING a.nonce, a.verifier, a.intent
      $$;

      CREATE FUNCTION public.kleva_complete_oidc_auth(
        verified_issuer text, verified_subject text, session_key text,
        csrf_key text, previous_key text, auth_intent text
      ) RETURNS TABLE (account_id uuid, outcome text, has_business boolean, current_step varchar)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE merchant_id uuid;
      BEGIN
        IF auth_intent NOT IN ('signup', 'login') THEN
          RETURN QUERY SELECT NULL::uuid, 'invalid_intent'::text, false, NULL::varchar;
          RETURN;
        END IF;

        SELECT a.id INTO merchant_id FROM public.accounts a
          WHERE a.issuer = verified_issuer AND a.subject = verified_subject
          FOR UPDATE;

        IF auth_intent = 'login' AND merchant_id IS NULL THEN
          RETURN QUERY SELECT NULL::uuid, 'account_not_found'::text, false, NULL::varchar;
          RETURN;
        END IF;
        IF auth_intent = 'signup' AND merchant_id IS NOT NULL THEN
          RETURN QUERY SELECT merchant_id, 'account_exists'::text, false, NULL::varchar;
          RETURN;
        END IF;

        IF auth_intent = 'signup' THEN
          INSERT INTO public.accounts (issuer, subject)
          VALUES (verified_issuer, verified_subject)
          ON CONFLICT (issuer, subject) DO NOTHING
          RETURNING id INTO merchant_id;
          IF merchant_id IS NULL THEN
            RETURN QUERY SELECT NULL::uuid, 'account_exists'::text, false, NULL::varchar;
            RETURN;
          END IF;
          INSERT INTO public.merchant_onboarding_progress (account_id)
          VALUES (merchant_id)
          ON CONFLICT ON CONSTRAINT merchant_onboarding_progress_pkey DO NOTHING;
        END IF;

        IF previous_key IS NOT NULL THEN
          DELETE FROM public.merchant_sessions WHERE token_digest = previous_key;
        END IF;
        INSERT INTO public.merchant_sessions (token_digest, csrf_digest, account_id)
        VALUES (session_key, csrf_key, merchant_id);

        RETURN QUERY SELECT merchant_id, 'authenticated'::text, EXISTS (
          SELECT 1 FROM public.business_members m
          JOIN public.businesses b ON b.id = m."businessId" AND b.status = 'active'
          WHERE m."accountId" = merchant_id AND m.status = 'active'
        ), p.current_step FROM public.merchant_onboarding_progress p
          WHERE p.account_id = merchant_id;
      END
      $$;

      CREATE FUNCTION public.kleva_read_onboarding_progress(session_key text)
      RETURNS TABLE (current_step varchar, completed_steps text[], updated_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT p.current_step, p.completed_steps, p.updated_at
        FROM public.merchant_onboarding_progress p
        WHERE p.account_id = public.kleva_session_account(session_key)
      $$;

      CREATE FUNCTION public.kleva_set_onboarding_step(session_key text, step_name text)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp AS $$
      DECLARE actor uuid := public.kleva_session_account(session_key);
      BEGIN
        IF actor IS NULL OR step_name NOT IN
          ('business_profile','whatsapp','products_faq','ai_assistant','dashboard') THEN
          RETURN false;
        END IF;
        UPDATE public.merchant_onboarding_progress
          SET current_step = step_name, updated_at = now()
          WHERE account_id = actor;
        RETURN FOUND;
      END
      $$;

      CREATE FUNCTION public.kleva_track_business_onboarding()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        IF NEW."accountId" IS NOT NULL AND NEW.status = 'active' AND NEW.role = 'owner' THEN
          INSERT INTO public.merchant_onboarding_progress
            (account_id, current_step, completed_steps)
          VALUES (NEW."accountId", 'whatsapp', ARRAY['account','business_profile']::text[])
          ON CONFLICT (account_id) DO UPDATE SET
            current_step = CASE
              WHEN public.merchant_onboarding_progress.current_step = 'business_profile'
                THEN 'whatsapp'
              ELSE public.merchant_onboarding_progress.current_step END,
            completed_steps = ARRAY['account','business_profile']::text[],
            updated_at = now();
        END IF;
        RETURN NEW;
      END
      $$;
      CREATE TRIGGER trg_merchant_onboarding_progress
        AFTER INSERT OR UPDATE OF status, role ON public.business_members
        FOR EACH ROW EXECUTE FUNCTION public.kleva_track_business_onboarding();

      REVOKE ALL ON FUNCTION public.kleva_consume_login_intent(text,text) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_complete_oidc_auth(text,text,text,text,text,text) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_read_onboarding_progress(text) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_set_onboarding_step(text,text) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_track_business_onboarding() FROM PUBLIC;
      DO $$ DECLARE role_name name; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname::text ~ '^kleva_identity_' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_consume_login_intent(text,text), public.kleva_complete_oidc_auth(text,text,text,text,text,text), public.kleva_read_onboarding_progress(text), public.kleva_set_onboarding_step(text,text) TO %I', role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM public.merchant_onboarding_progress)
          OR EXISTS (SELECT 1 FROM public.merchant_login_attempts WHERE intent = 'signup') THEN
          RAISE EXCEPTION 'Merchant registration or onboarding data exists. Preserve it by keeping this migration applied.';
        END IF;
      END $$;
      DROP TRIGGER trg_merchant_onboarding_progress ON public.business_members;
      DROP FUNCTION public.kleva_track_business_onboarding();
      DROP FUNCTION public.kleva_set_onboarding_step(text,text);
      DROP FUNCTION public.kleva_read_onboarding_progress(text);
      DROP FUNCTION public.kleva_complete_oidc_auth(text,text,text,text,text,text);
      DROP FUNCTION public.kleva_consume_login_intent(text,text);
      DROP TABLE public.merchant_onboarding_progress;
      ALTER TABLE public.merchant_login_attempts DROP COLUMN intent;
    `);
  }
}
