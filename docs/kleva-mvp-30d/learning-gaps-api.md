# Merchant learning gaps API

LEARNING-001 surfaces redacted questions that existing AI response runs could not resolve. The API is for merchant review only; it does not create FAQ drafts, change published knowledge, or retrain a model.

## Authorization

Both routes require the existing merchant session and CSRF controls. Access is scoped to `businessId` by `MerchantAccess` and requires `knowledge.manage` (owner/editor). PostgreSQL performs the read/update through role-checked functions; merchant roles have no direct access to gap tables.

## List gaps

`GET /merchant/businesses/:businessId/learning/gaps?status=OPEN&limit=50`

`status` is optional and must be `OPEN`, `REVIEWED` or `DISMISSED`. `limit` defaults to 50 and is bounded from 1 to 100. The response is `{ "items": [...], "limit": 50 }`. Each item includes cluster ID, category, safe topic label, status, occurrence count, first/last occurrence times, latest safe reason code and an optional redacted sample question.

## Update review status

`PATCH /merchant/businesses/:businessId/learning/gaps/:clusterId`

Body: `{ "status": "REVIEWED" }`, `{ "status": "DISMISSED" }`, or `{ "status": "OPEN" }`. Additional fields are rejected. A missing or foreign-tenant cluster is not found. A new occurrence reopens a dismissed cluster.

## Data behavior

Only persisted eligible AI outcomes are captured. Explicit customer-requested human help and operational failures are excluded. Each source AI run can create at most one occurrence per business. Email, phone, street address and URL text is redacted before persistence; credential/payment/secret-like messages retain no free text. Samples are limited to 280 characters and occurrences expire after 90 days. Cluster counts and latest-seen metadata are recalculated by the scheduled worker retention task.

See [AI agent architecture](../kleva-omnichannel/ai-agent-architecture.md#learning-001-feedback-and-knowledge-gaps) and [migration strategy](../kleva-omnichannel/migration-strategy.md#learning-001-feedback-and-knowledge-gaps).
