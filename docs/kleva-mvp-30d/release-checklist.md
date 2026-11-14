# December release checklist

## Engineering acceptance

- [x] Local merchant authentication, session and PostgreSQL isolation suite passes with signed OIDC fixtures.
- [ ] Hosted CI passes lint, build, unit, HTTP, database, queue and browser journey checks.
- [x] Backend tests prove atomic creation, idempotent retry, role checks, and cross-tenant denial.
- [ ] Browser onboarding proves same-origin sessions, atomic ownership, profile edits and cross-business denial.
- [x] Signed webhook commits to PostgreSQL before acknowledgement. Duplicate events, Redis outage, worker restart and replay preserve intended inbound message effects in local integration.
- [x] Local Meta fixtures and PostgreSQL verify tenant-bound encrypted provisioning, rotation, revocation and disconnect.
- [ ] Approved WhatsApp assets and encrypted credentials map to the correct tenant. Verify send windows, delivery status and uncertain-send recovery.
- [ ] Merchant publishes an FAQ and product, sees grounded replies and observes handoff for insufficient evidence. Unknown price, stock, payment and policy facts are omitted.
- [ ] Lead and conversation history persist. Manual takeover prevents pending AI sends and permits a merchant reply.
- [x] Per-tenant WhatsApp and AI token budgets reserve atomically and reconcile idempotently in local PostgreSQL integration.
- [ ] Alert on usage limits, uncertain deliveries and degraded dependencies.

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
