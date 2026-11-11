# Merchant dashboard

Use a Next.js app under `apps/dashboard` with same-origin proxying to NestJS. Browser state holds only the active business selection and view state. Backend derives identity from the HttpOnly session and scopes every business path. Follow the actual `/auth/*` routes in HEAD once verified. Use loading, empty, forbidden, failed and offline states. Keep usable touch targets, keyboard operation, mobile list-to-detail navigation and locale-aware money/time formatting.

| Route under /businesses/{businessId} | Merchant journey and API slice | Roles |
| --- | --- | --- |
| /overview and /onboarding | Checklist, create/claim, test connection, publish first source, playground, inbox staff and activate. `GET /onboarding`, `PATCH /profile`, `POST /activation` | Owner changes activation, all active operational roles view |
| /connections | Status, scopes, health, retry and disconnect. `GET /connections`, `POST /connections/signup`, `POST /connections/{id}/complete`, `DELETE /connections/{id}` | Owner |
| /agent and /playground | Tone, locale, disclosure, guardrails and sandbox evidence. `GET/PATCH /agent-config`, `POST /playground/runs`, `GET /playground/runs/{id}` | Owner config, owner/editor sandbox |
| /knowledge and /learning | Upload, revision history, indexing status and approval. `/uploads`, `/knowledge-sources`, `/learning/suggestions` | Owner/editor |
| /inbox and /inbox/{id} | Assignment, history, mode, notes, window and manual reply. `GET /conversations`, `GET /conversations/{id}/messages`, `POST /conversations/{id}/actions`, `POST /conversations/{id}/messages` | Owner/agent |
| /leads and /opportunities | Qualification evidence, stage, owner and conversion action. `GET /leads`, `GET /opportunities`, `POST /opportunities/{id}/actions` | Owner/agent |
| /catalog | Versioned offers, facts, stock state and price source. `GET/POST /offers`, `PATCH /offers/{id}`, `POST /offers/{id}/publish` | Owner/editor authoring, agent read |
| /workflows | Pilot workflow fields, consent rules, future approvals and connector state. `GET/PATCH /sales-policy`, later `/approvals` | Owner config, authorized agent queue |
| /analytics | Qualification, conversion and grounded response cohorts with denominators. `GET /analytics?from=&to=` | Owner/agent, editor only knowledge-quality aggregate |
| /usage and /billing | Included units, caps, current usage and manual invoice reference. `GET /usage`, later `/billing/invoices` | Owner |
| /team and /settings | Team invite, role, revocation, privacy and business profile. `/members`, `/invites`, `/privacy/operations` | Owner |

Put merchant domain routes under `/api/v1/businesses/{businessId}`. Keep auth under `/auth`. Return minimal DTOs with cursor pagination, stable ordering, range limits and operation statuses. Mutations require origin/CSRF, idempotency keys where retriable, and expected version for concurrent edits. E.g. handoff action carries `{type,expectedVersion,memberId?}` and returns mode/version, assignment and in-flight send state. An offer price uses `{minorUnits,currency,effectiveAt,sourceRef}`. A denied foreign resource is 404, a scoped permission failure 403, invalid session 401, stale version 409, unprocessable input 422 and quota 429. Operations return queued/running/succeeded/failed with safe failure codes.

The merchant business switcher lists current memberships. When the business changes, reset cached queries and transient screens. Poll inbox and job state initially. Pause background polling when hidden. Ensure publish, disconnect, takeover and conversion show action results and recoverable errors. See [product scope](product-requirements.md) and [security](security-and-compliance.md).
