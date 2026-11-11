# Decision log

| Decision | Rationale and consequence |
| --- | --- |
| Use WhatsApp as the first revenue channel and provider-neutral contracts underneath | Existing integration and merchant behavior reduce adoption cost. Preserve legacy transport through a staged cutover. Expand only after paid-pilot evidence. |
| Keep the modular monolith and existing outbox | PostgreSQL already provides durable intent and deduplication, Redis schedules work. Separate HTTP, worker and dashboard runtime failure domains. |
| Verify TENANT-002 before new merchant features | Source and migration exist, but the auth integration suite fails in setup. Downstream business routes must wait for positive OIDC, session and restricted-role evidence. |
| Use native catalog and lightweight CRM first | SMEs can onboard without other software. Verified prices and availability come from explicit records. Orders, bookings and payments follow separate approval and reconciliation work. |
| Keep provider IDs and customer IDs distinct | Existing WhatsApp IDs remain stable. Cross-channel links require verified consent and provenance. |
| Choose PostgreSQL and pgvector with a benchmark gate | Existing tenant transactions and publish pointers simplify consistency. Add approximate indexing only after measured latency and filtered-recall evidence. |
| Centralize tools behind deterministic permissions | The model proposes language and bounded actions. The system owns authority, validation, approval, spend and external effects. |
| Start with a hybrid subscription and manual pilot billing | Merchant caps protect spend, and manual billing validates demand before automating collections. |
| Keep LinkedIn and TikTok conditional | Official documentation shows APIs, but account access and automated sales use are unverified. Record go/no-go independently. |

## Unresolved decisions and owners

| Owner | Evidence to obtain before dependent release |
| --- | --- |
| Product and integration lead | Approved WhatsApp asset, signed real sandbox event, Meta terms review for merchant-specific AI sales, Nigerian billing/rate card and templates |
| Product lead | Pilot merchant segments, conversion denominators, support model, willingness to pay and included NGN usage cap |
| Infrastructure and security | OIDC staging registration, KMS key recovery, pgvector hosting and restore, provider retention terms, service region and actual monthly quotes |
| Privacy lead with Nigerian counsel | Controller/processor mapping, cross-border safeguards, registration classification and appropriate retention |
| Integrations lead | Instagram/Messenger access and window cases, Telegram sandbox, email scope decision, LinkedIn/TikTok account eligibility |
| Commerce lead | Catalog freshness rules, provider inventory/booking contracts, payment verification and permitted automated effects |

## Next implementation prompt

TENANT-002 is in progress. Its dependencies are available through the existing local fixtures, and its outcome gates every merchant business and dashboard route. The independent CHANNEL-001 contract work and POLICY-001 provider review may be scheduled separately, but neither resolves the immediate merchant authorization gate.

> **Finish and verify TENANT-002 only.** Start from the actual current Git HEAD and preserve unrelated changes. Read the original V1 TENANT-002 card, the omnichannel repository assessment, and the auth and database grant code. Reproduce the auth integration failure on Node 22 or the available supported runtime with the disposable PostgreSQL/Redis harness. Remove the temporary discovery probe and fix native loading of the real OpenID client in the test harness without stubbing authentication behavior. A compiled-app test process with the deterministic local OIDC provider is acceptable if needed. Keep browser-bound one-time state, S256, nonce, signature, issuer, audience, expiry and configured redirect URI checks. Prove session rotation, expiry, logout/CSRF, membership and role changes, same-origin cookie settings, multi-business switching, and default-deny concurrent pooled SQL under restricted identity/merchant roles. Test migration rollback and legacy webhook/owner/outbox regressions. Only make application changes when supported by a failing acceptance test. Run npm run lint:check, npm run build, npm test, npm run test:e2e, npm run test:integration -- auth-tenant, and npm run test:integration. Document results, actual HEAD and unverified provider/deployment limits. Update the original and omnichannel trackers only after obtaining evidence. Stop after TENANT-002, without implementing onboarding or another roadmap task.
