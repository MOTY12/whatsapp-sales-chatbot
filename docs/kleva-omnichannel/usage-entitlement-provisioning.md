# Commercial usage entitlement provisioning

Package allowance snapshots are provisioned through the existing `UsageService` PostgreSQL limit model. No second quota enforcement path is introduced.

- The entitlement manager must have the `kleva_commercial_entitlement_manager` group.
- Provision only after an accepted and operator-approved offer. The function locks the enrollment and business limits row, records the previous and next limits, and is idempotent by `(business_id, idempotency_key)`.
- Limits are applied to the current UTC monthly usage window. Existing consumed and conservatively reserved usage is not reset. Provisioning rejects a new allowance lower than current period reserved/consumed usage for that category.
- Website-only packages set WhatsApp outbound allowance to zero and do not require a WhatsApp connection. WhatsApp package allowance does not imply Meta connection or AI approval.
- The agreed per-request token ceiling uses the existing `ai_tokens_per_request` enforcement. Input/output and embedding caps map to existing limit fields.
- A changed entitlement requires a versioned offer/amendment and explicit owner acceptance under an approved policy; never edit a package snapshot or directly adjust business usage tables.
- Commercial pilot dates do not change the monthly UTC quota reset date. Reaching a quota continues to be enforced by the current UsageService.

If an existing tenant has no usage-limit row, the first commercial provisioning call creates one. Previous limits are recorded as an empty snapshot; verify the approved commercial terms before this first change. No automatic increase or reduction is performed by invoice payment alone.
