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

CI applies, reverts, and reapplies all migrations in disposable databases on PostgreSQL 16. To run the same checks locally, use the integration suite below. For manual CLI verification, start with an empty disposable database.

```bash
npm run migration:run
npm run migration:revert
npm run migration:revert
npm run migration:revert
npm run migration:run
```

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

When PostgreSQL accepts connections, run the suite from another terminal.

```bash
NODE_ENV=test \
  KLEVA_TEST_PG_HOST=127.0.0.1 \
  KLEVA_TEST_PG_PORT=55432 \
  KLEVA_TEST_PG_DATABASE=kleva_integration_control \
  KLEVA_TEST_PG_USER=kleva_integration_admin \
  KLEVA_TEST_PG_PASSWORD=local-integration-only \
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
