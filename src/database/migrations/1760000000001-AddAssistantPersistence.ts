import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssistantPersistence1760000000001 implements MigrationInterface {
  name = 'AddAssistantPersistence1760000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "sales" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "businessId" uuid NOT NULL,
        "customerId" uuid,
        "ownerId" uuid,
        "amount" numeric(12,2),
        "product" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sales" PRIMARY KEY ("id"),
        CONSTRAINT "FK_sales_business" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_sales_customer" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_sales_owner" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_sales_businessId_createdAt" ON "sales" ("businessId", "createdAt")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_sales_ownerId_createdAt" ON "sales" ("ownerId", "createdAt")',
    );
    await queryRunner.query(`
      CREATE TABLE "assistant_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "businessId" uuid NOT NULL,
        "ownerId" uuid NOT NULL,
        "flow" character varying NOT NULL,
        "step" integer NOT NULL DEFAULT 1,
        "draft" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_assistant_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_assistant_sessions_business" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_assistant_sessions_owner" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_assistant_sessions_businessId_ownerId" ON "assistant_sessions" ("businessId", "ownerId")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "assistant_sessions"');
    await queryRunner.query('DROP TABLE "sales"');
  }
}
