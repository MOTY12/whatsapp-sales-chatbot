# Merchant product catalog API

Products are tenant-owned merchant facts. Management requires an authenticated owner or editor membership and the same-origin CSRF proof for every mutation. Agent members can read the catalog but cannot change or publish it. Every lookup is scoped to the requested business.

## Routes

All routes use `/merchant/businesses/:businessId/products` and return `Cache-Control: no-store`.

- `GET /` lists products with `limit` (default 50, maximum 99) and `offset` (default 0, maximum 10,000). The response is `{ items, limit, offset, hasMore }`. Each item contains the current draft revision plus publication status.
- `GET /:productId` returns the product and current draft revision, including publication metadata.
- `POST /` creates revision 1. Send a UUID v4 `Idempotency-Key`; repeating the same key and payload returns the same product. Reusing the key with different data conflicts.
- `PATCH /:productId` creates a new immutable draft revision. Include `expectedRevision` from the last read; stale edits return `409`.
- `POST /:productId/publish` makes the current draft revision customer-facing. Publishing an unchanged revision is idempotent.
- `POST /:productId/unpublish` removes the product from customer-facing retrieval while preserving its history.

Mutation bodies contain `name` (required, at most 160 characters), `description` (at most 4,000), `sku` (optional, at most 100), `price`, `currency`, and `availability`. Prices are decimal strings with up to two fractional digits, between zero and `999999999999.99`; JSON numbers are rejected to avoid floating-point loss. Use `null` when the merchant has not supplied a price. Currency defaults to `NGN`; supported values are `NGN`, `USD`, `GBP`, `EUR`, `GHS`, `KES`, `ZAR`, `CAD`, and `AUD`. Availability is `IN_STOCK`, `OUT_OF_STOCK`, or `UNKNOWN` and defaults to `UNKNOWN`. The API never infers a missing price or stock state.

Published retrieval is available only to the restricted runtime database role through `kleva_published_products(business_id)`. It returns active-business products at their published revision only; drafts, unpublished products, and other tenants are excluded. Each row includes the tenant and product IDs, published revision ID, customer-facing fields, and publication time. Merchant database roles cannot call this function or access catalog tables directly.

The catalog stores immutable revision history and lifecycle events. A published product may be edited without changing what retrieval returns; the new facts become customer-facing only after explicit publication.

Unified FAQ and product full-text retrieval, including exact SKU matching, relevance thresholds and the restricted runtime database contract, is documented in [published-knowledge-retrieval.md](published-knowledge-retrieval.md).
