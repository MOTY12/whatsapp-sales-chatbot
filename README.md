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

Set `DATABASE_PORT` if PostgreSQL uses a port other than 5432. The API and migration CLI use the same database settings. The CLI only requires the database settings. The example Meta values suffice for local boot and a smoke check of `GET /`. Before connecting Meta, configure real Meta app credentials and a public HTTPS callback, and set `WHATSAPP_VERIFY_TOKEN` to match the webhook subscription.

`NODE_ENV` accepts `development` (default), `test`, or `production`. `PORT` defaults to 3000 and `LOG_LEVEL` defaults to `log`. Redis and OpenAI settings are optional and no connections are opened to those services at startup.

For production, use `NODE_ENV=production`, `DATABASE_SSL=true`, and `DATABASE_SSL_CA` containing the trusted PostgreSQL CA bundle in PEM format. Use a `DATABASE_HOST` covered by the server certificate. Production also requires non-placeholder Meta credentials, an HTTPS callback, and the webhook verify token. Its Graph origin is fixed to `https://graph.facebook.com`. Local PostgreSQL can use `DATABASE_SSL=false`. See the [database TLS configuration](DATABASE_SETUP.md#database-tls) for details.

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
npm run test:integration
npm run migration:run
```

The HTTP test suite exercises `GET /` and the positive and negative WhatsApp subscription challenge using a stubbed WhatsApp service. CI also runs `npm run test:integration` against PostgreSQL 16 to verify migrations, repository behavior, database TLS, and health endpoints. See the [integration database setup](DATABASE_SETUP.md#postgresql-integration-tests) to run it locally.

## Health and logs

- `GET /health/live` returns HTTP 200 with `{"status":"ok"}` when the HTTP process is serving.
- `GET /health/ready` checks PostgreSQL within one second. It returns HTTP 200 with `{"status":"ok"}` when the probe succeeds and HTTP 503 with `{"status":"unavailable"}` otherwise.
- Responses include `X-Request-Id`. The API keeps a supplied UUID or generates one. Request logs record the ID, method, status, and duration. They omit paths, query strings, headers, and payloads.
- `DATABASE_LOGGING=true` emits database query events without SQL text or parameters. Database and provider failures log safe metadata without raw errors.

## MVP boundary

No web dashboard, payments, inventory, broadcasts, public CRM API, background workers, or OpenAI integration are included. Assistant CRM, follow-ups, sales, and multi-step command state are persisted in PostgreSQL.
