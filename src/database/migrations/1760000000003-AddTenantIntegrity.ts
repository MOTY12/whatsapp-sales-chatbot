import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  inspectTenantIntegrity,
  newBusinessLinks,
  TenantIntegrityError,
  tenantLinks,
  tenantTables,
} from '../tenant-integrity';

const parentTables = ['users', 'customers', 'conversations'] as const;
const textBusinessIds = [
  'notifications',
  'onboarding_sessions',
  'pipeline_stages',
] as const;

function linkName(child: string, column: string) {
  return `${child}_${column}_tenant`;
}

export class AddTenantIntegrity1760000000003 implements MigrationInterface {
  name = 'AddTenantIntegrity1760000000003';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("SET LOCAL lock_timeout = '5s'");
    // Lock writers before checking legacy data so nothing can slip between the
    // preflight and the constraints. Run inside the migration transaction.
    await queryRunner.query(
      `LOCK TABLE businesses, ${tenantTables.join(', ')} IN SHARE ROW EXCLUSIVE MODE`,
    );
    const findings = await inspectTenantIntegrity(queryRunner);
    if (findings.some(({ blocking }) => blocking))
      throw new TenantIntegrityError(findings);

    for (const table of textBusinessIds) {
      await queryRunner.query(
        `ALTER TABLE ${table} ALTER COLUMN "businessId" TYPE uuid USING "businessId"::uuid`,
      );
    }
    await queryRunner.query(
      'ALTER TABLE onboarding_sessions ALTER COLUMN "ownerId" TYPE uuid USING "ownerId"::uuid',
    );

    for (const table of parentTables) {
      await queryRunner.query(
        `ALTER TABLE ${table} ADD CONSTRAINT "UQ_${table}_tenant_id" UNIQUE ("businessId", id)`,
      );
    }
    for (const { child, column, parent, onDelete } of tenantLinks) {
      const name = linkName(child, column);
      if (child !== 'conversations' && child !== 'assistant_sessions') {
        await queryRunner.query(
          `CREATE INDEX "IDX_${name}" ON ${child} ("businessId", "${column}")`,
        );
      }
      await queryRunner.query(`
        ALTER TABLE ${child} ADD CONSTRAINT "FK_${name}"
          FOREIGN KEY ("businessId", "${column}") REFERENCES ${parent} ("businessId", id)
          ON DELETE ${onDelete} NOT VALID
      `);
    }
    for (const table of newBusinessLinks) {
      await queryRunner.query(`
        ALTER TABLE ${table} ADD CONSTRAINT "FK_${table}_tenant_business"
          FOREIGN KEY ("businessId") REFERENCES businesses(id) ON DELETE CASCADE NOT VALID
      `);
    }
    await queryRunner.query(`
      ALTER TABLE onboarding_sessions
        ADD CONSTRAINT "CHK_onboarding_owner_requires_business"
        CHECK ("ownerId" IS NULL OR "businessId" IS NOT NULL) NOT VALID
    `);
    for (const { child, column } of tenantLinks) {
      await queryRunner.query(
        `ALTER TABLE ${child} VALIDATE CONSTRAINT "FK_${linkName(child, column)}"`,
      );
    }
    for (const table of newBusinessLinks) {
      await queryRunner.query(
        `ALTER TABLE ${table} VALIDATE CONSTRAINT "FK_${table}_tenant_business"`,
      );
    }
    await queryRunner.query(
      'ALTER TABLE onboarding_sessions VALIDATE CONSTRAINT "CHK_onboarding_owner_requires_business"',
    );

