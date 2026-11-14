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
- Conversations, Knowledge Base, Products and Leads are honest placeholders. No analytics are fabricated.

## Verification

Run `npm run dashboard:lint`, `npm run dashboard:typecheck`, `npm run dashboard:test`, `npm run dashboard:build`, and `npm run dashboard:test:browser` from the repository root. The browser suite starts a disposable HTTP API fixture and Next.js and tests OIDC cookie bridging, onboarding, duplicate-safe idempotency headers, profile editing, CSRF proofs, session logout, safe GET retry, WhatsApp pending state, tenant selection denial and mobile navigation. It does not replace a staging OIDC provider test.
