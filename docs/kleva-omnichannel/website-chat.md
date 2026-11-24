# Website Chat (CHANNEL-002)

CHANNEL-002 is intentionally being delivered before QA-002 because the website channel does not depend on Meta approval. WhatsApp pilot verification, QA-002, and all WhatsApp release controls remain unchanged.

## Current implementation boundary

The implementation adds additive migration `WebsiteChat1760000000030`, multiple owner-managed widgets, normalized exact website origins, hashed seven-day anonymous visitor credentials, tenant-bound visitor/conversation records, website message idempotency, lead creation, handoff and website AI outbox operations. The visitor, conversation, inbound message, lead, AI run, and outbound message are PostgreSQL records. BullMQ transports only outbox work. The shared grounded AI service and merchant inbox are reused; website AI does not depend on WhatsApp credentials or Meta pilot approval. Website AI remains disabled until a business owner enables it after global AI, active business, assistant, published knowledge and usage prerequisites are met.

Public endpoints:

- `GET /public/widgets/:publicId/config`
- `POST /public/widgets/:publicId/sessions`
- `GET /public/widgets/:publicId/messages?after=...`
- `GET /public/widgets/:publicId/events` (fetch-based SSE)
- `POST /public/widgets/:publicId/messages`
- `POST /public/widgets/:publicId/typing`
- `POST /public/widgets/:publicId/contact`
- `POST /public/widgets/:publicId/handoff`
- `POST /public/widgets/:publicId/session/end`
- `GET /public/widget.js`, `/public/widget-frame.html`, `/public/widget-frame.js`, `/public/widget-frame.css`

Merchant owner endpoints are rooted at `/merchant/businesses/:businessId/website-widget`: `GET`, `POST`, `PATCH/:widgetId`, `PATCH/:widgetId/domains`, and `POST/:widgetId/rotate`. Mutations require the existing merchant session and CSRF proof.

The shared inbox stream is `GET /merchant/businesses/:businessId/conversations/events`, proxied through `/api/inbox/...`; typing updates use `POST /merchant/businesses/:businessId/conversations/:conversationId/typing` and retain the merchant session/CSRF guard.

The script is isolated in a cross-origin iframe and uses the public widget ID and allowlisted site origin. The iframe verifies the actual parent `postMessage` origin against its site-origin hint before opening visitor sessions. Anonymous session credentials are random and only SHA-256 digests are persisted. Public APIs bind credentials to widget, business, visitor, conversation and origin and rate-limit session creation and message submission. Visitor text is rendered with `textContent`; arbitrary HTML is never interpreted. Browser storage is optional, so embedded browsers that block third-party local storage can still chat for the open page session. Contact capture requires explicit consent. Widget appearance preview, suggested questions, logo URL, privacy notice, offline message, business hours in the business timezone, and multi-widget selection are owner-configurable.

## Local installation

1. Start PostgreSQL, Redis, backend, worker and dashboard using the repository's local development workflow.
2. Apply migrations with `npm run migration:run:locked` after reviewing the target database.
3. Set `WEBSITE_WIDGET_PUBLIC_ORIGIN=http://localhost:3000` in the backend environment for local development. Production must use the public HTTPS origin serving the backend/widget assets.
4. Sign in as a business owner, open **Dashboard → Website Chat**, create a widget, register `http://localhost:4173`, configure its appearance and optional hours, and save settings.
5. Run `WEBSITE_WIDGET_PUBLIC_ID=<public-id> npm run widget-demo` and visit `http://localhost:4173`.
6. Publish at least one FAQ or product and save assistant settings before enabling website AI. Configure the global AI provider and usage limits. WhatsApp setup and Meta approval are not needed for website chat.

The demo storefront is illustrative; its static cards do not seed or publish authoritative catalog records. The AI uses only the selected business's currently published FAQ/product knowledge.

## Configuration

`WEBSITE_WIDGET_PUBLIC_ORIGIN` is an origin only (scheme + host + optional port), with no path or credentials. Production accepts HTTPS only. In development it defaults to `http://localhost:3000`. `KLEVA_BACKEND_ORIGIN` remains a private server-side dashboard setting. `WEBSITE_WIDGET_PUBLIC_ID` is needed only by the local demo and is a public identifier, not a credential.

## Real-time delivery and recovery

The channel uses fetch-based Server-Sent Events (SSE), rather than WebSockets. SSE fits the one-way notification stream; existing authenticated HTTP endpoints remain responsible for sending messages and typing updates. The visitor event endpoint is `GET /public/widgets/:publicId/events`; merchant inbox updates use `GET /merchant/businesses/:businessId/conversations/events` through the dashboard BFF. The widget sends its visitor token in the `Authorization` header, never the URL. The BFF forwards the merchant session cookie and does not expose backend credentials to the browser.