    await queryRunner.query(`
      CREATE TABLE accounts (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        issuer varchar NOT NULL CHECK (btrim(issuer) <> ''),
        subject varchar NOT NULL CHECK (btrim(subject) <> ''),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_accounts_issuer_subject" UNIQUE (issuer, subject)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE business_members (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "businessId" uuid NOT NULL,
        "accountId" uuid,
        "legacyUserId" uuid,
        role varchar NOT NULL CHECK (role IN ('owner', 'staff', 'editor', 'agent')),
        status varchar NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        "verifiedWhatsappId" varchar,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_business_members_account" UNIQUE ("businessId", "accountId"),
        CONSTRAINT "UQ_business_members_legacy_user" UNIQUE ("legacyUserId"),
        CONSTRAINT "UQ_business_members_whatsapp" UNIQUE ("businessId", "verifiedWhatsappId"),
        CONSTRAINT "CHK_members_identity" CHECK ("accountId" IS NOT NULL OR "legacyUserId" IS NOT NULL),
        CONSTRAINT "CHK_members_whatsapp_claim" CHECK ("verifiedWhatsappId" IS NULL OR "accountId" IS NOT NULL),
        CONSTRAINT "FK_members_business" FOREIGN KEY ("businessId") REFERENCES businesses(id) ON DELETE CASCADE,
        CONSTRAINT "FK_members_account" FOREIGN KEY ("accountId") REFERENCES accounts(id) ON DELETE RESTRICT,
        CONSTRAINT "FK_members_legacy_tenant" FOREIGN KEY ("businessId", "legacyUserId")
          REFERENCES users ("businessId", id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_members_account" ON business_members ("accountId")',
    );
    await queryRunner.query(`
      INSERT INTO business_members ("businessId", "legacyUserId", role, status)
      SELECT "businessId", id,
        CASE WHEN 'owner' = ANY(string_to_array(roles, ',')) THEN 'owner' ELSE 'staff' END,
        CASE WHEN status = 'active' THEN 'active' ELSE 'inactive' END
      FROM users ON CONFLICT ("legacyUserId") DO NOTHING
    `);
    await queryRunner.query(`
      CREATE FUNCTION sync_unclaimed_legacy_member() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO business_members ("businessId", "legacyUserId", role, status)
        VALUES (
          NEW."businessId", NEW.id,
          CASE WHEN 'owner' = ANY(string_to_array(NEW.roles, ',')) THEN 'owner' ELSE 'staff' END,
          CASE WHEN NEW.status = 'active' THEN 'active' ELSE 'inactive' END
        )
        ON CONFLICT ("legacyUserId") DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status
        WHERE business_members."accountId" IS NULL;
        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER sync_unclaimed_legacy_member
      AFTER INSERT OR UPDATE OF roles, status ON users
      FOR EACH ROW EXECUTE FUNCTION sync_unclaimed_legacy_member()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'LOCK TABLE accounts, business_members IN SHARE ROW EXCLUSIVE MODE',
    );
    const [linked] = (await queryRunner.query(`
      SELECT EXISTS (SELECT 1 FROM accounts) OR EXISTS (
        SELECT 1 FROM business_members WHERE "accountId" IS NOT NULL
      ) AS present
    `)) as { present: boolean }[];
    if (linked.present) {
      throw new Error(
        'Tenant integrity rollback blocked because account data exists.',
      );
    }
    await queryRunner.query(
      'DROP TRIGGER sync_unclaimed_legacy_member ON users',
    );
    await queryRunner.query('DROP FUNCTION sync_unclaimed_legacy_member()');
    await queryRunner.query('DROP TABLE business_members, accounts');
    await queryRunner.query(
      'ALTER TABLE onboarding_sessions DROP CONSTRAINT "CHK_onboarding_owner_requires_business"',
    );
    for (const table of newBusinessLinks) {
      await queryRunner.query(
        `ALTER TABLE ${table} DROP CONSTRAINT "FK_${table}_tenant_business"`,
      );
    }
    for (const { child, column } of tenantLinks) {
      const name = linkName(child, column);
      await queryRunner.query(
        `ALTER TABLE ${child} DROP CONSTRAINT "FK_${name}"`,
      );
      if (child !== 'conversations' && child !== 'assistant_sessions') {
        await queryRunner.query(`DROP INDEX "IDX_${name}"`);
      }
    }
    for (const table of parentTables) {
      await queryRunner.query(
        `ALTER TABLE ${table} DROP CONSTRAINT "UQ_${table}_tenant_id"`,
      );
    }
    for (const table of textBusinessIds) {
      await queryRunner.query(
        `ALTER TABLE ${table} ALTER COLUMN "businessId" TYPE varchar USING "businessId"::varchar`,
      );
    }
    await queryRunner.query(
      'ALTER TABLE onboarding_sessions ALTER COLUMN "ownerId" TYPE varchar USING "ownerId"::varchar',
    );
  }
}
