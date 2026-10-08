import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1759999999999 implements MigrationInterface {
  name = 'InitialSchema1759999999999';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    await queryRunner.query(`
      CREATE TABLE "businesses" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "industry" character varying,
        "phone" character varying NOT NULL,
        "whatsappNumber" character varying NOT NULL,
        "phoneNumberId" character varying NOT NULL,
        "accessToken" text NOT NULL,
        "timezone" character varying,
        "status" character varying NOT NULL DEFAULT 'active',
        "config" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_businesses" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_businesses_whatsappNumber" ON "businesses" ("whatsappNumber")',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_businesses_phoneNumberId" ON "businesses" ("phoneNumberId")',
    );

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying NOT NULL,
        "password" character varying NOT NULL,
        "firstName" character varying NOT NULL,
        "lastName" character varying,
        "businessId" uuid NOT NULL,
        "status" character varying NOT NULL DEFAULT 'active',
        "roles" text NOT NULL DEFAULT 'user',
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "FK_users_business" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_users_businessId_email" ON "users" ("businessId", "email")',
    );

    await queryRunner.query(`
      CREATE TABLE "customers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "phone" character varying NOT NULL,
        "whatsappId" character varying NOT NULL,
        "email" character varying,
        "notes" text,
        "tags" text NOT NULL DEFAULT '',
        "source" character varying,
        "leadStage" character varying NOT NULL DEFAULT 'New Lead',
        "businessId" uuid NOT NULL,
        "ownerId" uuid,
        "totalOrders" integer NOT NULL DEFAULT 0,
        "lifetimeValue" numeric(12,2) NOT NULL DEFAULT 0,
        "lastInteraction" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_customers_business" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_customers_owner" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_customers_businessId_phone" ON "customers" ("businessId", "phone")',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_customers_businessId_whatsappId" ON "customers" ("businessId", "whatsappId")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_customers_businessId_leadStage" ON "customers" ("businessId", "leadStage")',
    );

    await queryRunner.query(`
      CREATE TABLE "conversations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "businessId" uuid NOT NULL,
        "customerId" uuid NOT NULL,
        "status" character varying,
        "summary" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_conversations_business" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_conversations_customer" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_conversations_businessId_customerId" ON "conversations" ("businessId", "customerId")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_conversations_businessId_createdAt" ON "conversations" ("businessId", "createdAt")',
    );

    await queryRunner.query(`
      CREATE TABLE "messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "conversationId" uuid NOT NULL,
        "businessId" uuid NOT NULL,
        "direction" character varying NOT NULL,
        "content" text NOT NULL,
        "status" character varying NOT NULL DEFAULT 'sent',
        "whatsappMessageId" character varying,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_messages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_messages_conversation" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_messages_conversationId_createdAt" ON "messages" ("conversationId", "createdAt")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_messages_businessId" ON "messages" ("businessId")',
    );

    await queryRunner.query(`
      CREATE TABLE "pipeline_stages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "businessId" character varying NOT NULL,
        "name" character varying NOT NULL,
        "order" integer NOT NULL DEFAULT 0,
        "color" character varying,
        "dealCount" integer NOT NULL DEFAULT 0,
        "totalValue" numeric(12,2) NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pipeline_stages" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_pipeline_stages_businessId_name" ON "pipeline_stages" ("businessId", "name")',
    );

    await queryRunner.query(`
      CREATE TABLE "follow_ups" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "businessId" uuid NOT NULL,
        "customerId" uuid NOT NULL,
        "ownerId" uuid,
        "dueDate" TIMESTAMP NOT NULL,
        "title" text NOT NULL,
        "description" text,
        "status" character varying NOT NULL DEFAULT 'pending',
        "suggestedMessage" text,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_follow_ups" PRIMARY KEY ("id"),
        CONSTRAINT "FK_follow_ups_business" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_follow_ups_customer" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_follow_ups_owner" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_follow_ups_businessId_status_dueDate" ON "follow_ups" ("businessId", "status", "dueDate")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_follow_ups_customerId_status" ON "follow_ups" ("customerId", "status")',
    );

    await queryRunner.query(`
      CREATE TABLE "tasks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "businessId" uuid NOT NULL,
        "ownerId" uuid,
        "title" character varying NOT NULL,
        "description" text,
        "dueDate" TIMESTAMP NOT NULL,
        "status" character varying NOT NULL DEFAULT 'pending',
        "priority" character varying NOT NULL DEFAULT 'medium',
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tasks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tasks_business" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_tasks_owner" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_tasks_businessId_status_dueDate" ON "tasks" ("businessId", "status", "dueDate")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_tasks_ownerId_status" ON "tasks" ("ownerId", "status")',
    );

    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "businessId" uuid NOT NULL,
        "userId" uuid,
        "entityType" character varying NOT NULL,
        "entityId" character varying NOT NULL,
        "action" character varying NOT NULL,
        "oldValue" jsonb,
        "newValue" jsonb,
        "reason" text,
        "ipAddress" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_audit_logs_business" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_audit_logs_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_audit_logs_businessId_createdAt" ON "audit_logs" ("businessId", "createdAt")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_audit_logs_userId_createdAt" ON "audit_logs" ("userId", "createdAt")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_audit_logs_entityType_entityId" ON "audit_logs" ("entityType", "entityId")',
    );

    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "businessId" character varying NOT NULL,
        "recipientPhone" character varying NOT NULL,
        "type" character varying NOT NULL,
        "title" text NOT NULL,
        "body" text NOT NULL,
        "status" character varying NOT NULL DEFAULT 'pending',
        "sentAt" TIMESTAMP,
        "readAt" TIMESTAMP,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notifications" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_notifications_businessId_status_createdAt" ON "notifications" ("businessId", "status", "createdAt")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_notifications_recipientPhone_status" ON "notifications" ("recipientPhone", "status")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "notifications"');
    await queryRunner.query('DROP TABLE IF EXISTS "audit_logs"');
    await queryRunner.query('DROP TABLE IF EXISTS "tasks"');
    await queryRunner.query('DROP TABLE IF EXISTS "follow_ups"');
    await queryRunner.query('DROP TABLE IF EXISTS "pipeline_stages"');
    await queryRunner.query('DROP TABLE IF EXISTS "messages"');
    await queryRunner.query('DROP TABLE IF EXISTS "conversations"');
    await queryRunner.query('DROP TABLE IF EXISTS "customers"');
    await queryRunner.query('DROP TABLE IF EXISTS "users"');
    await queryRunner.query('DROP TABLE IF EXISTS "businesses"');
  }
}
