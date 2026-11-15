# Merchant FAQ API

The FAQ API stores plain-text question and answer revisions for one business. All routes are under `/merchant/businesses/:businessId/faqs`, require a merchant session and an active owner or editor membership, and return `Cache-Control: no-store`. Mutating requests also require the existing same-origin CSRF proof.

## Routes

- `GET /merchant/businesses/:businessId/faqs` lists FAQs using their current draft revision and publication state.
- `GET /merchant/businesses/:businessId/faqs/:faqId` reads one FAQ in that business. A foreign or missing FAQ returns `404`.
- `POST /merchant/businesses/:businessId/faqs` creates draft revision 1. Supply a UUID v4 `Idempotency-Key`, `question` (1–500 characters), and `answer` (1–5,000 characters). Repeating the same key and normalized content returns the existing FAQ; reusing a key for different content returns `409`.
- `PATCH /merchant/businesses/:businessId/faqs/:faqId` appends a revision when content changes. Include `expectedRevision` from the last read; stale edits return `409`. Editing a published FAQ leaves its existing published revision active.
- `POST /merchant/businesses/:businessId/faqs/:faqId/publish` makes the current draft revision active for retrieval. Repeating publication is idempotent.
- `POST /merchant/businesses/:businessId/faqs/:faqId/unpublish` removes the active publication while preserving all revisions. Repeating unpublish is idempotent.

FAQ status is `DRAFT` when no revision is published and `PUBLISHED` when a published revision exists. `revision` identifies the current editable draft. `published_revision` identifies the customer-visible revision or is `null`; `has_unpublished_changes` indicates that the draft differs from the live revision. Create and edit store the supplied strings as text; the dashboard renders them as escaped text, never as HTML.

The database retrieval function `kleva_published_faqs(business_id)` returns only a business's current published revisions and is granted to the service runtime role. It does not return draft or unpublished content. Merchant database roles cannot execute it or read FAQ tables directly. Unified FAQ and product full-text search, its ranking and insufficient-evidence contract are described in [published-knowledge-retrieval.md](published-knowledge-retrieval.md); PDF extraction, chunking and embeddings remain later knowledge tasks.
