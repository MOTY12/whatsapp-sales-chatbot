# PILOT-001 commercial acceptance checklist

## Product and legal decisions

- [ ] Counsel/product owner approves agreement text/version and merchant/customer notice responsibilities.
- [ ] Approves package price, billing period, duration, channel scope, monthly limits, per-request limit and maximum capacity.
- [ ] Approves collection methods, evidence types, invoice references, overdue handling and reversal authority separation.
- [ ] Approves support channel, hours, timezone, coverage description, owner and escalation contact; no unapproved SLA promise.
- [ ] Approves offer expiry, renewal/extension, suspension/expiry service restriction and merchant notification schedule.
- [ ] Approves evidence-reference retention and privacy/access rules.

## Technical evidence

- [ ] Apply/revert/reapply `1760000000038` on disposable PostgreSQL.
- [ ] Prove website-only offer and readiness do not depend on Meta/WhatsApp assets.
- [ ] Prove direct merchant table reads fail, owner acceptance works, employee/cross-tenant acceptance fails, and merchant CSRF/session gates remain enabled.
- [ ] Prove package term changes create a new version and do not mutate existing enrollment snapshots.
- [ ] Prove capacity serialization, invoice partial/full payment, duplicate reference, overpayment, concurrent confirmation, audited reversal and entitlement idempotency.
- [ ] Prove commercial status never changes existing WhatsApp AI pilot approval or activates AI by itself.
- [ ] Approve and implement what live automation does when the commercial pilot expires or is suspended.
- [ ] Complete applicable staging QA-002, privacy/security, restore, incident and release reviews.

## Merchant acceptance

- [ ] An actual business owner is identified and consents to the pilot.
- [ ] Owner accepts the approved package version, price, cap, collection method and support coverage.
- [ ] A real payment is confirmed by the authorized operator against actual external settlement evidence; no test fixture or simulated payment counts.
- [ ] Website setup is complete and the owner has tested their widget and assistant.

PILOT-001 remains pending until all required evidence exists. This repository has no real merchant acceptance or payment evidence.
