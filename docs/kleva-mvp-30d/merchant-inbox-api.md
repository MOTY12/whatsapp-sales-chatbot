# Merchant inbox API

All routes require an authenticated merchant session and an active `owner` or `agent` membership for the path business. The service rechecks membership, active business status and `inbox.operate` permission for every operation. Read requests set `Cache-Control: no-store`. Mutations also require the existing same-origin `Origin` and `X-CSRF-Token` proof.

## Routes

| Method and route | Result |
| --- | --- |
| `GET /merchant/businesses/:businessId/conversations?limit=&cursor=` | Tenant-scoped conversation list and `nextCursor`. |
| `GET /merchant/businesses/:businessId/conversations/:conversationId` | Conversation/customer summary and control state. |
| `GET /merchant/businesses/:businessId/conversations/:conversationId/messages?limit=&cursor=` | Existing inbound/outbound message history. |
| `POST /merchant/businesses/:businessId/conversations/:conversationId/takeover` | Changes AUTO to HUMAN; idempotent if already HUMAN. |
| `POST /merchant/businesses/:businessId/conversations/:conversationId/release` | Changes HUMAN to AUTO; idempotent if already AUTO. |
| `POST /merchant/businesses/:businessId/conversations/:conversationId/replies` | Creates one durable, metered manual text reply. |

Limits default to 30 and are clamped to 1–100. Cursors are opaque base64url values bound to the last row's timestamp and UUID. Lists sort by `(last_activity DESC, id DESC)`; history sorts by `(created_at DESC, id DESC)` to fetch a page, then returns that page oldest-to-newest. `nextCursor` continues to older rows. Invalid cursors and limits return 400. Cross-business resources are returned as 404.

## List and detail fields

List items contain `id`, `customer_name`, `customer_whatsapp_id`, `last_activity`, `preview`, `status`, `control_mode`, `control_version` and `in_flight`. `in_flight` counts outbound provider calls in `SENDING`. The list omits unread count because the current schema has no reliable per-merchant read marker.

Conversation detail contains `id`, customer display name and WhatsApp identifier, conversation `status`, `control_mode`, `control_version`, `control_changed_at`, and `in_flight`.

Message items contain `id`, `direction`, `content`, `status`, `provider_message_id`, `created_at`, `authorization_kind`, and safe `error_classification`. They reuse the existing messages and outbound tables. No provider credentials, raw exceptions or unrestricted internal metadata are returned.

## Control state and replies

Control begins at `AUTO`, version 1. A real mode change increments the version and adds an audit row with actor account, old/new mode and time. Duplicate same-mode requests return the existing version with `changed: false`; concurrent changes serialize. Takeover/release return `{ conversationId, mode, controlVersion, changedAt, changed }`.

A reply request requires JSON `{ "text": "..." }` (1–4096 characters) and an `Idempotency-Key` UUID v4. It is accepted only in HUMAN mode. The response is `{ outboundMessageId, status: "QUEUED" }`; this means the durable intent is accepted, not that Meta has accepted the message. The outbound worker revalidates the tenant's active verified WhatsApp connection and secure credential, the customer's 24-hour messaging window, and the metering reservation before contacting Meta. Quota exhaustion returns 429; invalid content, disconnected route or closed service window returns 400. Retries with the same key and same message return the same outbound ID; conflicting reuse is rejected.

## AI takeover fence

Each automated response intent stores the conversation control version at authorization. Generation and queueing suppress a response if its conversation is in HUMAN mode or the version changed. The outbound worker and mode-change function use the same transaction-scoped PostgreSQL advisory lock for that business/conversation. The worker commits `RESERVED → SENDING` only after checking `AUTO` and the exact captured version. A takeover that commits first suppresses the response, and release cannot revive its old version. If the send claim commits first, the operation is visible as `SENDING`/in-flight; the external provider request is not made in the database transaction and cannot be cancelled once underway. Provider accepted/uncertain state follows the existing WHATSAPP-003 reconciliation process.
