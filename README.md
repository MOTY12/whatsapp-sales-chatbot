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

`NODE_ENV` accepts `development` (default), `test`, or `production`. `PORT` defaults to 3000 and `LOG_LEVEL` defaults to `log`. The HTTP process and migration CLI use PostgreSQL. Redis is used by the separate worker, and OpenAI settings are optional.

For production, use `NODE_ENV=production`, `DATABASE_SSL=true`, and `DATABASE_SSL_CA` containing the trusted PostgreSQL CA bundle in PEM format. Use a `DATABASE_HOST` covered by the server certificate. Production also requires non-placeholder Meta credentials, an HTTPS callback, and the webhook verify token. Its Graph origin is fixed to `https://graph.facebook.com`. Local PostgreSQL can use `DATABASE_SSL=false`. See the [database TLS configuration](DATABASE_SETUP.md#database-tls) for details.

`WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are a development fallback. Connected businesses use the Meta access token and phone-number ID stored on the business record.

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

Migrations create the baseline schema, webhook and onboarding persistence, assistant persistence, and the background job outbox.

TypeORM synchronization is disabled in every environment. Run migrations before starting the application whenever the schema changes.

See `DATABASE_SETUP.md` for PostgreSQL details.

## Merchant sign-in

Register a confidential OIDC client with Authorization Code, S256 PKCE, `client_secret_basic`, and RS256 ID tokens. Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and the exact `OIDC_REDIRECT_URI` ending in `/auth/callback`. Register that same URI with the provider. Use HTTPS in production and loopback HTTP for local development. Set the two dedicated database credentials after applying migrations and grants. Leaving all merchant settings empty disables merchant auth. [Database role setup](DATABASE_SETUP.md#merchant-database-roles-and-rls)

- `GET /auth/login` starts sign-in. `GET /auth/callback` consumes the browser-bound attempt and redirects to `/auth/me`.
- `GET /auth/me` returns the account ID and active memberships. `GET /auth/businesses` lists those memberships. `GET /auth/businesses/:businessId` checks current membership and permissions before returning a minimal business profile.
- `POST /auth/logout` revokes the session. Send the configured callback origin in `Origin` and the value of the CSRF cookie in `X-CSRF-Token`. HTTPS cookie names have the `__Host-` prefix. The CSRF cookie is readable by same-origin code. The session and login binding cookies are HttpOnly and all use SameSite=Lax.
- Sessions last eight hours and rotate on successful sign-in. Login attempts expire after ten minutes and can be consumed once. PostgreSQL stores session and CSRF digests. Provider tokens stay out of cookies and responses.

| Role | Business profile | Team management permission | Knowledge permission | Inbox permission |
| --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Yes |
| Editor | Yes | | Yes | |
| Agent | Yes | | | Yes |
| Legacy staff | | | | |

The permission helper defines team, knowledge and inbox access for later feature routes. Staff can see their own membership list. Signing in creates an issuer/subject account and does not claim a legacy membership.

## Workers

Apply the database migrations, then start the worker separately. The migration command also builds the application.

```bash
npm run migration:run
npm run start:worker
```

The worker uses the shared PostgreSQL configuration and Redis 7 or newer. Set `REDIS_URL` or `REDIS_HOST`, `REDIS_PORT`, and optional `REDIS_PASSWORD`. `REDIS_URL` takes precedence and accepts `rediss://` for verified TLS. Use a distinct `JOBS_QUEUE_PREFIX` for each deployment and share it across that deployment's worker replicas. The default prefix is `kleva-<NODE_ENV>`. `JOBS_CONCURRENCY` defaults to 4 per worker.

The relay polls PostgreSQL every second. A job contains only the outbox operation ID, and the Redis job ID combines that ID with the execution attempt. PostgreSQL retries failed dispatches with backoff and recovers expired leases and missing Redis jobs. Handler failures retry up to five execution attempts before the operation is marked `FAILED`. The worker drains active handlers on SIGINT or SIGTERM. Run `node dist/worker.js` directly if your process manager signals only its immediate child.

Feature modules can write an intent through `OutboxStore.write` inside their TypeORM transaction. Use a stable UUID per logical operation and put only UUID references in metadata. Register the operation's handler in the worker. PostgreSQL effects performed through the supplied transaction manager commit together with the completion marker. Keep those transactions short. External calls need their own idempotency or reconciliation. This release ships the infrastructure with an empty feature handler registry. WhatsApp webhooks still run through the HTTP process.

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

The HTTP test suite exercises `GET /` and the positive and negative WhatsApp subscription challenge using a stubbed WhatsApp service. CI also runs `npm run test:integration` against PostgreSQL 16 and Redis to verify migrations, repository behavior, TLS, health endpoints, outbox recovery, and merchant OIDC and RLS. See the [integration database setup](DATABASE_SETUP.md#postgresql-integration-tests) to run it locally.

## Health and logs

- `GET /health/live` returns HTTP 200 with `{"status":"ok"}` when the HTTP process is serving.
- `GET /health/ready` checks PostgreSQL within one second. It returns HTTP 200 with `{"status":"ok"}` when the probe succeeds and HTTP 503 with `{"status":"unavailable"}` otherwise.
- Responses include `X-Request-Id`. The API keeps a supplied UUID or generates one. Request logs record the ID, method, status, and duration. They omit paths, query strings, headers, and payloads.
- `DATABASE_LOGGING=true` emits database query events without SQL text or parameters. Database and provider failures log safe metadata without raw errors.

## MVP boundary

No web dashboard, payments, inventory, broadcasts, public CRM API, or OpenAI integration are included. Assistant CRM, follow-ups, sales, and multi-step command state are persisted in PostgreSQL.
