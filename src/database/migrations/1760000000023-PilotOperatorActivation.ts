import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Exposes pilot approval only to individually provisioned operator logins. */
export class PilotOperatorActivation1760000000023 implements MigrationInterface {
  name = 'PilotOperatorActivation1760000000023';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE FUNCTION public.kleva_pilot_activate(target_enrollment uuid, evidence_reference text)
      RETURNS TABLE(enrollment_id uuid, business_id uuid, connection_id uuid,
        status varchar, activated_at timestamptz, activated_by text, activation_reference text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        IF session_user !~ '^kleva_pilot_operator_[a-z0-9_]{1,40}$' THEN
          RAISE EXCEPTION 'pilot operator role required' USING ERRCODE = '42501';
        END IF;
        IF evidence_reference IS NULL OR evidence_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{5,199}$' THEN
          RAISE EXCEPTION 'valid approval evidence reference required' USING ERRCODE = '22023';
        END IF;
        RETURN QUERY
        UPDATE public.business_pilot_enrollments e
          SET status = 'ACTIVE', activated_at = now(), activated_by = session_user,
              activation_reference = evidence_reference, updated_at = now()
          FROM public.businesses b, public.channel_connections c
          WHERE e.id = target_enrollment AND e.status = 'PENDING_REVIEW'
            AND b.id = e.business_id AND b.status = 'active'
            AND c.id = e.connection_id AND c."businessId" = e.business_id
            AND c.provider = 'whatsapp' AND c.status = 'active'
            AND c."verifiedAt" IS NOT NULL
          RETURNING e.id, e.business_id, e.connection_id, e.status,
            e.activated_at, e.activated_by, e.activation_reference;
      END $$;

      REVOKE ALL ON FUNCTION public.kleva_pilot_activate(uuid,text) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles
          WHERE rolname ~ '^kleva_pilot_operator_[a-z0-9_]{1,40}$'
        LOOP
          EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', role_name);
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_pilot_activate(uuid,text) TO %I', role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP FUNCTION public.kleva_pilot_activate(uuid,text)');
  }
}
