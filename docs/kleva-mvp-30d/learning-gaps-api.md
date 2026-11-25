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

## LEARNING-002 merchant approval routes (in progress)

Mutations use the merchant session, CSRF validation, `knowledge.manage`, tenant context and no-store responses.

- `GET /merchant/businesses/:businessId/learning/suggestions?status=PENDING_REVIEW`
- `GET /merchant/businesses/:businessId/learning/suggestions/:suggestionId`
- `POST /merchant/businesses/:businessId/learning/gaps/:clusterId/suggestions` with a merchant supplied `{ "question": "...", "answer": "..." }`.
- `POST /merchant/businesses/:businessId/learning/gaps/:clusterId/suggestions/ai-draft` reuses the metered assistant playground against the redacted gap question and published tenant knowledge. It creates an `AI_ASSISTED` draft only when grounded playground evidence supports an answer. The merchant must review/edit and submit it.
- `PATCH /merchant/businesses/:businessId/learning/suggestions/:suggestionId` with `expectedVersion`, question and answer.
- `POST /merchant/businesses/:businessId/learning/suggestions/:suggestionId/submit` with `expectedVersion`.
- `POST /merchant/businesses/:businessId/learning/suggestions/:suggestionId/approve` with `expectedVersion` and UUIDv4 `idempotencyKey`.
- `POST /merchant/businesses/:businessId/learning/suggestions/:suggestionId/retry` after a failed index; the approved FAQ revision is reused.
- `POST /merchant/businesses/:businessId/learning/suggestions/:suggestionId/dismiss` with an optional safe reason code.
- `GET /merchant/businesses/:businessId/learning/suggestions/:suggestionId/evaluations`.

Approval creates the immutable FAQ revision, generation and durable outbox intent in one transaction. The index worker permits that exact approved revision through a private staging guard. Existing published revision remains live until complete indexing is atomically activated and published. Evaluation compares prior-revision lexical overlap with post-publication retrieval evidence; it does not generate a model answer, so grounding/citation result fields remain null. Related FAQ conflict UX, evaluation worker tests, separate evaluation embedding attribution, and dashboard browser tests remain incomplete. LEARNING-002 is not verified.
