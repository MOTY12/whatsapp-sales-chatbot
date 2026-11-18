import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DurableMerchantEmail1760000000021 implements MigrationInterface {
  name = 'DurableMerchantEmail1760000000021';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE public.merchant_email_deliveries (
        id uuid PRIMARY KEY,
        operation_key char(64) NOT NULL UNIQUE CHECK (operation_key ~ '^[a-f0-9]{64}$'),
        encrypted_payload bytea NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'PENDING'
          CHECK (status IN ('PENDING','ACCEPTED','FAILED')),
        provider_message_id varchar(100),
        error_class varchar(40),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CHECK ((status = 'ACCEPTED') = (provider_message_id IS NOT NULL)),
        CHECK (status <> 'FAILED' OR error_class IS NOT NULL)
      );
      ALTER TABLE public.merchant_email_deliveries ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.merchant_email_deliveries FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_merchant_email_internal ON public.merchant_email_deliveries
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname::text ~ '^kleva_runtime_' LOOP
          EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE ON public.merchant_email_deliveries TO %I',
            role_name
          );
        END LOOP;
      END $$;
      ALTER TABLE public.outbox_operations DROP CONSTRAINT "CHK_outbox_error";
      ALTER TABLE public.outbox_operations ADD CONSTRAINT "CHK_outbox_error" CHECK ("lastError" IN
        ('REDIS_UNAVAILABLE','EXECUTION_LEASE_EXPIRED','HANDLER_FAILED','UNREGISTERED_OPERATION',
         'PERMANENT_PROVIDER_FAILURE'));
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    const [result] = (await runner.query(`
      SELECT (SELECT count(*) FROM public.merchant_email_deliveries) AS deliveries,
        (SELECT count(*) FROM public.outbox_operations WHERE operation = 'merchant.email') AS jobs
    `)) as Array<{ deliveries: string; jobs: string }>;
    if (Number(result.deliveries) || Number(result.jobs))
      throw new Error(
        'Merchant email delivery history exists; preserving it for rollback.',
      );
    await runner.query(`
      DROP TABLE public.merchant_email_deliveries;
      ALTER TABLE public.outbox_operations DROP CONSTRAINT "CHK_outbox_error";
      ALTER TABLE public.outbox_operations ADD CONSTRAINT "CHK_outbox_error" CHECK ("lastError" IN
        ('REDIS_UNAVAILABLE','EXECUTION_LEASE_EXPIRED','HANDLER_FAILED','UNREGISTERED_OPERATION'));
    `);
  }
}
