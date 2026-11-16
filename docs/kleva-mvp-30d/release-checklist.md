# December release checklist

## Engineering acceptance

- [x] Local merchant authentication, session and PostgreSQL isolation suite passes with signed OIDC fixtures.
- [ ] Hosted CI passes lint, build, unit, HTTP, database, queue and browser journey checks.
- [x] Backend tests prove atomic creation, idempotent retry, role checks, and cross-tenant denial.
- [x] Fixture-backed browser journeys cover same-origin sessions, onboarding, profile edits and business selection; INBOX-002 tests also cover tenant switching/denial, takeover, manual reply and delivery-state polling. These do not replace staging OIDC or live Meta verification.
- [x] Fixture-backed Playwright browser journey proves same-origin cookie callback, onboarding, CSRF-protected profile edits, safe GET retry, pending WhatsApp view, membership-scoped selection denial, logout and mobile navigation. Staging OIDC remains a separate release check.
- [x] Signed webhook commits to PostgreSQL before acknowledgement. Duplicate events, Redis outage, worker restart and replay preserve intended inbound message effects in local integration.
- [x] Local Meta fixtures and PostgreSQL verify tenant-bound encrypted provisioning, rotation, revocation and disconnect.
- [ ] Approved WhatsApp assets and encrypted credentials map to the correct tenant. Verify send windows, delivery status and uncertain-send recovery.
- [x] Local PostgreSQL workflow verifies a published tenant product produces one exact-price/currency reply with usage reconciliation and idempotent intent; an unsupported delivery question records a handoff and uses the configured fallback without calling the model. Validator unit tests reject altered/null prices, unknown stock, unsupported discounts, delivery promises, unsupported evidence and malformed output. Deterministic provider fixtures only; live model/Meta behavior remains unverified.
- [x] Local PostgreSQL integration verifies tenant-scoped conversation/history APIs, audited takeover/release, manual reply idempotency and suppression of stale AI sends.
- [ ] Staging with approved Meta assets verifies send-window enforcement, delivery reconciliation and the documented in-flight takeover boundary.
- [x] Per-tenant WhatsApp and AI token budgets reserve atomically and reconcile idempotently in local PostgreSQL integration.
- [x] Merchant FAQ drafts use immutable revisions; only the explicitly published revision is returned by the tenant-scoped retrieval function. Dashboard fixture journeys cover creation, publish, edit, republish and unpublish.
- [x] Merchant products use immutable revisions, exact nullable decimal prices and explicit availability; real PostgreSQL checks owner/editor authorization, tenant isolation, optimistic conflicts, publish/unpublish and published-only runtime retrieval. Dashboard journeys cover product editing, exact prices, unknown availability, tenant switching, denial and mobile layout.
- [x] Internal RAG-001 search combines currently published FAQs and products using PostgreSQL full-text search, exact SKU matching, bounded ranking and explicit no-content/no-match/low-relevance outcomes. Real PostgreSQL integration verifies draft and unpublished exclusion, publication consistency, tenant isolation, exact product facts, parameterized injection-shaped input, migration rollback/reapply and search indexes.
- [x] RAG-002 / initial AGENT-001 local slice uses one configured OpenAI-compatible chat-completions adapter with bounded timeout/retry, evidence-ID and claim validation, handoff status, token reservation/reconciliation, and the existing outbound/send-control fence. AI processing intent is written from eligible persisted customer messages in the webhook transaction; replay-safe AI runs and minimal outbox payloads prevent duplicate generation/delivery. Local unit and PostgreSQL integration cover generated product replies, exact price/currency, insufficient evidence, fallback handoff, takeover races, model outage and idempotent repeated execution.
- [x] SALES-001 captures one tenant-scoped lead per verified customer conversation in the inbound transaction, audits manual status changes, and links the dashboard to retained message history. Local PostgreSQL webhook coverage excludes owner/onboarding events and the dashboard browser workflow covers status updates and conversation navigation. No historical conversation backfill is performed.
- [ ] Alert on usage limits, uncertain deliveries and degraded dependencies.
- [x] Multi-stage non-root API and standalone dashboard images build; Compose keeps Redis private and PostgreSQL external.
- [x] API/dashboard health probes, worker heartbeat, graceful API/worker shutdown, production OIDC/keyring validation and migration advisory lock are in place.
- [x] Caddy HTTPS/redirect routing, request-size cap, proxy configuration and webhook raw-body path validate locally; live certificate and callback remain staging checks.
- [x] Operations SQL, alert thresholds/actions, incident response, rollback and proposed retention guidance are documented.
- [x] Disposable local PostgreSQL custom-format dump/restore succeeded; this did not exercise age/S3 encryption or an off-host backup.
- [ ] Configure cloud log/alert delivery, complete age-encrypted S3 upload and restore test, and record staging backup/restore duration.

## Staging and live release

- [ ] Configure real OIDC issuer and callback, TLS, cookie policy, session role grants and same-origin dashboard routing. Run browser login, logout and expiry.
- [ ] Confirm Meta permissions, approved assets, consent and supported templates. Record an end-to-end inbound and outbound staging exchange.
- [ ] Apply migrations to a backup or staging copy, validate role grants, exercise restore and record rollback conditions.
- [ ] Verify redacted logs, ready/live endpoints, worker backlog monitoring, error alerts and incident ownership.
- [ ] Verify published privacy and support contact, retention and deletion procedures, and pilot opt-in.
- [ ] Enable the agent only for approved pilot tenants. Keep a tested disable switch and an operator-run inbox during the pilot.

- [x] Local signed intake rolls back on PostgreSQL failure and recovers queued handoff after Redis outage.
- [x] Worker creates tenant-scoped customer, conversation and inbound message; verified owner commands and legacy onboarding create durable pending response intents without sending in a transaction.
- [ ] Verify live Meta intake, owner/onboarding reply delivery and outbound status reconciliation against approved staging assets before routing pilot traffic.
- [x] Metering migration and PostgreSQL integration verify quota boundaries, concurrent reservations, reconciliation, uncertain sends, tenant role denial and recovery without Redis.
- [x] Outbound sends persist tenant-scoped intent and usage holds before the worker calls Meta; local PostgreSQL tests cover rejection, timeout, idempotency and restart behavior.
- [x] Delivery callbacks reconcile by tenant and connection, retain unmatched provider IDs, and do not downgrade newer delivery states.
- [x] Pending owner-command and legacy-onboarding responses are generated once and queued as separate metered outbounds. Customer AI replies remain disabled.
- [ ] Verify approved template availability and live Meta messaging-window behavior. Free-form messages outside the 24-hour service window currently fail closed.
- [ ] Exercise operator reconciliation of `UNCERTAIN` sends against Meta provider history in staging; Meta does not guarantee idempotent send requests.
- [ ] Run the hosted CI browser journey after INBOX-002; local browser fixtures do not prove live Meta delivery.
- [x] QA-001 browser suite passes 18/18 in four consecutive isolated Node 22 runs. Playwright uses a per-run Next `distDir` and safely restores generated type references, avoiding the developer server's shared `.next` manifests/cache; ESLint and TypeScript exclude generated output directories.
- [ ] Hosted CI must rerun after QA-001 changes; latest hosted run #47 passed on base HEAD `9397fef`, before this local QA diff.
- [ ] Run representative performance measurements and a PostgreSQL restart/reconnection drill; these are explicitly NOT_TESTED in the [release readiness matrix](release-readiness-matrix.md).