Events use version 1 and an allowlisted type (`message.created`, `message.updated`, conversation state/control changes, typing start/stop, and `session.revoked`). Redis Pub/Sub carries identifiers and timestamps only; each receiver filters by business and, for visitors, conversation. Public and merchant projections are separate. PostgreSQL remains authoritative: notifications are emitted after message transactions commit, duplicates are suppressed in a bounded local event-ID cache, and reconnects/history polling reconcile dropped notifications. Pub/Sub is not exactly-once or durable. The widget retries with capped exponential backoff and jitter, loads cursor-based durable history, and keeps visibility-aware polling as fallback. Local connection limits are enforced per account/session per API instance. SSE clients heartbeat and revalidate authorization/session state every 30 seconds; visitors are closed on revocation. The reverse proxy must stream without buffering.

Visitor and human typing notifications are ephemeral. Redis holds a short-lived active key (six seconds) and a per-actor start throttle; typing contents are never sent or stored. Assistant typing stops when the committed reply/failure path completes. A Redis outage does not undo a committed message; the event is logged as unavailable and durable history remains recoverable.

## Retention

The seven-day visitor credential lifetime is unchanged. Worker maintenance reports expired/revoked session counts, eligible website message counts and deletion outcomes. Expired/revoked session cleanup is **disabled** by default and dry-run is enabled; when explicitly enabled it deletes bounded session batches only. It does not delete customer messages, leads, merchant records or audit evidence. Message retention is report-only: `WEBSITE_MESSAGE_RETENTION_DAYS=0` means no message is considered eligible. Select a nonzero value only after merchant/operator/legal retention policy approval; deletion of messages is not implemented by this job. Expired Redis typing keys are removed by TTL.

Environment settings (also listed in `.env.example` and `deploy/.env.compose.example`):

- `WEBSITE_SESSION_CLEANUP_ENABLED=false`
- `WEBSITE_SESSION_CLEANUP_DRY_RUN=true`
- `WEBSITE_SESSION_CLEANUP_BATCH=250` (bounded 1–2000)
- `WEBSITE_SESSION_CLEANUP_GRACE_HOURS=24` (bounded 1–8760)
- `WEBSITE_MESSAGE_RETENTION_DAYS=0` (report-only eligibility, bounded 0–3650)

## Verification and remaining release work

Verified locally: backend unit suite (118 tests), complete PostgreSQL/Redis integration suite (19 suites, 129 tests, including a two-instance Redis fan-out and retention dry-run/cleanup), dashboard unit suite (10 files, 35 tests), and existing dashboard Playwright suite (24 tests). The website integration suite also starts the real demo site and a Nest API, loads the actual cross-origin iframe widget in Chromium, sends a visitor message, confirms PostgreSQL persistence, validates live SSE origin rejection and session-revocation delivery, and checks mobile width. This is not the full end-to-end merchant setup → published knowledge → AI reply → inbox takeover → visitor reply scenario.

Remaining before CHANNEL-002 can be marked verified: browser acceptance for real AI delivery, merchant-to-visitor human replies, reconnect recovery, unauthorized-origin/session/revocation cases in the live browser, and keyboard/screen-reader flows; distributed public abuse limits; production CSP/proxy/load testing; and an approved data-retention policy. Cross-instance Redis fan-out is integration-tested, but real multi-process worker/API delivery and loss/restart stress are not load-tested. Do not place private inbox notes in website message responses. WhatsApp pilot verification and QA-002 remain separate.

## Verification commands

```sh
npm test -- --runInBand
npm run build
npm run dashboard:typecheck
npm run dashboard:lint
npm run dashboard:test
npm run dashboard:build
npm run test:integration
```

The integration command requires a disposable PostgreSQL control database and Redis service configured with `KLEVA_TEST_PG_HOST`, `KLEVA_TEST_PG_PORT`, `KLEVA_TEST_PG_DATABASE=kleva_integration_control`, `KLEVA_TEST_PG_USER`, `KLEVA_TEST_PG_PASSWORD`, and `KLEVA_TEST_REDIS_URL=redis://127.0.0.1:<port>`. The harness creates and drops unique temporary databases and roles. Do not point it at production.

For example, with disposable local services: `KLEVA_TEST_PG_HOST=/tmp KLEVA_TEST_PG_PORT=5432 KLEVA_TEST_PG_DATABASE=kleva_integration_control KLEVA_TEST_PG_USER=<test-role> KLEVA_TEST_PG_PASSWORD=<test-secret> KLEVA_TEST_REDIS_URL=redis://127.0.0.1:6381 NODE_ENV=test npm run test:integration -- --forceExit`. The website chat browser acceptance is part of this integration suite and requires Chromium available through the dashboard Playwright dependency.
