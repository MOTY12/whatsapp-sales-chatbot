# Semantic knowledge index (KNOWLEDGE-003)

KNOWLEDGE-003 adds an opt-in semantic index beside the existing published FAQ, product, and PDF lexical searches. `UnifiedKnowledgeRetrievalService` keeps the current published-only lexical functions as its baseline, queries the active generation through pgvector when enabled, then fuses lexical and semantic ranks with reciprocal-rank fusion (constant 60). Exact case-insensitive SKU matches remain authoritative and receive first rank. A semantic score is a retrieval similarity signal, not a factual confidence score. Existing grounding, citation validation, control-state checks, and source freshness fences remain responsible for customer replies.

## Data and indexing

Migration `SemanticKnowledgeIndex1760000000032` adds a fixed `public.vector(1536)` schema, generation and chunk tables, forced RLS, and narrow security-definer procedures. Install pgvector on PostgreSQL 16 using the migration/infrastructure role. The application runtime role receives neither extension installation nor general schema modification grants. CI and local PostgreSQL integration use `pgvector/pgvector:pg16`.

Normal merchant requests can index only published FAQ, product, and document revisions. LEARNING-002 adds a narrow exception for a revision explicitly approved by the tenant's owner/editor: its generation is linked to the exact suggestion ID/version and can be read/written only while that suggestion is `INDEXING` and its FAQ draft/base pointers still match. Staged generations remain excluded from live retrieval because search still requires an `ACTIVE` generation and a published source. Activation atomically publishes that exact FAQ revision, supersedes the previous generation, activates the complete index, and enqueues evaluation. A stale source becomes a publication conflict; failed indexing leaves the prior published revision intact. Normal indexing eligibility remains published-only. See the [learning API](../kleva-mvp-30d/learning-gaps-api.md).

Chunking uses `gpt-tokenizer` cl100k tokenization and deterministic `sentence-cl100k-v1` boundaries. It aims for 500 tokens, caps chunks at 800, overlaps by 80 tokens, keeps FAQ question/answer together when possible, and keeps document chunks within their extracted page. The database retains page number, source offsets, checksum and chunk sequence. Product price, currency, SKU, and availability are carried from the structured published catalog revision and are never generated from vectors.

## Provider and configuration

The provider port validates response model, dimensions, vector count, indexes, and finite vector values. The production adapter calls the OpenAI embeddings endpoint; the deterministic hash-vector adapter is only a test fixture and is not registered in production. Set `OPENAI_API_KEY` in the backend runtime secret store. Never place it in a dashboard variable or log it.

Set `KNOWLEDGE_SEMANTIC_SEARCH_ENABLED=true` only after pgvector, provider credentials, usage limits, and privacy/provider review are ready. Semantic retrieval defaults off. Model and dimension must match the indexed generation; the current schema intentionally accepts only 1536 dimensions. A future dimension change requires a parallel vector column/table and a complete reindex-and-swap migration; changing the environment value alone is rejected.

Other settings are documented in `.env.example`: provider/model, batch size, max tokens per batch, timeout, chunk target/maximum/overlap, worker concurrency, candidate limit, similarity threshold, and the default monthly embedding-token budget. The deployment should provision a PostgreSQL 16 image with pgvector, apply the additive migration with the migration role, and then restart API and worker processes. Semantic failure, provider outage, quota exhaustion, or absent active index falls back to currently published lexical retrieval. No private customer question or document text is logged by the semantic fallback diagnostics.

Indexing, live customer-query, and playground query embeddings have distinct ledger categories but share one per-business monthly embedding-token quota. Learning evaluation uses the playground embedding bucket for quota accounting while its dedicated `usage_purpose=EVALUATION` attribution keeps it separately reportable from actual playground queries and live customers. Provider outcomes that may have incurred a charge are held as uncertain rather than released. Each provider call is separately metered. Index batches are bounded and indexed generations are idempotent. Semantic query embedding uses the current customer question only; the existing bounded context remains available to lexical retrieval and answer generation.

## Merchant operations

Document, FAQ, and product routes expose index status and a CSRF-protected, idempotent reindex action. Status reports generation state, indexed/expected chunk counts, activation time, a safe failure category, and whether the active generation is semantically searchable. The document knowledge screen polls status and offers build/retry/reindex actions without changing publication state. No raw vectors or private object-storage URLs are returned.

Example calls use the existing merchant session and business scope:

```http
GET /merchant/businesses/:businessId/knowledge-documents/:documentId/index-status
POST /merchant/businesses/:businessId/knowledge-documents/:documentId/reindex
Idempotency-Key: <UUIDv4>
```

Equivalent `faqs/:faqId` and `products/:productId` routes are available. Reindexing a business-wide operation list, automatic cleanup of old generations, distinct playground recovery-state guidance, and an operator cleanup runbook are not implemented in this slice and remain follow-up work. The playground shows source citations and links to FAQ/product/document anchors. Old generations are retained; unpublish/delete eligibility checks prevent serving them. Do not enable destructive generation cleanup until retention and audit policy is approved.

## Evaluation and release boundary

`src/knowledge/evaluation/` now contains a versioned, synthetic-only English/Nigerian English/Pidgin dataset, metric aggregation (Recall@1/3/5, MRR, evidence precision, source/revision/SKU attribution, abstention, tenant violations, median/P95 latency and embedding token use), and JSON/Markdown report generation. The adapter runner compares lexical, semantic, and hybrid strategies; deterministic fixture mode is the default test path. Real-provider mode is bounded to 50 cases, requires explicit authorization and a positive token budget, and refuses dispatch when the preflight query budget is too small. CI does not call paid providers. Hash vectors do not measure semantic language quality, and no retrieval improvement is claimed. The runner is a reusable evaluation harness, not a live provider quality result; production data, real-provider evaluation, document storage validation, and production sizing remain external checks.

Check exact SKU behavior, unsupported-question abstention, source attribution, cross-tenant exclusion, and latency before production enablement. Live provider, object-store, browser acceptance, and production sizing remain staging/release checks.
