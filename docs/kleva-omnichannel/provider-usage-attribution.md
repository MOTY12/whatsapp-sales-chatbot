# Provider usage attribution

Embedding reservations use the existing `usage_reservations` ledger and share one per-business monthly embedding allowance across indexing, live retrieval and sandbox activity. The ledger category indicates the quota bucket; `usage_purpose` identifies the workload. Evaluation embeddings are attributed as `EVALUATION` and use the playground/sandbox embedding bucket so their quota remains enforced without being counted as live-customer or merchant-playground usage in purpose reports. Historical rows with a null purpose remain `UNATTRIBUTED`; they are not rewritten.

AI generation usage remains separately attributed as `LIVE_CUSTOMER` or `PLAYGROUND`. Each provider call gets its own idempotency key. Provider outcomes that may have incurred charges are retained as `UNCERTAIN`; failures do not automatically release that allowance. Do not infer a provider charge from local token estimates. The dashboard/API aggregate is the source for tenant-level usage reporting.

Evaluation token consumption can be reported independently by filtering `usage_purpose='EVALUATION'`, while quota summaries still combine the embedding categories. No provider price estimate is produced without approved model pricing data.
