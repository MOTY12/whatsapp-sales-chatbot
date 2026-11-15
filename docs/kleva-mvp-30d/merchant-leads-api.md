# Merchant Leads API (SALES-001)

All routes require a valid merchant session. Reads are limited to active owner/agent memberships; status updates additionally require the existing CSRF-protected mutation flow. A lead ID is always resolved together with the selected business. A lead from another business therefore returns not found.

## Identity and capture

A lead is one opportunity per `(business_id, conversation_id)`. Two conversations belonging to the same customer are separate leads; repeated verified inbound WhatsApp messages in one conversation update its activity timestamp. We reuse the current customer, conversation and message rows. We do not backfill pre-existing conversations: a lead begins only when a later eligible verified customer message is committed. Owner commands, onboarding messages, invalid/inactive/unverified receipts, outbound messages and delivery receipts do not create leads.

## Routes

- `GET /merchant/businesses/:businessId/leads?limit=30&cursor=...&status=NEW` returns `{ items, nextCursor }`, ordered by `last_activity_at DESC, id DESC`; limit is clamped to 1–100. Status is optional and one of `NEW`, `CONTACTED`, `QUALIFIED`, `WON`, `LOST`.
- `GET /merchant/businesses/:businessId/leads/:leadId` returns the lead, customer name/WhatsApp identifier and conversation ID.
- `PATCH /merchant/businesses/:businessId/leads/:leadId` accepts `{ "status": "CONTACTED", "expectedVersion": 1 }`. It returns the lead ID, current status/version, update time and whether it changed. Repeating the current status is an idempotent no-op; a stale version on a real change returns `409`.

New records start at `NEW`. Inbound activity never resets a merchant-selected status. Status changes and creation are stored in `merchant_lead_events`; message bodies remain in the message history.

## Isolation and future agent use

Composite tenant foreign keys bind the lead to a customer and conversation in the same business. Forced RLS blocks direct access by merchant and identity database roles; fixed-search-path security-definer functions perform the authorized read/update operations under the existing business/account context. The future assistant can use `findLeadForConversation(manager, businessId, conversationId)` from `src/leads/lead-identity.ts` for deterministic read-only lookup. It has no mutation capability.

There is no AI qualification, scoring, conversion analytics or CRM sync in this milestone.
