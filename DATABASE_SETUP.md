# Database setup

Kleva uses TypeORM with PostgreSQL. Schema changes go through migrations.

## Create the database

```bash
createdb -U postgres kleva_db
cp .env.example .env
```

Set `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, and `DATABASE_NAME` in `.env`. The database role needs permission to create tables in the target schema. It also needs permission to enable the `uuid-ossp` extension if the extension is absent. Set `DATABASE_NAME` explicitly so the application and migration CLI use the same database.

## Run migrations

```bash
npm run migration:run
npm run migration:revert
```

`migration:run` applies:

1. `InitialSchema` — core tables for businesses, users, customers, conversations, messages, pipeline stages, follow-ups, tasks, audit logs, and notifications.
2. `AddWebhookPersistence` — WhatsApp connection columns, unique owner WhatsApp IDs, unique provider message IDs, and onboarding session storage.
3. `AddAssistantPersistence` — persisted sales and assistant command sessions.
4. `AddOutboxOperations` — durable job intent, status, lease and retry tracking.
5. `AddTenantIntegrity` — account and membership tables, legacy membership backfill, and same-business foreign keys.
6. `AddMerchantAuth` — merchant sessions, login attempts, scoped SQL functions, and forced row-level security.

CI applies, reverts, and reapplies all migrations in disposable databases on PostgreSQL 16. To run the same checks locally, use the integration suite below. For manual CLI verification, start with an empty disposable database.

```bash
npm run migration:run
npm run migration:revert
npm run migration:revert
npm run migration:revert
npm run migration:revert
npm run migration:revert
npm run migration:revert
npm run migration:run
```

## Membership and tenant integrity upgrade

Run the preflight on a backup or staging copy with the first four migrations applied before scheduling a populated upgrade.

```bash
npm run tenant:preflight
```

The command prints issue names, counts and blocking flags. It exits nonzero for blocking findings. It does not print customer content, phone numbers, emails, or row IDs. The migration reruns the checks while holding write locks and rolls back if it finds a blocker. Budget a maintenance window for validation, index creation, and the conversion of text business IDs on notifications, pipeline stages and onboarding sessions, plus the onboarding owner ID, to UUID. Use a transactional TypeORM migration and pause writers before deployment.

- For `missing_or_invalid` or `cross_tenant` findings, inspect the reported table and column using a restricted database session. For example, locate customer-owner mismatches by joining `customers."ownerId"` to `users.id` and comparing their `"businessId"` values. Review IDs against trusted business records. Fix a confirmed incorrect link or clear an optional link only with documented approval. Keep unresolved rows intact and defer the migration.
- For multiple active legacy owners, unresolved owner hints, or onboarding sender mismatches, confirm the intended association with a verified operator before correcting any owner role or link. Re-run preflight and apply the migration only when all blocking counts clear.
- Multiple open threads for a business/customer are advisory. Existing threads and IDs are preserved. Open-thread uniqueness belongs to the later conversation cutover.

Each legacy user gets one membership tied to their existing business and user ID. Explicit legacy owners map to `owner` and other legacy users to `staff`. Memberships start unclaimed, with neither an account link nor a verified WhatsApp binding. The legacy user trigger creates memberships for new users and keeps role and status synchronized while the membership is unclaimed. If deployment roles use explicit grants, grant legacy user writers `SELECT`, `INSERT`, and `UPDATE` on `business_members` before resuming writes. Account linkage requires a future verified claim. The migration uses no phone or synthetic email as proof of identity.

The foreign keys enforce matching business IDs across conversation and message, customer and owner, follow-up, task, sale, audit, assistant, and onboarding relationships. Existing nullable CRM references still clear when their parent is deleted. Deleting a legacy user cascades to the membership tied to that legacy user. These constraints protect persisted links. Merchant read isolation is described in the next section.

Reverting removes the membership schema and restores the original text column types while preserving legacy row IDs. A revert is blocked once account data exists. Reverting before account creation discards generated membership IDs and any membership-only changes. Prefer a forward migration after identity rollout. Older application binaries can still use the legacy IDs, but use the TENANT-001 build or newer for lead capture so senders linked to another business are left unassigned.

## Merchant database roles and RLS

After applying the migrations, use the database administrator to provision two dedicated login roles. The names must start with `kleva_merchant_` and `kleva_identity_` respectively. The API validates both logins and rejects roles with elevated privileges, role memberships, schema creation privileges, or database or table ownership. Use separate secrets for each login and for the legacy runtime.

```sql
CREATE ROLE kleva_merchant_app LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
CREATE ROLE kleva_identity_app LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE kleva_db TO kleva_merchant_app, kleva_identity_app;
GRANT USAGE ON SCHEMA public TO kleva_merchant_app, kleva_identity_app;
```

Set each password through your database administrator or the interactive `psql` command `\password`. Run `npm run auth:grant` with the migration-owner database settings and both role names in `MERCHANT_DATABASE_USER` and `IDENTITY_DATABASE_USER`. Run the API with its normal legacy runtime credentials and the two new role credentials in the corresponding `*_DATABASE_PASSWORD` settings.

- The identity pool can create and consume login attempts and issue sessions after OIDC verification. Its database role has no business-table reads.
- The merchant pool can resolve and revoke its sessions and list their memberships. It cannot issue sessions. Its table grants cover only selected business and membership columns. The scoped transaction sets both business ID and session digest transaction-locally on its manager. RLS checks the current session, active business, and active role on each scoped query.
- RLS is enabled and forced on the tenant tables. Merchant policies allow only the business profile and the caller's own membership within the authorized scope. CRM, conversations, messages, outbox and other legacy tables have no merchant grants or exposure. The legacy runtime policy preserves existing webhook and worker access. Keep those credentials separate from merchant code paths.
- Expired rows are inaccessible. The migration owner can periodically delete expired rows from `merchant_login_attempts` and `merchant_sessions`. Reverting this migration removes session and login state, ends active merchant sessions, and removes the installed policies and business-column grants. Disable merchant auth before reverting.

## Schema synchronization

TypeORM `synchronize` is disabled for both the application and migration CLI in every environment. Add and apply a migration for each schema change.

## Database TLS

The Nest API and TypeORM CLI share the same PostgreSQL configuration. The CLI validates the database settings independently of the Meta and HTTP settings. `DATABASE_PORT` defaults to 5432.

Production requires TLS and a trusted CA bundle in `DATABASE_SSL_CA`. Supply PEM certificates with literal newlines or escaped `\n` sequences. Set `DATABASE_HOST` to a DNS name or IP address covered by the server certificate. The connection verifies the certificate chain and the configured hostname or IP. It rejects `DATABASE_SSL=false` and `DATABASE_SSL_REJECT_UNAUTHORIZED=false` in production. In development and tests, TLS defaults to disabled and can be enabled for a TLS-capable database.

## PostgreSQL integration tests

Use a dedicated local PostgreSQL 16 instance and OpenSSL to generate a temporary certificate for the TLS tests. For example, start this disposable instance in one terminal and stop it with Ctrl+C after testing.

```bash
docker run --rm -p 127.0.0.1:55432:5432 \
  -e POSTGRES_DB=kleva_integration_control \
  -e POSTGRES_USER=kleva_integration_admin \
  -e POSTGRES_PASSWORD=local-integration-only \
  postgres:16
