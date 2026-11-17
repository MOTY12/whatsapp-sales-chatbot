import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Add verified email/password identities without replacing existing merchant IDs. */
export class MerchantEmailAuthentication1760000000020 implements MigrationInterface {
  name = 'MerchantEmailAuthentication1760000000020';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE public.merchant_login_attempts
        DROP CONSTRAINT merchant_login_attempts_intent_check,
        ADD CONSTRAINT merchant_login_attempts_intent_check
          CHECK (intent IN ('signup','login','link')),
        ADD COLUMN link_account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
        ADD COLUMN link_session_digest text;
      ALTER TABLE public.merchant_login_attempts ADD CONSTRAINT chk_merchant_link_attempt
        CHECK ((intent = 'link') = (link_account_id IS NOT NULL AND link_session_digest IS NOT NULL));

      CREATE TABLE public.merchant_auth_profiles (
        account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
        email varchar(254) NOT NULL UNIQUE,
        full_name varchar(160) NOT NULL,
        email_verified_at timestamptz,
        status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_merchant_auth_email_normalized CHECK (email = lower(btrim(email))),
        CONSTRAINT chk_merchant_auth_name CHECK (btrim(full_name) <> '')
      );
      CREATE TABLE public.merchant_password_credentials (
        account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
        password_hash text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.merchant_auth_identities (
        issuer text NOT NULL,
        subject text NOT NULL,
        account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (issuer, subject),
        CONSTRAINT uq_merchant_auth_identity_account UNIQUE (account_id, issuer, subject)
      );
      INSERT INTO public.merchant_auth_identities (issuer, subject, account_id)
        SELECT issuer, subject, id FROM public.accounts
        ON CONFLICT (issuer, subject) DO NOTHING;
      CREATE INDEX idx_merchant_auth_identity_account
        ON public.merchant_auth_identities(account_id);

      CREATE TABLE public.merchant_auth_tokens (
        token_digest char(64) PRIMARY KEY,
        account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
        purpose varchar(24) NOT NULL CHECK (purpose IN ('email_verification','password_reset')),
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_merchant_auth_tokens_account_purpose
        ON public.merchant_auth_tokens(account_id, purpose, created_at DESC);
      CREATE TABLE public.merchant_auth_rate_limits (
        action varchar(32) NOT NULL,
        key_digest char(64) NOT NULL,
        window_started_at timestamptz NOT NULL,
        attempt_count integer NOT NULL CHECK (attempt_count > 0),
        PRIMARY KEY (action, key_digest)
      );

      DO $$ DECLARE table_name text; BEGIN
        FOREACH table_name IN ARRAY ARRAY[
          'merchant_auth_profiles','merchant_password_credentials',
          'merchant_auth_identities','merchant_auth_tokens','merchant_auth_rate_limits'
        ] LOOP
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
          EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
          EXECUTE format($policy$
            CREATE POLICY kleva_auth_owner ON public.%I
              USING (current_user = pg_get_userbyid((SELECT relowner FROM pg_class
                WHERE oid = format('public.%%I', %L)::regclass)))
              WITH CHECK (current_user = pg_get_userbyid((SELECT relowner FROM pg_class
                WHERE oid = format('public.%%I', %L)::regclass)))
          $policy$, table_name, table_name, table_name);
        END LOOP;
      END $$;

      CREATE FUNCTION public.kleva_auth_rate_limit(
        action_key text, digest_key text, maximum integer, window_seconds integer
      ) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp AS $$
      DECLARE current_count integer;
      BEGIN
        IF action_key !~ '^[a-z_]{1,32}$' OR digest_key !~ '^[a-f0-9]{64}$'
          OR maximum < 1 OR window_seconds < 1 THEN RETURN false; END IF;
        DELETE FROM public.merchant_auth_rate_limits
          WHERE window_started_at < now() - interval '1 day';
        INSERT INTO public.merchant_auth_rate_limits AS limits
          (action, key_digest, window_started_at, attempt_count)
        VALUES (action_key, digest_key, now(), 1)
        ON CONFLICT (action, key_digest) DO UPDATE SET
          window_started_at = CASE
            WHEN limits.window_started_at <= now() - make_interval(secs => window_seconds)
              THEN now() ELSE limits.window_started_at END,
          attempt_count = CASE
            WHEN limits.window_started_at <= now() - make_interval(secs => window_seconds)
              THEN 1 ELSE limits.attempt_count + 1 END
        RETURNING attempt_count INTO current_count;
        RETURN current_count <= maximum;
      END $$;

      CREATE FUNCTION public.kleva_register_password(
        normalized_email text, merchant_name text, encoded_hash text,
        verification_digest text, token_expiry timestamptz
      ) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp AS $$
      DECLARE merchant_id uuid := gen_random_uuid();
      BEGIN
        IF normalized_email <> lower(btrim(normalized_email)) OR btrim(merchant_name) = ''
          OR verification_digest !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
        IF EXISTS (SELECT 1 FROM public.merchant_auth_profiles WHERE email = normalized_email)
          THEN RETURN false; END IF;
        INSERT INTO public.accounts (issuer, subject)
          VALUES ('urn:kleva:password', merchant_id::text);
        SELECT id INTO merchant_id FROM public.accounts
          WHERE issuer = 'urn:kleva:password' AND subject = merchant_id::text;
        INSERT INTO public.merchant_auth_profiles(account_id,email,full_name)
          VALUES (merchant_id, normalized_email, btrim(merchant_name));
        INSERT INTO public.merchant_password_credentials(account_id,password_hash)
          VALUES (merchant_id, encoded_hash);
        INSERT INTO public.merchant_onboarding_progress(account_id)
          VALUES (merchant_id)
          ON CONFLICT ON CONSTRAINT merchant_onboarding_progress_pkey DO NOTHING;
        INSERT INTO public.merchant_auth_tokens(token_digest,account_id,purpose,expires_at)
          VALUES (verification_digest,merchant_id,'email_verification',token_expiry);
        RETURN true;
      EXCEPTION WHEN unique_violation THEN RETURN false;
      END $$;

      CREATE FUNCTION public.kleva_password_account(normalized_email text)
      RETURNS TABLE(account_id uuid,password_hash text,email_verified boolean,account_active boolean)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT p.account_id, c.password_hash, p.email_verified_at IS NOT NULL,
          p.status = 'active'
        FROM public.merchant_auth_profiles p
        JOIN public.merchant_password_credentials c ON c.account_id = p.account_id
        WHERE p.email = normalized_email
      $$;

      CREATE FUNCTION public.kleva_create_password_session(
        normalized_email text, session_key text, csrf_key text, previous_key text
      ) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp AS $$
      DECLARE merchant_id uuid;
      BEGIN
        SELECT p.account_id INTO merchant_id FROM public.merchant_auth_profiles p
        JOIN public.merchant_password_credentials c ON c.account_id = p.account_id
        WHERE p.email = normalized_email AND p.email_verified_at IS NOT NULL AND p.status = 'active';
        IF merchant_id IS NULL THEN RETURN NULL; END IF;
        IF previous_key IS NOT NULL THEN DELETE FROM public.merchant_sessions WHERE token_digest = previous_key; END IF;
        INSERT INTO public.merchant_sessions(token_digest,csrf_digest,account_id)
          VALUES(session_key,csrf_key,merchant_id);
        RETURN merchant_id;
      END $$;

      CREATE FUNCTION public.kleva_create_auth_token(
        normalized_email text, token_kind text, token_digest text, token_expiry timestamptz
      ) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp AS $$
      DECLARE merchant_id uuid;
      BEGIN
        IF token_kind NOT IN ('email_verification','password_reset') OR token_digest !~ '^[a-f0-9]{64}$'
          THEN RETURN false; END IF;
        SELECT p.account_id INTO merchant_id FROM public.merchant_auth_profiles p
        WHERE p.email = normalized_email AND p.status = 'active'
          AND ((token_kind = 'email_verification' AND p.email_verified_at IS NULL)
            OR (token_kind = 'password_reset' AND p.email_verified_at IS NOT NULL
              AND EXISTS (SELECT 1 FROM public.merchant_password_credentials c WHERE c.account_id = p.account_id)));
        IF merchant_id IS NULL THEN RETURN false; END IF;
        DELETE FROM public.merchant_auth_tokens WHERE account_id = merchant_id
          AND purpose = token_kind AND consumed_at IS NULL;
        INSERT INTO public.merchant_auth_tokens(token_digest,account_id,purpose,expires_at)
          VALUES(token_digest,merchant_id,token_kind,token_expiry);
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_auth_profile_for_delivery(normalized_email text)
      RETURNS TABLE(full_name text)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
        SELECT p.full_name::text FROM public.merchant_auth_profiles p
        WHERE p.email=normalized_email AND p.status='active'
          AND (p.email_verified_at IS NULL OR EXISTS (
            SELECT 1 FROM public.merchant_password_credentials c WHERE c.account_id=p.account_id
          ))
      $$;

      CREATE FUNCTION public.kleva_verify_email(token_key text)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp AS $$
      DECLARE merchant_id uuid;
      BEGIN
        UPDATE public.merchant_auth_tokens SET consumed_at = now()
        WHERE token_digest = token_key AND purpose = 'email_verification'
          AND consumed_at IS NULL AND expires_at > now()
        RETURNING account_id INTO merchant_id;
        IF merchant_id IS NULL THEN RETURN false; END IF;
        UPDATE public.merchant_auth_profiles SET email_verified_at = now(), updated_at = now()
          WHERE account_id = merchant_id AND email_verified_at IS NULL AND status = 'active';
        RETURN FOUND;
      END $$;

      CREATE FUNCTION public.kleva_reset_password(token_key text, encoded_hash text)
      RETURNS TABLE(reset boolean, email text, full_name text)
      LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp AS $$
      DECLARE merchant_id uuid; merchant_email text; merchant_name text;
      BEGIN
        UPDATE public.merchant_auth_tokens SET consumed_at = now()
        WHERE token_digest = token_key AND purpose = 'password_reset'
          AND consumed_at IS NULL AND expires_at > now()
        RETURNING account_id INTO merchant_id;
        IF merchant_id IS NULL THEN
          RETURN QUERY SELECT false,NULL::text,NULL::text; RETURN;
        END IF;
        UPDATE public.merchant_password_credentials SET password_hash = encoded_hash, updated_at = now()
          WHERE account_id = merchant_id;
        IF NOT FOUND THEN
          RETURN QUERY SELECT false,NULL::text,NULL::text; RETURN;
        END IF;
        SELECT p.email,p.full_name INTO merchant_email,merchant_name
          FROM public.merchant_auth_profiles p WHERE p.account_id=merchant_id;
        DELETE FROM public.merchant_sessions WHERE account_id = merchant_id;
        RETURN QUERY SELECT true,merchant_email,merchant_name;
      END $$;

      CREATE FUNCTION public.kleva_set_password(session_key text, encoded_hash text)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp AS $$
      DECLARE merchant_id uuid := public.kleva_session_account(session_key);
      BEGIN
        IF merchant_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.merchant_auth_profiles
          WHERE account_id = merchant_id AND email_verified_at IS NOT NULL AND status = 'active') THEN RETURN false; END IF;
        INSERT INTO public.merchant_password_credentials(account_id,password_hash)
          VALUES(merchant_id,encoded_hash)
        ON CONFLICT (account_id) DO UPDATE SET password_hash=EXCLUDED.password_hash, updated_at=now();
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_complete_oidc_auth_v2(
        verified_issuer text, verified_subject text, verified_email text, verified_name text,
        provider_email_verified boolean, session_key text, csrf_key text, previous_key text,
        auth_intent text, link_account uuid, link_session text
      ) RETURNS TABLE (account_id uuid, outcome text, has_business boolean, current_step varchar)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE merchant_id uuid; existing_id uuid;
      BEGIN
        IF auth_intent NOT IN ('signup','login','link') THEN
          RETURN QUERY SELECT NULL::uuid,'invalid_intent'::text,false,NULL::varchar; RETURN;
        END IF;
        IF auth_intent = 'link' THEN
          merchant_id := public.kleva_session_account(link_session);
          IF merchant_id IS NULL OR merchant_id <> link_account THEN
            RETURN QUERY SELECT NULL::uuid,'invalid_link_session'::text,false,NULL::varchar; RETURN;
          END IF;
          SELECT i.account_id INTO existing_id FROM public.merchant_auth_identities i
            WHERE i.issuer=verified_issuer AND i.subject=verified_subject FOR UPDATE;
          IF existing_id IS NOT NULL AND existing_id <> merchant_id THEN
            RETURN QUERY SELECT NULL::uuid,'identity_already_linked'::text,false,NULL::varchar; RETURN;
          END IF;
          IF existing_id IS NULL THEN
            INSERT INTO public.merchant_auth_identities(issuer,subject,account_id)
              VALUES(verified_issuer,verified_subject,merchant_id);
          END IF;
        ELSE
          SELECT i.account_id INTO merchant_id FROM public.merchant_auth_identities i
            WHERE i.issuer=verified_issuer AND i.subject=verified_subject FOR UPDATE;
          IF merchant_id IS NULL THEN
            SELECT a.id INTO merchant_id FROM public.accounts a
              WHERE a.issuer=verified_issuer AND a.subject=verified_subject FOR UPDATE;
          END IF;
          IF auth_intent='login' AND merchant_id IS NULL THEN
            RETURN QUERY SELECT NULL::uuid,'account_not_found'::text,false,NULL::varchar; RETURN;
          END IF;
          IF auth_intent='signup' AND merchant_id IS NOT NULL THEN
            RETURN QUERY SELECT merchant_id,'account_exists'::text,false,NULL::varchar; RETURN;
          END IF;
          IF auth_intent='signup' AND (verified_email IS NULL OR verified_name IS NULL OR NOT provider_email_verified) THEN
            RETURN QUERY SELECT NULL::uuid,'verified_profile_required'::text,false,NULL::varchar; RETURN;
          END IF;
          IF auth_intent='signup' THEN
            IF EXISTS (SELECT 1 FROM public.merchant_auth_profiles WHERE email=lower(btrim(verified_email))) THEN
              RETURN QUERY SELECT NULL::uuid,'account_exists'::text,false,NULL::varchar; RETURN;
            END IF;
            INSERT INTO public.accounts(issuer,subject) VALUES(verified_issuer,verified_subject)
              ON CONFLICT(issuer,subject) DO NOTHING RETURNING id INTO merchant_id;
            IF merchant_id IS NULL THEN
              RETURN QUERY SELECT NULL::uuid,'account_exists'::text,false,NULL::varchar; RETURN;
            END IF;
            INSERT INTO public.merchant_auth_identities(issuer,subject,account_id)
              VALUES(verified_issuer,verified_subject,merchant_id);
            INSERT INTO public.merchant_auth_profiles(account_id,email,full_name,email_verified_at)
              VALUES(merchant_id,lower(btrim(verified_email)),btrim(verified_name),now());
            INSERT INTO public.merchant_onboarding_progress(account_id)
              VALUES(merchant_id) ON CONFLICT ON CONSTRAINT merchant_onboarding_progress_pkey DO NOTHING;
          ELSE
            INSERT INTO public.merchant_auth_identities(issuer,subject,account_id)
              VALUES(verified_issuer,verified_subject,merchant_id) ON CONFLICT DO NOTHING;
            IF verified_email IS NOT NULL AND provider_email_verified AND verified_name IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM public.merchant_auth_profiles other
                WHERE other.email=lower(btrim(verified_email)) AND other.account_id<>merchant_id) THEN
              INSERT INTO public.merchant_auth_profiles(account_id,email,full_name,email_verified_at)
                VALUES(merchant_id,lower(btrim(verified_email)),btrim(verified_name),now())
                ON CONFLICT DO NOTHING;
            END IF;
          END IF;
        END IF;
        IF previous_key IS NOT NULL THEN DELETE FROM public.merchant_sessions WHERE token_digest=previous_key; END IF;
        INSERT INTO public.merchant_sessions(token_digest,csrf_digest,account_id)
          VALUES(session_key,csrf_key,merchant_id);
        RETURN QUERY SELECT merchant_id,'authenticated'::text,EXISTS(
          SELECT 1 FROM public.business_members m JOIN public.businesses b ON b.id=m."businessId" AND b.status='active'
          WHERE m."accountId"=merchant_id AND m.status='active'),p.current_step
          FROM public.merchant_onboarding_progress p WHERE p.account_id=merchant_id;
      EXCEPTION WHEN unique_violation THEN
        RETURN QUERY SELECT NULL::uuid,'identity_conflict'::text,false,NULL::varchar;
      END $$;

