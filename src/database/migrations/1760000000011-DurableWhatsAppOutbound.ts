import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DurableWhatsAppOutbound1760000000011 implements MigrationInterface {
  name = 'DurableWhatsAppOutbound1760000000011';

  async up(runner: QueryRunner) {
    await runner.query(`
      CREATE UNIQUE INDEX "UQ_channel_connections_tenant_id"
        ON public.channel_connections(id, "businessId");
      CREATE UNIQUE INDEX "UQ_outbox_tenant_id"
        ON public.outbox_operations(id, "businessId");
      CREATE UNIQUE INDEX "UQ_whatsapp_response_tenant_id"
        ON public.whatsapp_response_intents(id, business_id);
      CREATE TABLE public.whatsapp_outbound_messages (
        id uuid PRIMARY KEY,
        business_id uuid NOT NULL,
        connection_id uuid NOT NULL,
        conversation_id uuid,
        message_id uuid,
        recipient_whatsapp_id varchar(32) NOT NULL CHECK (recipient_whatsapp_id ~ '^[0-9]{1,32}$'),
        content text NOT NULL CHECK (length(content) BETWEEN 1 AND 4096),
        idempotency_key varchar(200) NOT NULL,
        usage_idempotency_key varchar(200) NOT NULL,
        response_intent_id uuid,
        provider_message_id varchar(255),
        status varchar(16) NOT NULL DEFAULT 'RESERVED' CHECK
          (status IN ('RESERVED', 'SENDING', 'ACCEPTED', 'DELIVERED', 'READ', 'FAILED', 'UNCERTAIN')),
        attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        last_error varchar(64),
        retry_after timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_wa_outbound_business_idempotency" UNIQUE (business_id, idempotency_key),
        CONSTRAINT "UQ_wa_outbound_provider_message" UNIQUE (business_id, provider_message_id),
        CONSTRAINT "FK_wa_outbound_business" FOREIGN KEY (business_id)
          REFERENCES public.businesses(id) ON DELETE RESTRICT,
        CONSTRAINT "FK_wa_outbound_connection_tenant" FOREIGN KEY (connection_id, business_id)
          REFERENCES public.channel_connections(id, "businessId") ON DELETE RESTRICT,
        CONSTRAINT "FK_wa_outbound_conversation_tenant" FOREIGN KEY (business_id, conversation_id)
          REFERENCES public.conversations("businessId", id) ON DELETE RESTRICT,
        CONSTRAINT "FK_wa_outbound_message_tenant" FOREIGN KEY (business_id, message_id)
          REFERENCES public.messages("businessId", id) ON DELETE RESTRICT,
        CONSTRAINT "FK_wa_outbound_response_tenant" FOREIGN KEY (response_intent_id, business_id)
          REFERENCES public.whatsapp_response_intents(id, business_id) ON DELETE RESTRICT,
        CONSTRAINT "FK_wa_outbound_outbox_tenant" FOREIGN KEY (id, business_id)
          REFERENCES public.outbox_operations(id, "businessId") ON DELETE RESTRICT
      );
      CREATE INDEX "IDX_wa_outbound_status" ON public.whatsapp_outbound_messages(status, updated_at);
      CREATE INDEX "IDX_wa_outbound_provider" ON public.whatsapp_outbound_messages(provider_message_id, business_id)
        WHERE provider_message_id IS NOT NULL;
      ALTER TABLE public.whatsapp_outbound_messages ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.whatsapp_outbound_messages FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_whatsapp_outbound_internal ON public.whatsapp_outbound_messages
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      ALTER TABLE public.whatsapp_response_intents
        DROP CONSTRAINT whatsapp_response_intents_status_check,
        ADD CONSTRAINT whatsapp_response_intents_status_check
          CHECK (status IN ('PENDING', 'GENERATING', 'GENERATED', 'QUEUED', 'COMPLETED', 'FAILED', 'UNCERTAIN')),
        ADD COLUMN response_text text,
        ADD COLUMN outbound_message_id uuid,
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
      CREATE UNIQUE INDEX "UQ_whatsapp_response_outbound"
        ON public.whatsapp_response_intents(outbound_message_id) WHERE outbound_message_id IS NOT NULL;

      CREATE TABLE public.whatsapp_unmatched_statuses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL,
        connection_id uuid NOT NULL,
        provider_message_id varchar(255) NOT NULL,
        provider_status varchar(16) NOT NULL CHECK (provider_status IN ('sent', 'delivered', 'read', 'failed')),
        occurred_at timestamptz,
        received_at timestamptz NOT NULL DEFAULT now(),
        reconciled_at timestamptz,
        receipt_id uuid NOT NULL,
        UNIQUE (business_id, receipt_id),
        FOREIGN KEY (connection_id, business_id)
          REFERENCES public.channel_connections(id, "businessId") ON DELETE RESTRICT
      );
      CREATE INDEX "IDX_wa_unmatched_status_lookup"
        ON public.whatsapp_unmatched_statuses(business_id, provider_message_id)
        WHERE reconciled_at IS NULL;
      ALTER TABLE public.whatsapp_unmatched_statuses ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.whatsapp_unmatched_statuses FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_whatsapp_unmatched_internal ON public.whatsapp_unmatched_statuses
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');
    `);
  }

  async down(runner: QueryRunner) {
    await runner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM public.whatsapp_outbound_messages)
           OR EXISTS (SELECT 1 FROM public.whatsapp_unmatched_statuses)
           OR EXISTS (SELECT 1 FROM public.whatsapp_response_intents WHERE status <> 'PENDING') THEN
          RAISE EXCEPTION 'Outbound or response history exists. Preserve the schema for rollback.';
        END IF;
      END $$;
      DROP TABLE public.whatsapp_unmatched_statuses;
      DROP TABLE public.whatsapp_outbound_messages;
      DROP INDEX public."UQ_outbox_tenant_id";
      DROP INDEX public."UQ_whatsapp_response_tenant_id";
      DROP INDEX public."UQ_channel_connections_tenant_id";
      DROP INDEX public."UQ_whatsapp_response_outbound";
      ALTER TABLE public.whatsapp_response_intents
        DROP COLUMN updated_at, DROP COLUMN outbound_message_id, DROP COLUMN response_text,
        DROP CONSTRAINT whatsapp_response_intents_status_check,
        ADD CONSTRAINT whatsapp_response_intents_status_check
          CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED'));
    `);
  }
}
