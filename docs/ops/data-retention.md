# Data retention and deletion

Current code does not implement scheduled destructive retention cleanup for core conversations, webhook receipts, AI runs, lead audit history or failed outbox operations. Treat those records as retained until an approved merchant/legal policy and deletion workflow are implemented. Do not add a blanket `DELETE` job to staging or production.

Proposed operational defaults for review (not yet policy or legal advice):

- Operational structured logs: 30 days searchable, 90 days archive if needed for incident investigation; exclude customer content and secrets.
- Encrypted database recovery points: daily 35 days and monthly 395 days, subject to merchant agreement, jurisdictional review and documented deletion holds.
- Webhook receipts, messages/conversations, AI response runs, lead events and terminal/failed outbox rows: retain under the approved merchant lifecycle; implement per-tenant deletion and legal holds before setting expiry.
- Security/audit events: retain the minimum period approved by security and applicable obligations; restrict access.

The S3 lifecycle JSON is a proposed bucket rule and must be checked against bucket versioning and legal hold settings before activation. A deletion request must be scoped by tenant, preserve required financial/security evidence, remove eligible rows and derived data, and document backup-expiry behavior. Backup copies age out according to lifecycle rather than immediate per-record deletion; disclose this clearly to merchants.
