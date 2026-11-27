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

Approval creates the immutable FAQ revision, generation and durable outbox intent in one transaction. The index worker permits that exact approved revision through a private staging guard. Existing published revision remains live until complete indexing is atomically activated and published. Evaluation now uses a PostgreSQL advisory lock per evaluation run, supports recovery after a worker restart, and records retrieval only when FAQ ID, approved revision ID, and generation ID all match. When no comparable historical index snapshot exists, the before outcome is `COMPARABLE_BASELINE_UNAVAILABLE`; lexical overlap is retained only as a separately labeled diagnostic and is not compared with retrieval as an improvement score. Evaluation embeddings carry `usage_purpose=EVALUATION` and remain inside the shared monthly embedding allowance. This replay does not generate an answer or validate grounding/citations, so those result fields remain null.

Migration `LearningEvaluationRevisionFence1760000000037` adds a narrow runtime-only read function for the exact approved suggestion version/revision/generation and current-publication fence. The worker's per-run advisory lock prevents concurrent duplicate retrieval and usage calls; a process crash releases the lock and a retry can resume the durable `RUNNING` record. Unit and disposable integration coverage now exercises exact provenance, superseded evaluations, retries/lock exclusion, evaluation usage purpose, and publication replay.

The learning dashboard now warns on an exact normalized-question collision with a published FAQ, shows both answers and the published source revision, and allows editing, explicitly approving a replacement, or retaining the existing answer by dismissing the suggestion. This is a deterministic duplicate-question warning, not semantic contradiction detection. Conflicts against documents, product descriptions, business hours, policies, structured price/stock facts, and FAQ questions with different wording are not covered. No full learning/browser acceptance has passed. Do not mark LEARNING-002 verified.
