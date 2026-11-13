# Decision log

| Decision | Rationale and consequence |
| --- | --- |
| Use WhatsApp as the first revenue channel and provider-neutral contracts underneath | Existing integration and merchant behavior reduce adoption cost. Preserve legacy transport through a staged cutover. Expand only after paid-pilot evidence. |
| Keep the modular monolith and existing outbox | PostgreSQL already provides durable intent and deduplication, Redis schedules work. Separate HTTP, worker and dashboard runtime failure domains. |
| Verify TENANT-002 before new merchant features | The signed OIDC fixture and restricted PostgreSQL roles passed local acceptance on November 13. Require staging OIDC and hosted CI before the pilot. |
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

## Next implementation task

WHATSAPP-001 is next on the December transport path. Use the verified asset resolver to authenticate the original webhook bytes, persist the receipt and outbox intent atomically, and acknowledge only after commit. Test retries and failure recovery with local fixtures. Live Meta rollout still requires approved assets, key provisioning and staging subscription verification.
