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

CI applies all migrations on a fresh PostgreSQL 16 service, reverts the latest two, and reapplies them. To exercise all three rollback steps locally, start with an empty disposable database.

```bash
npm run migration:run
npm run migration:revert
npm run migration:revert
npm run migration:revert
npm run migration:run
```

## Schema synchronization

TypeORM `synchronize` is disabled for both the application and migration CLI in every environment. Add and apply a migration for each schema change.

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
