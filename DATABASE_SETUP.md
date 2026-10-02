# Database setup

Kleva uses TypeORM with PostgreSQL. Schema changes go through migrations.

## Create the database

```bash
createdb -U postgres kleva_db
cp .env.example .env
```

Set `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, and `DATABASE_NAME` in `.env`.

## Run migrations

```bash
npm run migration:run
npm run migration:revert
```

`migration:run` applies:

1. `InitialSchema` — core tables for businesses, users, customers, conversations, messages, pipeline stages, follow-ups, tasks, audit logs, and notifications.
2. `AddWebhookPersistence` — WhatsApp connection columns, unique owner WhatsApp IDs, unique provider message IDs, and onboarding session storage.

To confirm a clean database in CI or locally:

```bash
npm run migration:run
npm run migration:revert
npm run migration:revert
npm run migration:run
```

## Development synchronize

When `NODE_ENV` is not `production`, TypeORM `synchronize` remains enabled so local entity edits can reach an existing database. Do not rely on synchronize in production. Always add a migration for schema changes.

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
