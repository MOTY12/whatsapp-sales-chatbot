# Kleva Merchant WhatsApp Sales Assistant

Kleva is a tenant-isolated merchant SaaS application. The NestJS API handles merchant identity, business and channel access, knowledge, conversations, leads, metering, and signed Meta webhooks. PostgreSQL is the durable system of record; the outbox relay dispatches work to BullMQ/Redis; a separate worker handles WhatsApp receipts, AI responses, outbound messages, and merchant email. The Next.js merchant dashboard provides onboarding, WhatsApp connection, products, FAQs, leads, and a conversation inbox.

## Local prerequisites

- Node.js 22
- PostgreSQL 16 with the extensions required by the migrations
- Redis 7+
- A publicly reachable HTTPS URL for real Meta webhook and Embedded Signup tests

Install dependencies and configure the backend from the safe template:

```bash
npm ci
cp .env.example .env
```

Fill in local PostgreSQL settings, then apply migrations and provision the restricted merchant/identity database logins as described in [DATABASE_SETUP.md](DATABASE_SETUP.md):

```bash
npm run migration:run
npm run auth:grant
```

The migration connection must own the schema and have permission to create/alter schema objects. The HTTP API uses PostgreSQL. Redis is required by the separate worker, not by migrations or unrelated CLI commands.

## Start the application

Run three processes in separate terminals:

```bash
npm run start:dev
npm run start:worker
npm run dashboard:dev
```

Nest listens on `PORT` (default `3000`), the worker polls the PostgreSQL outbox and consumes BullMQ jobs, and Next.js serves the dashboard at `http://localhost:3001` by default. Configure the dashboard server environment in `apps/merchant-dashboard/.env.local`:

```dotenv
KLEVA_BACKEND_ORIGIN=http://localhost:3000
DASHBOARD_PUBLIC_ORIGIN=http://localhost:3001
```

Set the same `DASHBOARD_PUBLIC_ORIGIN` in the backend `.env`. For simultaneous localhost and HTTPS-tunnel use, list each exact origin in `DASHBOARD_ALLOWED_ORIGINS` in both environments; never use a wildcard. The Next server calls Nest through `KLEVA_BACKEND_ORIGIN`; browser requests use same-origin dashboard routes. See [the dashboard guide](apps/merchant-dashboard/README.md).

## Merchant setup and first pilot

1. Register or sign in using the enabled merchant authentication method. Google OIDC needs a registered client and exact callback URI; email/password additionally requires `EMAIL_AUTH_ENABLED=true` and configured Mailjet credentials and sender. Keep provider secrets server-side.
2. Create a business and complete its profile.
3. On `/dashboard/whatsapp`, start the official Meta Embedded Signup flow. Kleva exchanges the returned code server-side, verifies the WABA and phone number, subscribes the app, registers the phone when required, encrypts the token, and only then reports the connection active. Configure the Meta app, approved permissions, Embedded Signup configuration, HTTPS webhook URL `/webhooks/whatsapp`, and `WHATSAPP_VERIFY_TOKEN` before attempting a live connection. Details: [WhatsApp connection setup](docs/kleva-mvp-30d/whatsapp-connection-api.md).
4. Publish at least one FAQ or product in the dashboard. Draft and unpublished revisions are excluded from customer retrieval. Set product price, currency and availability only to merchant-confirmed values.
5. An authorized business owner requests activation in the WhatsApp page and accepts both pilot disclosures. The request remains `PENDING_REVIEW`; it does not enable AI.
6. A separately provisioned platform operator reviews the release evidence and activates the pending connection using the scoped operator CLI described below. Set `AI_RESPONSES_ENABLED=true` and the AI provider key only in the approved worker runtime after all pilot gates are met. The dashboard lists each readiness prerequisite and never claims readiness from client-side state.
7. Have a customer message the connected number within the WhatsApp service window. The signed webhook stores a durable receipt; the worker creates/reuses the tenant customer and conversation, stores the inbound message, captures a lead, retrieves published tenant knowledge, validates a grounded response, and queues a single idempotent outbound send. View messages, delivery status and the associated lead in the merchant dashboard inbox. An owner/agent can take over; queued automation is fenced from sending after takeover.

### Controlled operator pilot approval

Pilot activation is deliberately separate from the merchant API. Apply the migration, create an individual, least-privilege PostgreSQL login named `kleva_pilot_operator_<operator>`, and grant only the activation function:

```sql
CREATE ROLE kleva_pilot_operator_alice LOGIN NOINHERIT PASSWORD 'managed-outside-source-control';
```

Set `PILOT_OPERATOR_DATABASE_USER` to that role while connected with the migration-owner credentials, then run:

```bash
npm run pilot:grant-operator
```

After release review and merchant consent, run the approval command from a secured operator shell with that operator role's credentials supplied as `PILOT_OPERATOR_DATABASE_USER` and `PILOT_OPERATOR_DATABASE_PASSWORD`:

```bash
npm run pilot:approve -- <pending-enrollment-uuid> <approval-ticket-reference>
```

The function activates only a pending enrollment whose business and exact WhatsApp connection are active and verified. It records PostgreSQL `session_user` and the evidence reference, and does not expose a public activation endpoint. Keep these operator credentials out of the API, dashboard and worker environments. An owner can revoke activation from the dashboard.

## Background jobs and delivery

The worker registers these durable operations: `whatsapp.receipt`, `whatsapp.ai_response`, WhatsApp response intents, `whatsapp.outbound`, and `merchant.email`. Job payloads contain database references, not customer content. PostgreSQL leases and idempotency keys recover dispatch after Redis loss or process restart. Handler failures retry with bounded attempts and safe error classifications; terminal operations are marked `FAILED`. External WhatsApp effects that time out are recorded as `UNCERTAIN` for reconciliation instead of being blindly resent. Delivery webhooks update message and outbound states monotonically.

Configure `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT`; `JOBS_QUEUE_PREFIX` must be shared by worker replicas in one deployment and distinct across environments. `JOBS_CONCURRENCY` is per worker. Run migrations without requiring Redis.

## Configuration

Use [.env.example](.env.example) as the backend variable reference. It contains placeholders only. Important groups are:

- PostgreSQL and restricted merchant/identity roles
- Redis/BullMQ
- Meta App ID/secret, Embedded Signup configuration ID, webhook verification token and Graph API version
- encrypted WhatsApp credential keyring
- `AI_RESPONSES_ENABLED` (false by default), AI model and worker-only provider key
- Merchant OIDC or optional Mailjet email authentication
- dashboard public origin and exact additional development origins
- operator-only database credentials for the manual approval CLI (do not copy these into application runtime environments)

Never commit real credentials. Set the dashboard's private backend URL only in `apps/merchant-dashboard/.env.local`; see its README for details. Production requires TLS for PostgreSQL, HTTPS dashboard/callback origins, a production Meta Graph origin, and provider/legal/security release approval.

## Tests and verification

```bash
npm run build
npm run lint:check
npm test
npm run test:integration
npm run test:e2e
npm run dashboard:typecheck
npm run dashboard:build
npm run dashboard:test
npm run dashboard:test:browser
```

PostgreSQL integration tests require the dedicated disposable local `kleva_integration_control` database and `KLEVA_TEST_PG_*` settings; suites that exercise BullMQ additionally require `KLEVA_TEST_REDIS_URL` pointing to loopback Redis. They reject production and remote database hosts. The tests use mocked AI/Meta providers or local fixtures and do not require live external credentials. See [database test setup](DATABASE_SETUP.md#postgresql-integration-tests). Browser tests start a disposable API fixture and Next.js; they verify dashboard behavior, not a live Meta connection.

The deterministic signed-webhook-to-grounded-reply integration is in `test/integration/ai-sales-conversation.spec.ts`. Existing integration suites cover duplicate webhook delivery, outbox/Redis recovery and retries, usage limits, tenant isolation, human takeover, outbound provider failures, and delivery reconciliation.

## Health and operational safety

- `GET /health/live` checks that the API is serving; `GET /health/ready` checks PostgreSQL.
- The worker writes a local heartbeat after Redis and PostgreSQL health checks. Monitor it alongside outbox age, failed operations, provider errors, AI handoffs, usage, and delivery states.
- Keep `AI_RESPONSES_ENABLED=false` until a single pilot is approved and staged. The per-business approval, verified connection, active business, `AUTO` conversation mode and matching control version are checked before generation and again before outbound send.
- Maintain staffed human escalation and use owner takeover or the global AI kill switch during incidents. Provider requests already in flight cannot be recalled.
- Read [the merchant dashboard guide](apps/merchant-dashboard/README.md), [pilot readiness checklist](docs/kleva-mvp-30d/policy-001-pilot-readiness.md), [environment reference](docs/ops/environment.md), and [incident response guide](docs/ops/incident-response.md) before a live pilot.
