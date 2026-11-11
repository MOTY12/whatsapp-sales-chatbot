import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  merchantFunctions,
  merchantPolicyTables,
  policyFunctions,
} from '../merchant-access';

export class AddMerchantAuth1760000000004 implements MigrationInterface {
  name = 'AddMerchantAuth1760000000004';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE merchant_login_attempts (
        state_digest text PRIMARY KEY,
        binding_digest text NOT NULL,
        nonce text NOT NULL,
        verifier text NOT NULL,
        expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
      );
      CREATE INDEX "IDX_merchant_login_expiry" ON merchant_login_attempts (expires_at);
      CREATE TABLE merchant_sessions (
        token_digest text PRIMARY KEY,
        csrf_digest text NOT NULL,
        account_id uuid NOT NULL,
        expires_at timestamptz NOT NULL DEFAULT now() + interval '8 hours',
        CONSTRAINT "FK_merchant_sessions_account" FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );
      CREATE INDEX "IDX_merchant_session_account" ON merchant_sessions (account_id);
      CREATE INDEX "IDX_merchant_session_expiry" ON merchant_sessions (expires_at);
    `);

    // These narrowly scoped functions run as the migration owner. All objects
    // are qualified and PUBLIC execute is revoked within this transaction.
    await runner.query(`
      CREATE FUNCTION public.kleva_consume_login(state_key text, binding_key text)
      RETURNS TABLE (nonce text, verifier text) LANGUAGE sql SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp AS $$
        DELETE FROM public.merchant_login_attempts a
        WHERE a.state_digest = state_key AND a.binding_digest = binding_key AND a.expires_at > now()
        RETURNING a.nonce, a.verifier
      $$;

      CREATE FUNCTION public.kleva_issue_session(
        verified_issuer text, verified_subject text, session_key text, csrf_key text, previous_key text
      ) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp AS $$
      DECLARE merchant_id uuid;
      BEGIN
        INSERT INTO public.accounts (issuer, subject) VALUES (verified_issuer, verified_subject)
        ON CONFLICT (issuer, subject) DO UPDATE SET subject = EXCLUDED.subject
        RETURNING id INTO merchant_id;

        DELETE FROM public.merchant_sessions WHERE token_digest = previous_key;
        INSERT INTO public.merchant_sessions (token_digest, csrf_digest, account_id)
        VALUES (session_key, csrf_key, merchant_id);
        RETURN merchant_id;
      END
      $$;

      CREATE FUNCTION public.kleva_session_account(session_key text, csrf_key text DEFAULT NULL)
      RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp AS $$
        SELECT account_id FROM public.merchant_sessions
        WHERE token_digest = session_key AND expires_at > now()
          AND (csrf_key IS NULL OR csrf_digest = csrf_key)
      $$;

      CREATE FUNCTION public.kleva_revoke_session(session_key text, csrf_key text)
      RETURNS void LANGUAGE sql SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp AS $$
        DELETE FROM public.merchant_sessions
        WHERE token_digest = session_key AND csrf_digest = csrf_key
      $$;

      CREATE FUNCTION public.kleva_list_memberships(session_key text)
      RETURNS TABLE ("businessId" uuid, role varchar) LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp AS $$
        SELECT m."businessId", m.role FROM public.business_members m
        JOIN public.businesses b ON b.id = m."businessId" AND b.status = 'active'
        WHERE m."accountId" = public.kleva_session_account(session_key)
          AND m.status = 'active'
        ORDER BY m."businessId"
      $$;

      CREATE FUNCTION public.kleva_current_account()
      RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp AS $$
        SELECT CASE WHEN session_user::text ~ '^kleva_merchant_' THEN
          public.kleva_session_account(current_setting('kleva.session_digest', true))
        END
      $$;

      CREATE FUNCTION public.kleva_current_role()
      RETURNS varchar LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp AS $$
        SELECT m.role FROM public.business_members m
        JOIN public.businesses b ON b.id = m."businessId" AND b.status = 'active'
        WHERE m."businessId" = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND m."accountId" = public.kleva_current_account()
          AND m.status = 'active'
      $$;
    `);
    await runner.query(
      `REVOKE ALL ON FUNCTION ${merchantFunctions.map((fn) => `public.${fn}`).join(', ')} FROM PUBLIC`,
    );

    // PostgreSQL checks function ACLs for policy expressions even when the
    // legacy policy applies. Only context-bound lookups are callable by PUBLIC.
    await runner.query(
      `GRANT EXECUTE ON FUNCTION ${policyFunctions.map((fn) => `public.${fn}`).join(', ')} TO PUBLIC`,
    );

    for (const table of merchantPolicyTables) {
      await runner.query(`
        ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY kleva_legacy ON ${table}
          USING (current_user::text !~ '^kleva_(merchant|identity)_')
          WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
      `);
    }

    for (const table of ['businesses', 'business_members']) {
      const scope = table === 'businesses' ? 'id' : '"businessId"';
      const ownMembership =
        table === 'business_members'
          ? 'AND "accountId" = (SELECT public.kleva_current_account())'
          : '';
      await runner.query(`
        CREATE POLICY kleva_merchant_read ON ${table} FOR SELECT USING (CASE WHEN current_user::text ~ '^kleva_merchant_' THEN
          ${scope} = NULLIF(current_setting('kleva.business_id', true), '')::uuid
          AND (SELECT public.kleva_current_role()) IN ('owner', 'editor', 'agent')
          ${ownMembership}
          ELSE false END
        );
      `);
    }
    await runner.query(`
      CREATE POLICY kleva_merchant_login ON merchant_login_attempts FOR INSERT
      WITH CHECK (current_user::text ~ '^kleva_identity_'
        AND expires_at > now() AND expires_at <= now() + interval '10 minutes');
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    // Remove grants even if the rollback happens after provisioning a role.
    await runner.query(
      'DROP POLICY kleva_merchant_read ON businesses; DROP POLICY kleva_merchant_read ON business_members; DROP POLICY kleva_merchant_login ON merchant_login_attempts',
    );
    for (const table of merchantPolicyTables) {
      await runner.query(`
        DROP POLICY kleva_legacy ON ${table};
        ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY;
        ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;
      `);
    }
    // The two persistent business tables have column ACLs owned by the migration.
    await runner.query(`
      DO $$
      DECLARE merchant name;
      BEGIN
        FOR merchant IN SELECT rolname FROM pg_roles WHERE rolname::text ~ '^kleva_merchant_' LOOP
          EXECUTE format('REVOKE SELECT (id, name, status) ON public.businesses FROM %I', merchant);
          EXECUTE format('REVOKE SELECT ("businessId", "accountId", role, status) ON public.business_members FROM %I', merchant);
        END LOOP;
      END
      $$;
    `);
    for (const fn of [...merchantFunctions].reverse()) {
      await runner.query(`DROP FUNCTION public.${fn}`);
    }
    await runner.query('DROP TABLE merchant_sessions, merchant_login_attempts');
  }
}
