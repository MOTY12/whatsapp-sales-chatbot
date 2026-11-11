# Infrastructure, costs and monetization

## Deployment

| Environment | Runtime and dependencies | Verification |
| --- | --- | --- |
| Local | Existing Nest API and worker, PostgreSQL 16 with pgvector when knowledge lands, Redis 7+, private S3-compatible emulator or test bucket, deterministic OIDC/Meta/model fixtures. Dashboard dev server proxies same-origin API. | Lint, build, unit, HTTP, migrated PostgreSQL/Redis, adapter contracts and dashboard browser tests. |
| Staging | Separate account, namespace, credentials, database roles and object bucket. Real OIDC and approved Meta test assets. One API, one worker and dashboard, with migration job and version gates. | Seeded upgrade, end-to-end messages, retry/uncertain sends, tenant guards, restore, kill switches and load test. |
| Paid pilot | Managed PostgreSQL with verified TLS, pgvector, PITR and restore drills, private Redis with persistence, private object storage with versioning and KMS. Same-origin dashboard and API, separate workers. | Health checks, queue lag and cost alerts, approved provider limits, on-call owner, restore evidence and staged rollouts. Increase replicas or isolation only from measured load. |

Health metrics include receipt-to-ack, age of oldest outbox, processing latency, terminal failures, uncertain delivery, handoff, provider errors, estimated/actual cost and quota. Use structured redacted logs and short retention. Separate deploy, migration, runtime and operator roles. Scale workers against queue age while maintaining conversation ordering and tenant budget.

## Published vendor references

These are reference rates reviewed for planning, in listed currency before taxes and extras. They do not confirm procurement, Nigeria availability or total cost.

| Item | Published reference or verification needed |
| --- | --- |
| AI inference | GPT-5 mini reference is USD 0.25 input and USD 2.00 output per million tokens for listed standard usage. Measure actual selected model, cache and retry mix. [Model pricing](https://developers.openai.com/api/docs/models/gpt-5-mini) |
| Embeddings | text-embedding-3-small reference is USD 0.02 per million tokens. Re-indexing and repeated edits add usage. [Embedding pricing](https://developers.openai.com/api/docs/models/text-embedding-3-small) |
| WhatsApp | Official public pricing describes delivered messages by category and market and lists no charge for service messages in its general guidance. Capture effective Nigeria/account pricing, applicable service-message rules and any BSP markup before quoting or launch. Model billable cases and billing thresholds explicitly. [Official pricing](https://whatsappbusiness.com/products/platform-pricing/) |
| PostgreSQL | DigitalOcean lists a USD 15/month starting single-node PostgreSQL plan for preliminary use. Select production tier after checking pgvector, backups, region, maintenance and HA. [PostgreSQL pricing](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/) |
| Redis | Select managed Redis-compatible tier by persistence, memory, max clients and verified BullMQ support. Check quotes and region. [Valkey pricing](https://docs.digitalocean.com/products/databases/valkey/details/pricing/) |
| Storage, API, workers, dashboard | Storage, requests, object versions and egress cost separately. Size compute for three processes and measure worker duty cycle. [S3 pricing](https://aws.amazon.com/s3/pricing/) · [Compute pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/) |
| OIDC and monitoring | Estimate by monthly active users, audit retention, logs and traces. Obtain quotes after choosing provider, retention and region. |
| Payment processing | Paystack publishes Nigeria local transaction fees of 1.5% plus NGN 100, capped at NGN 2,000, with the fixed fee waived below NGN 2,500. Confirm channel, account and applicable fee before rollout. Fees on merchant sales are separate from Kleva invoicing costs. [Nigeria pricing](https://paystack.com/pricing) |

Illustrative arithmetic only. At 2,000 input and 250 output tokens per eligible turn, 1,000 turns cost USD 1.00 in generation at the reference rates. A million embedding tokens adds USD 0.02. This excludes retries, summaries, tools, storage, WhatsApp charges, support, taxes and FX. As a separate illustrative hosting scenario, budget USD 15 PostgreSQL, USD 15 Redis, USD 30 for the three compute processes and USD 10 for storage, monitoring and auth combined, giving USD 70/month before HA, variable charges and support. Reprice those inputs per region and production sizing. Allocate fixed cost over active paying merchants and stress-test the upper usage and support cohorts.

## Commercial model and enforcement

A flat subscription is simple but leaves model and provider costs uncapped. Pure usage pricing aligns costs but creates an unpredictable bill for small merchants. Use a **hybrid NGN subscription** with included AI units, a hard cap, and owner-approved prepaid or overage capacity later. Quote chargeable channel fees separately or pass them through. During pilot, invoice manually and set agreed limits per merchant. Derive the price floor from allocated infrastructure, conservative inference and channel scenarios, support, collection and tax allowance, and target margin. Use a recorded FX rate for the quote. Validate willingness to pay before publishing tiers.

Meter each logical event once using a tenant, operation, period, event kind and rate-card version. Record input/output/cache tokens, embedding tokens, model/attempt, provider send category/market/status, and charge estimates versus actual. Reserve budget before a model call or potentially billed send. Reconcile completed events, release unused amounts, preserve late-charge adjustments, and audit grants and overrides. Warn before quota exhaustion. At the hard cap, park chargeable automation and expose a clear human handoff. Owners can view consumption, reset date, invoice reference and adjustments. Keep merchant payment processing evidence separate from Kleva subscription billing.
