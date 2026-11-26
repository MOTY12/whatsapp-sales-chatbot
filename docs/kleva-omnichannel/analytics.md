# ANALYTICS-001 — Merchant analytics

## Status

Implementation remains in progress because the full regression run has two failing suites (conversation-memory assertions and the outbound WhatsApp local-provider fixture). The new analytics browser smoke test passes. The backend uses the operational PostgreSQL database and the existing restricted merchant role. There is no warehouse, Redis cache, pricing table, or external clustering provider. The migration is additive (`1760000000036-MerchantAnalytics`). Costs remain explicitly unavailable because no model-specific pricing configuration exists.

## Request contract

`GET /merchant/businesses/:businessId/analytics?preset=30d&channel=ALL`

- Requires a merchant session and owner/editor membership with `analytics.read`.
- `businessId` is validated by `MerchantAccess`; tenant scope and session identity are set inside a transaction.
- Optional filters: `from=YYYY-MM-DD`, `to=YYYY-MM-DD`, `timezone=<IANA name>`, `channel=ALL|WHATSAPP|WEBSITE`, or `preset=today|yesterday|7d|30d|90d`.
- Custom dates are interpreted in the requested timezone (business timezone by default) and mapped to `[startUtc, endUtc)`; maximum 90 local calendar dates.
- The API response is `Cache-Control: no-store`; it includes range, timezone, definition version, metrics and explicit availability reasons. It contains no message bodies or raw contact identifiers.
- Invalid or partial dates, invalid IANA zones, unsupported channel values and ranges over 90 days are rejected.

## Metric definitions and sources

| Metric | Definition / denominator | Authoritative source and caveat |
| --- | --- | --- |
| Inbound conversations | Distinct tenant conversations with at least one `direction='inbound'` message in the selected time range and channel. | `messages` and `conversations`; webhook/message idempotency is relied upon. |
| Inbound messages | Count of eligible inbound message rows in the range. | `messages`; retry receipts do not create extra rows. |
| Accepted replies | Distinct AI/HUMAN outbound rows in provider-accepted or later delivery states (`ACCEPTED`, `DELIVERED`, `READ`; website `sent`, `delivered`, `read`). | `whatsapp_outbound_messages`, website `messages`; acceptance and delivery are combined in this count. |
| Active conversations | Current non-closed conversations for the tenant/channel, independent of historical selected dates. | Current `conversations.status`. |
| Awaiting response | Current open conversation in the selected cohort where the latest inbound message is newer than its latest accepted public response. | `messages`, accepted outbound records and current conversation status. |
| Resolved/reopened | Status audit events whose `next_value` is closed/resolved or open inside the selected time range. | `conversation_inbox_audit`; repeated valid state changes are separate events. |
| AI-only / human-only / mixed / unanswered | Mutually exclusive conversation cohorts based only on accepted public AI/HUMAN responses after the cohort's first inbound message. `unanswered` has no such accepted response. | `ai_response_runs`, WhatsApp outbound records and website outbound messages; generated-but-unsent answers are excluded. |
| Grounded AI acceptance rate | Accepted linked AI runs with non-empty evidence ÷ eligible generated/queued/completed grounded runs created in range. Null when denominator is zero. | `ai_response_runs` joined to accepted outbound reference. Provider acceptance is not confirmed delivery. |
| First response time | Median of first accepted public response after the selected conversation cohort's first inbound message; observed through current time, even if reply occurred after range end. Negative intervals are excluded by the SQL join. | Inbound `messages` + accepted outbound records. Null when no response qualifies. AI/human variants classify the first response. |
| Handoffs | Count of recorded agent-tool handoff executions plus website visitor handoff requests in range; reason list includes only recorded `agent_tool_handoff_events.reason_code`. | `agent_tool_handoff_events`, `website_handoff_requests`; no inferred human takeover reasons. `awaitingHuman` is current open `control_mode='HUMAN'`. |
| Leads created / qualified / open | Leads created in selected dates/channel; qualification count is the current `QUALIFIED` status within that created-lead cohort; open opportunity count is current NEW/CONTACTED/QUALIFIED status in that same cohort. Qualification rate is current qualified cohort leads ÷ leads created in the cohort. | `merchant_leads`. These are current-state cohort measures, not status-change event counts. Rates are null for an empty cohort. |
| WON/LOST and conversion value | Recorded conversion events in selected dates. Separately, cohort WON rate is leads created in the selected cohort with any WON conversion through report time ÷ leads created in that cohort. WON values recorded in the selected date range are summed exactly and grouped by currency; null values remain unavailable. | `merchant_lead_conversions` joined to lead source. This is merchant-recorded conversion value, not payment verification or revenue recognition. |
| Channel performance | Same conversation, accepted response, response-time, lead and conversion definitions grouped by conversation/lead source channel. | `conversations.channel`, `messages.channel`, `merchant_leads.source`; source is not inferred from WhatsApp presence. |
| Knowledge gaps | Non-expired redacted occurrences and distinct retained clusters last recorded in the selected dates; open/reviewed state is current cluster status. Published suggestions, failed indexing and completed evaluation counts are separate event/run measures. Evaluation counts expose only aggregate case results, not test questions. | `knowledge_gap_occurrences`, `knowledge_gap_clusters`, `learning_suggestion_decisions`, `learning_evaluation_runs/results`. Publication alone is not described as retrieval improvement. |
| Usage consumed | Sum of ledger `consumed_amount` by category and purpose for current UTC quota month. Active reservations and uncertain provider amounts are separate. Historical rows with null purpose are `UNATTRIBUTED`. | `usage_reservations`; embedding category itself distinguishes knowledge indexing, live query and playground embeddings. AI generation purpose is `LIVE_CUSTOMER` or `PLAYGROUND` for new reservations. |
| Remaining allowances | Configured tenant limits or the exact `usageConfig()` defaults, less the quota-counted reservation ledger (`reserved_amount - released_amount`); embeddings share one combined limit. | `business_usage_limits` + same env defaults as UsageService. UTC monthly boundary matches quota enforcement and does not move with report timezone. |
| Estimated model cost | Unavailable with `MODEL_PRICING_NOT_CONFIGURED`; no speculative costs are calculated. | No model-specific effective-dated pricing exists. |
| Staff attribution | Accepted human replies are grouped only by recorded `actor_account_id` (WhatsApp) or `metadata.actorAccountId` (website). Resolved events require actor on the status audit. Per-agent median is first attributed human response after cohort inbound, where history permits. | New replies are recorded after this migration. Older WhatsApp replies have no actor column value and are not retroactively attributed; assignment is never used to infer activity. Staff names come from merchant profile. |

