# Commercial pilot expiry and suspension policy

## Implemented state handling

The worker calls `kleva_commercial_invoice_status_refresh()` on its hourly maintenance cycle. It marks due, unpaid invoice records OVERDUE and ACTIVE commercial enrollments EXPIRED at their UTC `pilot_end_at`, idempotently and with audit events. Expiry preserves billing history, business data and conversations. There is no automatic renewal or charge.

An operator may currently transition an accepted offer to APPROVED and an approved offer to ACTIVE after confirmed collection and entitlement provisioning. The state machine does not mutate WhatsApp activation records.

## Policy still requiring approval

The product owner must define what overdue, suspended, or expired status does to live AI service, the grace period, human inbox access, merchant dashboard access, data retention, notices and renewal. The code does not disable customer support or AI on expiry because no approved service restriction policy was provided. Until an approved policy is implemented and tested, expiration is authoritative commercial status and audit evidence only; it must not be treated as a production enforcement control.

Renewal/extension requires revised versioned terms and explicit owner acceptance. The current release does not silently extend a pilot or create overlapping entitlements. No data is automatically deleted.
