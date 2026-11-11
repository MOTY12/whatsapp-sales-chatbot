import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutboxOperations1760000000002 implements MigrationInterface {
  name = 'AddOutboxOperations1760000000002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE outbox_operations (
        id uuid PRIMARY KEY,
        "businessId" uuid,
        operation varchar(64) NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}',
        status varchar NOT NULL DEFAULT 'PENDING',
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        "dispatchFailures" integer NOT NULL DEFAULT 0 CHECK ("dispatchFailures" >= 0),
        "dueAt" timestamptz NOT NULL DEFAULT now(),
        "leaseToken" uuid,
        "lastError" varchar,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_outbox_operations_business" FOREIGN KEY ("businessId")
          REFERENCES businesses(id) ON DELETE CASCADE,
        CONSTRAINT "CHK_outbox_status" CHECK (status IN
          ('PENDING', 'CLAIMED', 'DISPATCHED', 'PROCESSING', 'RETRY_PENDING', 'COMPLETED', 'FAILED')),
        CONSTRAINT "CHK_outbox_lease" CHECK (
          (status IN ('CLAIMED', 'PROCESSING')) = ("leaseToken" IS NOT NULL)
        ),
        CONSTRAINT "CHK_outbox_error" CHECK ("lastError" IN
          ('REDIS_UNAVAILABLE', 'EXECUTION_LEASE_EXPIRED', 'HANDLER_FAILED', 'UNREGISTERED_OPERATION'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_outbox_due" ON outbox_operations ("dueAt", id)
      WHERE status NOT IN ('COMPLETED', 'FAILED')
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_outbox_business" ON outbox_operations ("businessId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE outbox_operations');
  }
}
