# Merchant AI playground

The existing `/dashboard/assistant` playground submits a synthetic test question, uses published tenant knowledge and displays the grounded response outcome, citation ordinal/source ID, source type/title, retrieval method, revision, PDF page, and bounded excerpt. FAQ, product and document citations link to the corresponding management page and source anchor. Tool proposals are simulated and the UI states that tests are not saved as customer activity or sent on a channel. Existing request admission and usage limits apply.

The playground does not show hidden model reasoning, vectors or system prompts. Semantic similarity is not presented as confidence. Citation order reflects the grounded source order, not a calibrated relevance score. Distinct UI messages for indexing-in-progress, stale evidence, conflicting evidence, and lexical fallback are not complete. The dashboard and backend service have unit coverage; a full PDF-to-playground-to-learning browser acceptance journey has not passed.

Manual smoke test: publish a synthetic FAQ/product, open Assistant, ask a supported and unsupported question, inspect the evidence details, simulate a tool result, reset the local transcript and confirm the customer/lead fixtures remain unchanged.
