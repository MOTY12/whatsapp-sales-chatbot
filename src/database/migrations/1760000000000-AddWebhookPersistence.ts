import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebhookPersistence1760000000000 implements MigrationInterface {
  name = 'AddWebhookPersistence1760000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "businesses" ALTER COLUMN "phoneNumberId" DROP NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE "businesses" ALTER COLUMN "accessToken" DROP NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "wabaId" character varying',
    );
    await queryRunner.query(
      'ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "displayPhoneNumber" character varying',
    );
    await queryRunner.query(
      'ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "connectedAt" TIMESTAMP',
    );
    await queryRunner.query(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "whatsappId" character varying',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_whatsappId" ON "users" ("whatsappId")',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_messages_whatsappMessageId" ON "messages" ("whatsappMessageId")',
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "onboarding_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "whatsappId" character varying NOT NULL,
        "step" character varying NOT NULL DEFAULT 'IDLE',
        "draftBusiness" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "profile" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "businessId" character varying,
        "ownerId" character varying,
        "connectionChoice" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_onboarding_sessions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_onboarding_sessions_whatsappId" ON "onboarding_sessions" ("whatsappId")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_onboarding_sessions_whatsappId"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "onboarding_sessions"');
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_messages_whatsappMessageId"',
    );
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_users_whatsappId"');
    await queryRunner.query(
      'ALTER TABLE "users" DROP COLUMN IF EXISTS "whatsappId"',
    );
    await queryRunner.query(
      'ALTER TABLE "businesses" DROP COLUMN IF EXISTS "connectedAt"',
    );
    await queryRunner.query(
      'ALTER TABLE "businesses" DROP COLUMN IF EXISTS "displayPhoneNumber"',
    );
    await queryRunner.query(
      'ALTER TABLE "businesses" DROP COLUMN IF EXISTS "wabaId"',
    );
  }
}
