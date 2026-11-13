# December release checklist

## Engineering acceptance

- [x] Local merchant authentication, session and PostgreSQL isolation suite passes with signed OIDC fixtures.
- [ ] Hosted CI passes lint, build, unit, HTTP, database, queue and browser journey checks.
- [ ] Browser onboarding proves same-origin sessions, atomic ownership, profile edits and cross-business denial.
- [ ] Signed webhook commits to PostgreSQL before acknowledgement. Duplicate events, Redis outage, worker restart and replay preserve intended effects.
- [ ] Approved WhatsApp assets and encrypted credentials map to the correct tenant. Verify send windows, delivery status and uncertain-send recovery.
- [ ] Merchant publishes an FAQ and product, sees grounded replies and observes handoff for insufficient evidence. Unknown price, stock, payment and policy facts are omitted.
- [ ] Lead and conversation history persist. Manual takeover prevents pending AI sends and permits a merchant reply.
- [ ] Per-tenant delivery and model budgets survive retries and concurrent requests. Alert on limits and degraded dependencies.

## Staging and live release

- [ ] Configure real OIDC issuer and callback, TLS, cookie policy, session role grants and same-origin dashboard routing. Run browser login, logout and expiry.
- [ ] Confirm Meta permissions, approved assets, consent and supported templates. Record an end-to-end inbound and outbound staging exchange.
- [ ] Apply migrations to a backup or staging copy, validate role grants, exercise restore and record rollback conditions.
- [ ] Verify redacted logs, ready/live endpoints, worker backlog monitoring, error alerts and incident ownership.
- [ ] Verify published privacy and support contact, retention and deletion procedures, and pilot opt-in.
- [ ] Enable the agent only for approved pilot tenants. Keep a tested disable switch and an operator-run inbox during the pilot.
