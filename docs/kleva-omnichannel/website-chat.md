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

Events use version 1 and an allowlisted type (`message.created`, `message.updated`, conversation state/control changes, typing start/stop, and `session.revoked`). Redis Pub/Sub carries identifiers and timestamps only; each receiver filters by business and conversation. A visitor revocation event includes its target session ID and closes only that visitor session; merchant inbox scopes remain business/conversation scoped. Public and merchant projections are separate. PostgreSQL remains authoritative: notifications are emitted after message transactions commit, duplicates are suppressed in a bounded local event-ID cache, and reconnects/history polling reconcile dropped notifications. Pub/Sub is not exactly-once or durable. The widget retries with capped exponential backoff and jitter, loads cursor-based durable history after the SSE subscription is ready, and keeps visibility-aware polling as fallback.

Public request limits use atomic Redis `INCR`/expiry operations with hashed identities. The keys contain no IP address, bearer token, or message. Session creation is scoped by widget and privacy-normalized client IP; authenticated operations are scoped by widget and visitor token (the token is only hashed before it enters a key). Message/session rate limits are enforced both by the existing PostgreSQL limiter and the new shared Redis limiter. Configuration and message reads, contacts, handoff, typing, session end, and reconnection receive their own bounded Redis limit. The configured defaults are in `.env.example`; they are technical abuse controls, not commercial quotas. `Retry-After` accompanies limit responses. Redis failure returns HTTP 503 for rate-limited public operations; the API does not silently bypass a global limit. This is a deliberate fail-closed availability tradeoff.

SSE connection caps are enforced with an atomic Redis sorted-set lease per visitor session, in addition to a local process cap. Each connection has a random lease ID, lease TTL, periodic renewal, and idempotent release. A process crash leaves a lease only until expiry; acquisition removes stale scores before counting, so stale entries cannot permanently consume capacity. If renewal fails or the lease disappears, the stream closes and the widget reconnects with backoff. Redis outage rejects new streams with HTTP 503. The expected topology is browser → HTTPS reverse proxy → Nest API instances → shared Redis/PostgreSQL. Disable proxy response buffering for SSE, keep streaming timeouts longer than the stream heartbeat, and drain API connections gracefully.

Client IP resolution uses the TCP peer address by default. `X-Forwarded-For` is accepted only when the immediate peer exactly matches an address in `WEBSITE_TRUSTED_PROXY_IPS`; the chain is walked from the nearest hop to the first untrusted address. Do not configure the browser/client address as a trusted proxy. IPv4-mapped IPv6 is normalized. Raw IPs are used only transiently to derive a SHA-256 rate-limit identity and are not persisted. CIDR ranges are not currently accepted; configure exact proxy addresses.

Visitor and human typing notifications are ephemeral. Redis holds a short-lived active key (six seconds) and a per-actor start throttle; typing contents are never sent or stored. Assistant typing stops when the committed reply/failure path completes. A Redis outage does not undo a committed message; the event is logged as unavailable and durable history remains recoverable.

## Retention

The seven-day visitor credential lifetime is unchanged. Worker maintenance reports expired/revoked session counts, eligible website message counts and deletion outcomes. Expired/revoked session cleanup is **disabled** by default and dry-run is enabled; when explicitly enabled it deletes bounded session batches only. It does not delete customer messages, leads, merchant records or audit evidence. Message retention is report-only: `WEBSITE_MESSAGE_RETENTION_DAYS=0` means no message is considered eligible. Select a nonzero value only after merchant/operator/legal retention policy approval; deletion of messages is not implemented by this job. Expired Redis typing keys are removed by TTL.

Environment settings (also listed in `.env.example` and `deploy/.env.compose.example`):

- `WEBSITE_SESSION_CLEANUP_ENABLED=false`
- `WEBSITE_SESSION_CLEANUP_DRY_RUN=true`
- `WEBSITE_SESSION_CLEANUP_BATCH=250` (bounded 1–2000)
- `WEBSITE_SESSION_CLEANUP_GRACE_HOURS=24` (bounded 1–8760)
- `WEBSITE_MESSAGE_RETENTION_DAYS=0` (report-only eligibility, bounded 0–3650)
- `WEBSITE_RATE_LIMIT_ENABLED=true`
- `WEBSITE_SESSION_RATE_LIMIT_PER_MINUTE=10`
- `WEBSITE_MESSAGE_RATE_LIMIT_PER_MINUTE=20`
- `WEBSITE_CONFIG_RATE_LIMIT_PER_MINUTE=60`
- `WEBSITE_READ_RATE_LIMIT_PER_MINUTE=60`
- `WEBSITE_BUSINESS_RATE_LIMIT_PER_MINUTE=1200` (shared technical traffic guard across the business's widgets)
- `WEBSITE_CONTACT_RATE_LIMIT_PER_MINUTE=5`
- `WEBSITE_HANDOFF_RATE_LIMIT_PER_MINUTE=5`
- `WEBSITE_SESSION_END_RATE_LIMIT_PER_MINUTE=10`
- `WEBSITE_TYPING_RATE_LIMIT_PER_MINUTE=60`
- `WEBSITE_SSE_RECONNECT_RATE_LIMIT_PER_MINUTE=12`
- `WEBSITE_SSE_MAX_CONNECTIONS_PER_SESSION=4`
- `WEBSITE_SSE_LEASE_TTL_SECONDS=90`
- `WEBSITE_SSE_LEASE_RENEW_SECONDS=30`
- `WEBSITE_TRUSTED_PROXY_IPS=` (comma-separated exact proxy peer IPs)

## Verification and remaining release work

Verified locally on 2026-11-26: backend unit suite (30 suites, 143 tests), complete disposable PostgreSQL/Redis integration suite (23 suites, 144 tests), dashboard unit suite (11 files, 38 tests), dashboard typecheck/lint/build, and dashboard Playwright suite (26 tests). The website integration suite starts the real demo site and a Nest API, loads the actual cross-origin iframe widget in Chromium, sends a visitor message, confirms PostgreSQL persistence, validates live SSE origin rejection and session-revocation delivery, and checks mobile width. New Redis tests cover atomic rate limits across service instances and identity dimensions, session lease caps, renew/release, and expiry recovery. This does not yet cover the full end-to-end merchant setup → published knowledge → AI reply → inbox takeover → visitor reply scenario.

Remaining before CHANNEL-002 can be marked verified: browser acceptance for real AI delivery, merchant-to-visitor human replies, reconnect recovery, unauthorized-origin/session/revocation cases in the live browser, and keyboard/screen-reader flows; production CSP/proxy/load testing; and an approved data-retention policy. Cross-instance Redis Pub/Sub and distributed limit/lease service behavior are integration-tested, but real multi-process worker/API delivery and loss/restart stress are not load-tested. Do not place private inbox notes in website message responses. WhatsApp pilot verification and QA-002 remain separate.

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
