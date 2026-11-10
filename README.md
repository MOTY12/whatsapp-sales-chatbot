# Kleva WhatsApp Sales Assistant

Kleva is a NestJS and PostgreSQL backend for WhatsApp business onboarding, inbound lead capture, and owner-facing assistant commands. WhatsApp is the product interface. This repository does not include a customer dashboard.

## Local setup

Use Node.js 22 and PostgreSQL 16 to match CI.

```bash
npm ci
cp .env.example .env
createdb -U postgres kleva_db
# Set the database and Meta boot settings below in .env.
npm run migration:run
npm run start:dev
```

The API listens on `PORT` (default 3000). Configure the database before running migrations. The HTTP app also loads the Meta Embedded Signup service at boot.

Required for local boot:

- PostgreSQL connection settings (`DATABASE_HOST`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`)
- Non-empty Meta settings (`META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `WHATSAPP_BUSINESS_CONFIG_ID`, `WHATSAPP_API_VERSION`)

Set `DATABASE_PORT` if PostgreSQL uses a port other than 5432. The example Meta values suffice for local boot and a smoke check of `GET /`. Before connecting Meta, configure real Meta app credentials and a public HTTPS callback, and set `WHATSAPP_VERIFY_TOKEN` to match the webhook subscription.

`WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are a development fallback. Connected businesses use the Meta access token and phone-number ID stored on the business record.

Redis and OpenAI variables are listed for later milestones. Milestone 0 does not start a worker process and does not call OpenAI.

## Webhook configuration

Set Meta's callback URL to `https://your-public-url/webhooks/whatsapp`.

- GET uses `WHATSAPP_VERIFY_TOKEN` for the subscription challenge.
- POST requires `X-Hub-Signature-256`. Kleva verifies it against `META_APP_SECRET` using the unmodified raw request body (`rawBody: true` in `src/main.ts`).

Inbound customer text events are resolved by Meta `phone_number_id`. PostgreSQL enforces unique provider IDs for stored messages. Owner commands currently take a separate path before message insertion.

## Database and migrations

```bash
npm run migration:run
npm run migration:revert
```

Migrations create the baseline schema, webhook/onboarding persistence fields, and Milestone 1 assistant persistence (`sales` and `assistant_sessions`).

TypeORM synchronization is disabled in every environment. Run migrations before starting the application whenever the schema changes.

See `DATABASE_SETUP.md` for PostgreSQL details.

## Workers

BullMQ/Redis workers for follow-ups and the daily brief are not implemented yet. Do not start a separate worker process. `npm run start:dev` runs the HTTP application only.

## Scripts

```bash
npm run start:dev
npm run build
npm run lint:check
npm test -- --runInBand
npm run test:e2e
npm run migration:run
```

The HTTP test suite exercises `GET /` and the positive and negative WhatsApp subscription challenge using a stubbed WhatsApp service. CI runs the migration check separately against PostgreSQL.

## MVP boundary

No web dashboard, payments, inventory, broadcasts, public CRM API, background workers, or OpenAI integration are included. Assistant CRM, follow-ups, sales, and multi-step command state are persisted in PostgreSQL.