      REVOKE ALL ON FUNCTION public.kleva_auth_rate_limit(text,text,integer,integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_register_password(text,text,text,text,timestamptz) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_password_account(text) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_create_password_session(text,text,text,text) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_create_auth_token(text,text,text,timestamptz) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_auth_profile_for_delivery(text) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_verify_email(text) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_reset_password(text,text) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_set_password(text,text) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_complete_oidc_auth_v2(text,text,text,text,boolean,text,text,text,text,uuid,text) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_complete_oidc_auth(text,text,text,text,text,text) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.kleva_consume_login_intent(text,text) FROM PUBLIC;
      DROP FUNCTION public.kleva_consume_login_intent(text,text);
      CREATE FUNCTION public.kleva_consume_auth_attempt(state_key text, binding_key text)
      RETURNS TABLE(nonce text,verifier text,intent varchar,link_account_id uuid,link_session_digest text)
      LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
        DELETE FROM public.merchant_login_attempts a
        WHERE a.state_digest=state_key AND a.binding_digest=binding_key AND a.expires_at>now()
        RETURNING a.nonce,a.verifier,a.intent,a.link_account_id,a.link_session_digest
      $$;
      REVOKE ALL ON FUNCTION public.kleva_consume_auth_attempt(text,text) FROM PUBLIC;
      DO $$ DECLARE role_name name; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname::text ~ '^kleva_identity_' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_auth_rate_limit(text,text,integer,integer), public.kleva_register_password(text,text,text,text,timestamptz), public.kleva_password_account(text), public.kleva_create_password_session(text,text,text,text), public.kleva_create_auth_token(text,text,text,timestamptz), public.kleva_auth_profile_for_delivery(text), public.kleva_verify_email(text), public.kleva_reset_password(text,text), public.kleva_set_password(text,text), public.kleva_complete_oidc_auth_v2(text,text,text,text,boolean,text,text,text,text,uuid,text), public.kleva_consume_auth_attempt(text,text) TO %I', role_name);
          EXECUTE format('REVOKE EXECUTE ON FUNCTION public.kleva_complete_oidc_auth(text,text,text,text,text,text) FROM %I', role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM public.merchant_auth_profiles)
          OR EXISTS (SELECT 1 FROM public.merchant_auth_tokens)
          OR EXISTS (SELECT 1 FROM public.merchant_password_credentials)
          OR EXISTS (SELECT 1 FROM public.merchant_auth_identities i
            JOIN public.accounts a ON a.id=i.account_id
            WHERE a.issuer<>i.issuer OR a.subject<>i.subject) THEN
          RAISE EXCEPTION 'Merchant email authentication data exists. Preserve it by keeping this migration applied.';
        END IF;
      END $$;
      DROP FUNCTION public.kleva_consume_auth_attempt(text,text);
      DROP FUNCTION public.kleva_complete_oidc_auth_v2(text,text,text,text,boolean,text,text,text,text,uuid,text);
      DROP FUNCTION public.kleva_set_password(text,text);
      DROP FUNCTION public.kleva_reset_password(text,text);
      DROP FUNCTION public.kleva_verify_email(text);
      DROP FUNCTION public.kleva_create_auth_token(text,text,text,timestamptz);
      DROP FUNCTION public.kleva_auth_profile_for_delivery(text);
      DROP FUNCTION public.kleva_create_password_session(text,text,text,text);
      DROP FUNCTION public.kleva_password_account(text);
      DROP FUNCTION public.kleva_register_password(text,text,text,text,timestamptz);
      DROP FUNCTION public.kleva_auth_rate_limit(text,text,integer,integer);
      ALTER TABLE public.merchant_login_attempts DROP CONSTRAINT chk_merchant_link_attempt;
      ALTER TABLE public.merchant_login_attempts DROP COLUMN link_account_id, DROP COLUMN link_session_digest;
      ALTER TABLE public.merchant_login_attempts DROP CONSTRAINT merchant_login_attempts_intent_check;
      ALTER TABLE public.merchant_login_attempts ADD CONSTRAINT merchant_login_attempts_intent_check CHECK(intent IN ('signup','login'));
      DROP TABLE public.merchant_auth_rate_limits, public.merchant_auth_tokens,
        public.merchant_auth_identities, public.merchant_password_credentials, public.merchant_auth_profiles;
    `);
    await runner.query(`
      CREATE FUNCTION public.kleva_consume_login_intent(state_key text,binding_key text)
      RETURNS TABLE(nonce text,verifier text,intent varchar)
      LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
        DELETE FROM public.merchant_login_attempts a WHERE a.state_digest=state_key
          AND a.binding_digest=binding_key AND a.expires_at>now()
        RETURNING a.nonce,a.verifier,a.intent
      $$;
      REVOKE ALL ON FUNCTION public.kleva_consume_login_intent(text,text) FROM PUBLIC;
      DO $$ DECLARE role_name name; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname::text ~ '^kleva_identity_' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_consume_login_intent(text,text), public.kleva_complete_oidc_auth(text,text,text,text,text,text) TO %I', role_name);
        END LOOP;
      END $$;
    `);
  }
}