## SQL and performance

`kleva_merchant_analytics(timestamptz,timestamptz,text,text)` is a SECURITY DEFINER function with fixed search path, role verification, tenant GUC filtering, timezone validation and a 91-day hard bound. It calculates aggregates in SQL and reads data through its owning migration role; restricted merchant roles receive function execute only, no raw analytics-table grants. Queries are bounded to 90 dates and current business scope. Output is aggregated JSON and does not include content.

Indexes added by the migration support bounded tenant/time reads over messages, conversations, leads, conversions, handoffs, knowledge occurrences and usage reservations. A disposable PostgreSQL/pgvector integration fixture inserts 1,000 inbound messages and runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on the report function; the latest local run measured 19.593 ms. This is a small fixture sanity measurement, not a representative production volume benchmark or an SLO.

No Redis cache is used; authorized response caching would add tenant invalidation and revocation complexity before measured need exists. Query duration and failure category are logged without business ID, customer text, contact information, or SQL parameters.

## Merchant dashboard

The overview uses a small same-day subset for owner/editor and links to `/dashboard/analytics`. The full analytics page supports presets, custom dates, channel selection, responsive tables, small CSS/SVG-style bar trends, loading skeleton, empty and error states, and explicit unavailable labels. No charting dependency was added. The analytics page performs one aggregate query per server-rendered request; refresh is an explicit new request.

## Local verification (2026-11-25)

`npm test -- --runInBand`: 29 suites / 139 tests passed. Dashboard component tests: 11 files / 38 tests passed. Dashboard typecheck, lint, and production build passed. Playwright browser suite: 26 tests passed, including the analytics page mobile viewport and date/channel filter smoke test. Focused disposable PostgreSQL suites for readiness, baseline migrations, tenant/auth integration, and analytics: 4 suites / 44 tests passed. The full PostgreSQL/Redis integration run completed 20 of 22 suites (137 of 140 tests); the remaining failures are two conversation-memory assertions and one local WhatsApp provider fixture assertion. These failures remain under investigation and are not counted as analytics acceptance passes. The analytics-specific PostgreSQL suite passes 4 tests, including migration rollback/reapply, aggregate query, restricted-role denial, and tenant membership behavior.

## Manual verification

1. Apply migrations with the locked migration runner against a disposable database.
2. Sign in as an owner/editor and visit `/dashboard/analytics`.
3. Select Website chat, WhatsApp and All channels; compare with the matching inbox/conversation and leads records.
4. Submit a custom date range across Lagos midnight and verify report dates use the business timezone.
5. Add a new live AI reservation and a playground reservation; confirm purpose labels, and confirm old null-purpose rows read `UNATTRIBUTED`.
6. Record a WON conversion with an exact value/currency; confirm only same-currency values are shown and payment is not claimed.
7. Verify agents receive 403 and a revoked owner/editor session cannot read the endpoint.

## Current limits

The response combines WhatsApp accepted and later delivered/read states. No separate delivery-confirmed percentage, preaggregated rollup, cost estimate, backfilled historical actor attribution, 90th percentile, or weekly channel cohort is claimed. Team response medians remain unavailable if recorded actor history cannot attribute a first response. This milestone does not satisfy PILOT-001 or QA-002.
