# Website Chat (CHANNEL-002)

CHANNEL-002 is intentionally being delivered before QA-002 because the website channel does not depend on Meta approval. WhatsApp pilot verification, QA-002, and all WhatsApp release controls remain unchanged.

## Current implementation boundary

The implementation adds additive migration `WebsiteChat1760000000030`, multiple owner-managed widgets, normalized exact website origins, hashed seven-day anonymous visitor credentials, tenant-bound visitor/conversation records, website message idempotency, lead creation, handoff and website AI outbox operations. The visitor, conversation, inbound message, lead, AI run, and outbound message are PostgreSQL records. BullMQ transports only outbox work. The shared grounded AI service and merchant inbox are reused; website AI does not depend on WhatsApp credentials or Meta pilot approval. Website AI remains disabled until a business owner enables it after global AI, active business, assistant, published knowledge and usage prerequisites are met.

Public endpoints:

- `GET /public/widgets/:publicId/config`
- `POST /public/widgets/:publicId/sessions`
- `GET /public/widgets/:publicId/messages?after=...`
- `POST /public/widgets/:publicId/messages`
- `POST /public/widgets/:publicId/contact`
- `POST /public/widgets/:publicId/handoff`
- `POST /public/widgets/:publicId/session/end`
- `GET /public/widget.js`, `/public/widget-frame.html`, `/public/widget-frame.js`, `/public/widget-frame.css`

Merchant owner endpoints are rooted at `/merchant/businesses/:businessId/website-widget`: `GET`, `POST`, `PATCH/:widgetId`, `PATCH/:widgetId/domains`, and `POST/:widgetId/rotate`. Mutations require the existing merchant session and CSRF proof.

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

## Delivery, tests and limitations

The widget recovers missed messages through bounded cursor history and polling; durable history is authoritative. The iframe shows unread reply counts while it is closed. The merchant screen has a live appearance preview (sample content only; it does not make a live visitor connection). Native WebSocket/SSE delivery, Redis cross-instance event fanout, typing events, inactive visitor/message retention cleanup, and an end-to-end browser run against a live widget API are still outstanding. The integration test exercises actual PostgreSQL widget configuration, visitor creation, idempotent inbound messages, lead creation, origin rejection, and session revocation. Do not mark the channel production-ready until the remaining real-time and browser journey checks pass. See the roadmap acceptance tests. Do not place private inbox notes in website message responses.

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
