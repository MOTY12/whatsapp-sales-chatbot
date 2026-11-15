# Kleva merchant dashboard

This is a standalone Next.js App Router application. The NestJS server remains the source of truth for OIDC, merchant sessions, role checks, tenant authorization, business data and WhatsApp connection status.

## Local development

Copy `.env.example` to `.env.local` in this directory and set:

- `KLEVA_BACKEND_ORIGIN`: private/server-side Nest origin. Never prefix it with `NEXT_PUBLIC_`.
- `DASHBOARD_PUBLIC_ORIGIN`: the exact browser origin serving Next.js; used for the backend's same-origin CSRF proof.

Configure backend `OIDC_REDIRECT_URI` to `${DASHBOARD_PUBLIC_ORIGIN}/auth/callback` and register that exact callback with the identity provider. Start Nest using the existing root scripts, then run `npm run dashboard:dev` from the repository root (dashboard at port 3001 by default; backend must be reachable at port 3000). In production serve dashboard and API through the same browser origin or an HTTPS reverse proxy. Browser-facing session cookies are set by the dashboard callback bridge and forwarded server-to-server to Nest.

## Architecture

- Server Components call `lib/api.ts`; the typed client forwards request cookies, disables caching, uses bounded timeouts and retries only safe GETs once for transient failures.
- `/auth/login` transfers the backend's short-lived OIDC binding cookie to the dashboard origin before redirecting to the identity provider. `/auth/callback` forwards the callback and cookies to Nest, then returns to `/dashboard`.
- Session validation happens on every dashboard layout render through `/auth/me`. Business creation and profile edits are server actions. Mutations forward the CSRF cookie as `X-CSRF-Token` with the configured public `Origin`; creation also sends the backend-required UUID v4 `Idempotency-Key`.
- Business selection is limited to memberships returned by `/auth/me`. Backend business and WhatsApp routes still authorize every request.
- WhatsApp status is read from `/merchant/businesses/:businessId/whatsapp`. Setup is described as supervised; no credential collection, Meta onboarding or token display is offered. The API currently does not expose a merchant phone number.
- Conversations use the existing merchant API for list, detail, paginated message history, takeover, release and metered manual replies. The Next `/api/inbox` Route Handler is an authenticated same-origin proxy; it validates Origin and CSRF proof for mutations, while Nest rechecks the active membership, business and conversation on every call. The selected business must come from `/auth/me` memberships.
- The inbox loads 30 conversations and messages per page and follows only the opaque `nextCursor` from the API. Older history is prepended in chronological order while preserving the reader's scroll position. The selected thread refreshes every 8 seconds and the conversation list every 20 seconds; polling pauses for hidden tabs and stops when the thread is unmounted.
- Human replies require HUMAN takeover, stay under the API's 4096-character limit, and reuse a UUID v4 `Idempotency-Key` when retrying unchanged draft text. A successful response is labelled **Queued**; that acknowledgement means durable acceptance, not customer delivery. Later `SENDING`, `ACCEPTED`, `DELIVERED`, `READ`, `FAILED` and `UNCERTAIN` states are shown with safe descriptions. Raw provider errors and IDs are not rendered. Quota, disconnected-channel and closed-window failures preserve the draft.
- Knowledge FAQs are plain text with immutable numbered revisions. Saving edits advances the draft revision; only an explicit publish changes customer-facing retrieval, and unpublishing removes the FAQ from retrieval while retaining its history. FAQ mutations go through the same-origin `/api/knowledge` proxy and are authorized by Nest for the active owner/editor membership. PDF upload and embedding/index management are not part of this FAQ slice.
- The backend route contract, request shapes, revision rules and retrieval boundary are documented in [the merchant FAQ API reference](../../docs/kleva-mvp-30d/merchant-knowledge-api.md).
- The native Products catalog stores customer-facing merchant facts with immutable revisions, explicit publish/unpublish actions, optimistic editing, exact decimal prices, and `UNKNOWN` availability when the merchant has not confirmed stock. Mutations pass through the same-origin `/api/products` proxy; Nest enforces owner/editor access and tenant scope. Only published revisions are available to the restricted runtime retrieval function. See [the merchant catalog API reference](../../docs/kleva-mvp-30d/merchant-catalog-api.md).
- Leads remain a placeholder. No unread counts or analytics are fabricated.

## Verification

Run `npm run dashboard:lint`, `npm run dashboard:typecheck`, `npm run dashboard:test`, `npm run dashboard:build`, and `npm run dashboard:test:browser` from the repository root. The browser suite starts a disposable HTTP API fixture and Next.js. Inbox journeys cover list/history, cursor paging, takeover/release, one queued reply per repeated submission, changing delivery state, quota/disconnected/window failures, draft retention, empty inbox, foreign tenant denial, business switching, mobile back navigation and expired sessions. Knowledge journeys cover FAQ draft and publication lifecycle, safe plain-text display, tenant switching, role denial and expired sessions. Product journeys cover revision publishing, exact prices and unknown stock, tenant switching, editor access, service errors, expiry and mobile controls. These fixtures validate dashboard behavior, not live Meta delivery or production OIDC configuration.
