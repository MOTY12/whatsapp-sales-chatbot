import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenantUsageLedger1760000000010 implements MigrationInterface {
  name = 'AddTenantUsageLedger1760000000010';

  async up(runner: QueryRunner) {
    await runner.query(`
      CREATE TABLE public.business_usage_limits (
        business_id uuid PRIMARY KEY,
        monthly_whatsapp_messages integer CHECK (monthly_whatsapp_messages >= 0),
        monthly_ai_input_tokens integer CHECK (monthly_ai_input_tokens >= 0),
        monthly_ai_output_tokens integer CHECK (monthly_ai_output_tokens >= 0),
        ai_tokens_per_request integer CHECK (ai_tokens_per_request >= 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_business_usage_limits_business"
          FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE
      );

      CREATE TABLE public.usage_reservations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        category varchar(32) NOT NULL CHECK (category IN
          ('whatsapp_outbound', 'ai_input_tokens', 'ai_output_tokens')),
        period_start date NOT NULL,
        idempotency_key varchar(200) NOT NULL CHECK (btrim(idempotency_key) <> ''),
        reserved_amount integer NOT NULL CHECK (reserved_amount >= 0),
        consumed_amount integer NOT NULL DEFAULT 0 CHECK (consumed_amount >= 0),
        released_amount integer NOT NULL DEFAULT 0 CHECK (released_amount >= 0),
        status varchar(24) NOT NULL DEFAULT 'RESERVED' CHECK (status IN
          ('RESERVED', 'COMMITTED', 'RELEASED', 'FAILED', 'UNCERTAIN',
           'PROVIDER_ACCEPTED', 'DELIVERED')),
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_usage_reservation_accounting" CHECK
          (consumed_amount + released_amount <= reserved_amount),
        CONSTRAINT "FK_usage_reservations_business"
          FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE,
        CONSTRAINT "UQ_usage_reservation_idempotency"
          UNIQUE (business_id, category, idempotency_key)
      );
      CREATE INDEX "IDX_usage_period_category"
        ON public.usage_reservations (business_id, period_start, category);
      CREATE INDEX "IDX_usage_expired_reservations"
        ON public.usage_reservations (expires_at, id) WHERE status = 'RESERVED';

      ALTER TABLE public.business_usage_limits ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.business_usage_limits FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_usage_limits_internal ON public.business_usage_limits
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
      ALTER TABLE public.usage_reservations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.usage_reservations FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_usage_reservations_internal ON public.usage_reservations
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
    `);
  }

  async down(runner: QueryRunner) {
    await runner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM public.usage_reservations)
           OR EXISTS (SELECT 1 FROM public.business_usage_limits) THEN
          RAISE EXCEPTION 'Usage ledger or tenant limits exist. Preserve the schema for rollback.';
        END IF;
      END $$;
      DROP TABLE public.usage_reservations;
      DROP TABLE public.business_usage_limits;
    `);
  }
}
