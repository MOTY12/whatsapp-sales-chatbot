import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProcessWhatsAppReceipts1760000000009 implements MigrationInterface {
  name = 'ProcessWhatsAppReceipts1760000000009';

  async up(runner: QueryRunner) {
    await runner.query(`
      ALTER TABLE public.webhook_receipts
        ADD COLUMN processed_at timestamptz,
        ADD COLUMN processing_outcome varchar(40);
      CREATE UNIQUE INDEX "UQ_webhook_receipt_tenant_id"
        ON public.webhook_receipts (id, business_id);
      CREATE UNIQUE INDEX "UQ_messages_tenant_id"
        ON public.messages ("businessId", id);

      CREATE TABLE public.whatsapp_response_intents (
        id uuid PRIMARY KEY,
        business_id uuid NOT NULL,
        receipt_id uuid NOT NULL UNIQUE,
        message_id uuid NOT NULL,
        response_kind varchar(32) NOT NULL
          CHECK (response_kind IN ('owner_command', 'legacy_onboarding')),
        status varchar(16) NOT NULL DEFAULT 'PENDING'
          CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_whatsapp_response_receipt_tenant"
          FOREIGN KEY (receipt_id, business_id)
          REFERENCES public.webhook_receipts (id, business_id) ON DELETE CASCADE,
        CONSTRAINT "FK_whatsapp_response_message_tenant"
          FOREIGN KEY (business_id, message_id)
          REFERENCES public.messages ("businessId", id) ON DELETE CASCADE
      );
      CREATE INDEX "IDX_whatsapp_response_pending"
        ON public.whatsapp_response_intents (created_at) WHERE status = 'PENDING';
      ALTER TABLE public.whatsapp_response_intents ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.whatsapp_response_intents FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_response_intent_internal ON public.whatsapp_response_intents
        USING (current_user::text !~ '^kleva_(merchant|identity)_');
    `);
  }

  async down(runner: QueryRunner) {
    await runner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM public.whatsapp_response_intents) THEN
          RAISE EXCEPTION 'Pending response intent history exists. Preserve the schema for rollback.';
        END IF;
      END $$;
      DROP TABLE public.whatsapp_response_intents;
      DROP INDEX public."UQ_messages_tenant_id";
      DROP INDEX public."UQ_webhook_receipt_tenant_id";
      ALTER TABLE public.webhook_receipts
        DROP COLUMN processing_outcome, DROP COLUMN processed_at;
    `);
  }
}
