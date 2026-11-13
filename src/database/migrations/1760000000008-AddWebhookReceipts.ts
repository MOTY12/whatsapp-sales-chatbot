import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebhookReceipts1760000000008 implements MigrationInterface {
  name = 'AddWebhookReceipts1760000000008';

  async up(runner: QueryRunner) {
    await runner.query(`
      CREATE UNIQUE INDEX "UQ_outbox_id_tenant" ON public.outbox_operations (id, "businessId");
      CREATE TABLE public.webhook_receipts (
        id uuid PRIMARY KEY,
        provider varchar(32) NOT NULL,
        connection_id uuid NOT NULL,
        business_id uuid NOT NULL,
        event_key varchar(300) NOT NULL,
        event_type varchar(16) NOT NULL CHECK (event_type IN ('message', 'delivery')),
        payload jsonb NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now(),
        handed_off_at timestamptz,
        CONSTRAINT "UQ_webhook_event" UNIQUE (provider, connection_id, event_key),
        CONSTRAINT "FK_webhook_connection_tenant" FOREIGN KEY (connection_id, business_id)
          REFERENCES public.channel_connections (id, "businessId"),
        CONSTRAINT "FK_webhook_outbox_tenant" FOREIGN KEY (id, business_id)
          REFERENCES public.outbox_operations (id, "businessId") DEFERRABLE INITIALLY DEFERRED
      );
      ALTER TABLE public.webhook_receipts ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.webhook_receipts FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_webhook_internal ON public.webhook_receipts
        USING (current_user::text !~ '^kleva_(merchant|identity)_');
    `);
  }

  async down(runner: QueryRunner) {
    await runner.query(`
      LOCK TABLE public.webhook_receipts IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM public.webhook_receipts) THEN
          RAISE EXCEPTION 'Webhook receipts exist. Preserve the schema for rollback.';
        END IF;
      END $$;
      DROP TABLE public.webhook_receipts;
      DROP INDEX public."UQ_outbox_id_tenant";
    `);
  }
}