```

Start a disposable Redis instance in another terminal.

```bash
docker run --rm -p 127.0.0.1:56379:6379 redis:7-alpine
```

When both services accept connections, run the suite from a third terminal.

```bash
NODE_ENV=test \
  KLEVA_TEST_PG_HOST=127.0.0.1 \
  KLEVA_TEST_PG_PORT=55432 \
  KLEVA_TEST_PG_DATABASE=kleva_integration_control \
  KLEVA_TEST_PG_USER=kleva_integration_admin \
  KLEVA_TEST_PG_PASSWORD=local-integration-only \
  KLEVA_TEST_REDIS_URL=redis://127.0.0.1:56379 \
  npm run test:integration
```

The harness accepts a loopback address of `127.0.0.1` or a local Unix socket directory. It requires the dedicated control database and explicit credentials. The provisioning account must be able to create databases and login roles. Each run creates uniquely named databases from `template0` and removes them after use. A migration role owns the tables and a separate runtime role has CRUD privileges on the application tables. The suite uses the CLI's registered entities and migrations and ignores the application's database connection settings. It rejects production mode and an application database name reserved for integration tests.

The seeded upgrade uses records from the initial migration. If historical messages share a non-null provider ID, `AddWebhookPersistence` fails while creating the unique index. Review and reconcile those duplicate records before retrying a real upgrade. Reverting that migration leaves the relaxed WhatsApp connection column nullability in place.

## Tables

- `businesses`
- `users`
- `customers`
- `conversations`
- `messages`
- `pipeline_stages`
- `follow_ups`
- `tasks`
- `audit_logs`
- `notifications`
- `onboarding_sessions`
- `sales`
- `assistant_sessions`
- `outbox_operations`
- `accounts`
- `business_members`
- `merchant_login_attempts`
- `merchant_sessions`
