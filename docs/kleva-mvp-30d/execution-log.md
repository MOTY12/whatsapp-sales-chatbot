# December MVP execution log

## November 13, 2026 · TENANT-002

Started from clean `main` at `36968ac5a4e613439a1dbeb9a6aab5a4469b3d88`. That commit adds the omnichannel plan. The previous commit supplies merchant auth, its migration, two restricted roles and the regression tests. The existing V1 evidence identifies TENANT-001 as the most recently verified task before this work.

The initial run passed build, 37 unit tests, three HTTP tests and 33 PostgreSQL/Redis cases. Lint failed on the temporary discovery probe. All 11 auth assertions were blocked in setup by a recursive Jest module mock. A native Node Nest fixture restored real OIDC discovery and exchange. The signed provider also needed to decode form-encoded Basic credentials. The updated PKCE rejection test checks an actual challenge mismatch. Added unit tests for cookie naming and ambiguous cookie rejection, and extended integration coverage for transaction rollback and revocation of the provisioned column grant on migration rollback.

| Command | Result |
| --- | --- |
| `npm run lint:check` | Passed |
| `npm run build` | Passed |
| `npm test` | 39 passed in eight suites |
| `npm run test:e2e` | Three passed with the stubbed WhatsApp service |
| `npm run test:integration` | 44 passed in eight suites, including all 11 signed OIDC and tenant isolation cases |

Used Node 24.22.1, disposable PostgreSQL 16.14 and Redis 8.2.2. The tests verify session rotation, expiry, CSRF and logout, active role and membership checks, concurrent scopes, rollback cleanup, default-deny restricted SQL and legacy repository and outbox behavior. Both valid and invalid callbacks use the real OIDC client. Existing migration and production auth code supplied these behaviors.

TENANT-002 is VERIFIED locally. Hosted Node 22 CI, real provider credentials and deployed browser login remain release checks. Live WhatsApp, a dashboard, customer agent and takeover are pending. The [tracker](progress-tracker.md) identifies the external gates and evidence required.

Next implementation is TENANT-003. Reuse the registration and membership paths to create the business and owner atomically on browser onboarding. Verify rollback and concurrent submissions, scope profile updates to the business and authorized role, and preserve legacy owner paths. Verified claims, invitations and full team management remain broader roadmap scope.

## November 13, 2026 · TENANT-003

Started at clean `main` commit `16ef54935b6c663605625d0f22b659df516a6318`. Reviewed the verified TENANT-002 evidence and reused the merchant session, CSRF and tenant-scope helpers. Added signed-in business creation, profile reads and owner-only profile edits. PostgreSQL commits the account-scoped idempotency receipt, business and owner together. Profile functions expose allowed fields and merge allowed changes without granting access to raw config. The legacy auth detail route shares the profile response.

`AddMerchantOnboarding1760000000005` adds the receipt table and scoped SQL functions, and permits absent WhatsApp routing on disconnected businesses. Apply the migration and rerun `npm run auth:grant` before deploying. See the [API contract](merchant-business-api.md).

| Command | Result |
| --- | --- |
| `npm run lint:check` and `npm run build` | Passed |
| `npm test` | 39 passed |
| `npm run test:e2e` | 3 passed with stubbed WhatsApp |
| `npm run test:integration` | 49 passed, including 5 onboarding cases and legacy registration on the full schema |

The integration run used a signed local OIDC provider, restricted PostgreSQL 16.14 roles and disposable Redis 8.2.2. It covered concurrent retries, account scoping, failed owner insert rollback, unauthorized and invalid writes, provider field preservation, and migration rollback rules. Hosted CI, staging migration and browser/provider verification remain pending.

The December TENANT-003 slice is VERIFIED locally. Claims, invitations, team management and the broader audit workflow remain open in the full roadmap. The next unblocked transport task is CHANNEL-001. The remaining December estimate is 127 hours, plus the original 11-hour contingency.

## November 13, 2026 · CHANNEL-001

Started from clean `main` at `f1f8416a6442601d4bba9ce5b6f825773ec79b8f`. Confirmed local TENANT-003 evidence and reviewed WhatsApp webhook routing, signup persistence, the sender and migration grants. Added a credential-free ChannelConnection table with tenant foreign key, forced RLS, immutable ownership fields and unique provider/asset key across lifecycle states. Backfill imports complete, unambiguous legacy signup evidence and reports conflicting mappings without printing asset IDs or credentials.

The resolver compares connection and legacy mappings in one PostgreSQL statement. Pending and inactive rows fence fallback. Imported rows require current legacy evidence, and unresolved conflicts return no route. The WhatsApp adapter normalizes text and delivery events from a signature-verified envelope for future intake. The existing webhook and sender retain their current behavior. See the [migration notes](../kleva-omnichannel/migration-strategy.md#channel-001-rollout).

| Command | Result |
| --- | --- |
| `npm run lint:check` and `npm run build` | Passed |
| `npm test` | 39 passed |
| `npm run test:e2e` | 3 passed with stubbed WhatsApp |
| `npm run test:integration` | 54 passed in 9 suites, including 5 channel cases |

Verified on Node 24.22.1, disposable PostgreSQL 16.14 and Redis 8.2.2. Covered concurrent asset uniqueness, cross-tenant assignment denial, pending/inactive routes, legacy rotation and conflicts, credential-free lookup, historical link preservation, migration reapply, and legacy owner and onboarding regression. Hosted CI, staging migration and live Meta ownership/subscription validation remain release checks.

CHANNEL-001 is VERIFIED locally. The next implementation task is TENANT-004. The December estimate is 122 hours remaining, plus 11 hours of contingency.

## November 13, 2026 · TENANT-004

Started from clean `main` at `0cb0b8cde7a71b8134233b8493e9f24935df00c6`. Added owner-scoped supervised connection, status, rotation and disconnect. Meta verification checks app, token, permission scopes, WABA phone membership and app subscription before activation. The migration stores tenant and connection-bound AES-256-GCM envelopes, keeps revision fences and writes redacted lifecycle audit events. A secure binding disables fallback to the business's legacy credential. The legacy callback uses supervised setup instead of exchanging codes or persisting plaintext. Existing complete legacy connections remain readable pending supervised migration.

| Command | Result |
| --- | --- |
| `npm run lint:check` and `npm run build` | Passed |
| `npm test` | 40 passed |
| `npm run test:e2e` | 3 passed |
| `npm run test:integration` | 55 passed across 9 suites |

The signed OIDC, local Meta, PostgreSQL 16 and Redis fixtures verify authorized connection, denied cross-tenant access, concurrent duplicate handling, encrypted storage, successful and failed rotation, revoked/disconnected sends, legacy fallback fencing, and existing owner commands. Unit tests verify ciphertext tamper rejection, tenant/connection binding and key rollover.

The December supervised implementation is VERIFIED locally. Approved Meta assets, staging subscription and live send verification, runtime grants and keyring provisioning remain release gates. See the [API and deployment instructions](whatsapp-connection-api.md). WHATSAPP-001 is next. The remaining estimate is 110 implementation hours plus 11 hours of contingency.

## WHATSAPP-001 · Signed durable webhook intake

Started from clean `main` at `774a9f977d8f48625e40d75ae961ac29a5e68158`. Reused the existing resolver, WhatsApp normalizer, PostgreSQL outbox and BullMQ runtime. The route verifies HMAC on bounded raw bytes before JSON parsing. Each eligible batch commits tenant-scoped receipts and their outbox intents before HTTP 200. A failed transaction returns 503. Unroutable events are discarded as documented in the [intake guide](whatsapp-webhook-intake.md). The worker marks a receipt ready for downstream processing.

| Command | Result |
| --- | --- |
| `npm run lint:check` and `npm run build` | Passed |
| `npm test` | 40 passed |
| `npm run test:e2e` | 3 passed |
| `npm run test:integration` | 59 passed in 10 suites |

Local integration used real PostgreSQL and Redis plus signed fixtures. It covered raw tampering, missing secret, size limits, GET challenge, concurrent duplicate messages and statuses, multi-tenant batches, WABA mismatch, inactive assets, rollback, unavailable Redis and replay. Existing owner command logic still passes its direct regression. WHATSAPP-002 must restore downstream handling through the worker before live cutover. Live Meta and staging remain unverified. The remaining estimate is 102 implementation hours plus 11 hours of contingency.

## November 14, 2026 · WHATSAPP-002

Started at clean `main` commit `953e3cec0ca625d2aca9101ed60eb82a88044b2f`. Replaced the receipt-only handoff with transactional inbound processing in the existing outbox worker. The handler validates the receipt, active verified connection, and tenant relationship; reuses or creates a business-scoped customer and conversation; inserts one provider-ID-deduplicated inbound message; and records the receipt outcome with outbox completion. The handler does no external network work.

The new additive migration `ProcessWhatsAppReceipts1760000000009` adds receipt processing state, tenant composite keys, and a `whatsapp_response_intents` table. Owner classification requires an active owner membership with an exact verified WhatsApp ID. Legacy onboarding sessions are classified separately. Both create a pending response intent for WHATSAPP-003; actual assistant responses and delivery are not part of this phase. Delivery events reconcile only matching outbound messages and preserve unmatched status receipts. Statuses cannot downgrade a delivered, read, or failed message.

| Command | Result |
| --- | --- |
| `npm run lint:check` | Passed |
| `npm run build` | Passed |
| `npm test` | 40 passed in 9 suites |
| `npm run test:e2e` | 3 passed |
| `npm run test:integration` | 64 passed in 10 suites against disposable PostgreSQL 16 and Redis 7 |

Integration evidence covers duplicate signed intake, tenant joins, verified owner classification, onboarding classification, customer reuse, matching and unmatched delivery statuses, rollback of partial processing, bounded retries and visible terminal failure. Existing outbox tests cover Redis outage recovery and restart/redelivery; migration tests validate the new foreign keys and rollback protections. Live Meta verification, pending response delivery, and outbound reconciliation remain release work. WHATSAPP-002 is VERIFIED locally. The remaining implementation estimate is 94 hours plus 11 contingency hours. The next task is METER-001, then WHATSAPP-003 for pending response delivery and complete outbound reconciliation.

## November 14, 2026 · METER-001

Started at clean `main` commit `04712363e84f494569d5e12208ce9f78977b3009`. Added PostgreSQL tenant limit overrides and a usage ledger for `whatsapp_outbound`, `ai_input_tokens`, and `ai_output_tokens`. Default caps are configurable with `USAGE_DEFAULT_MONTHLY_WHATSAPP_MESSAGES`, `USAGE_DEFAULT_MONTHLY_AI_INPUT_TOKENS`, `USAGE_DEFAULT_MONTHLY_AI_OUTPUT_TOKENS`, and `USAGE_DEFAULT_AI_TOKENS_PER_REQUEST`. Periods use UTC calendar months. Tenant limit changes are internal-only, and cannot lower monthly caps below usage already committed or reserved.

`UsageService` provides `reserveWhatsAppMessage`, `reconcileWhatsAppStatus`, `reserveAiTokens`, `commitAiTokens`, `releaseAiTokens`, `getUsageSummary`, `getRemainingAllowance`, and expired-reservation recovery. PostgreSQL advisory transaction locks serialize reservations and configuration changes by tenant/category; uniqueness constraints enforce per-business/category idempotency. AI calls reserve a bounded input/output budget before the external call, then commit actual amounts and release unused capacity. Missing model usage metadata charges the full reservation. An actual overrun is rejected while the reservation stays held. WhatsApp provider acceptance consumes one message; definitive failure releases it, delivery confirmation keeps it consumed, and unknown or expired operations become `UNCERTAIN` and retain their hold. No Redis counter is used for metering.

Migration `AddTenantUsageLedger1760000000010` adds `business_usage_limits` and `usage_reservations`, business foreign keys, indexes, checks and internal-only RLS policies. Merchant and identity database roles have no access to the tables. Rollback refuses when any tenant limits or ledger records exist. The sender and model clients are not wired to reservations in this phase; WHATSAPP-003 and the later AI integration must call this contract.

| Command | Result |
| --- | --- |
| `npm run lint:check` | Passed |
| `npm run build` | Passed |
| `npm test` | 41 passed in 9 suites |
| `npm run test:e2e` | 3 passed |
| `npm run test:integration` | 75 passed in 11 suites against disposable PostgreSQL 16 and Redis 7 |

The metering integration suite verifies quota boundaries and concurrency, duplicate reservations, repeated commits, AI reconciliation and release, overrun rejection, conservative missing metadata, uncertain and definitive WhatsApp outcomes, UTC rollover, tenant isolation, simulated Redis unavailability, restart recovery, expired reservations, negative amounts, and merchant-role denial. The broader integration suite retains WhatsApp intake, owner-command and outbox recovery regressions. METER-001 is VERIFIED locally. Hosted CI and deployment of environment defaults remain release checks. The remaining implementation estimate is 89 hours plus 11 contingency hours. The next task is WHATSAPP-003, which should reserve usage before sends and reconcile provider outcomes through the same idempotency key.

## November 14, 2026 · WHATSAPP-003

Started from clean `main` at reviewed commit `77b7a717b25831984f9d893e52fe188acdcdd08d`. Added `whatsapp_outbound_messages` with tenant, verified connection, conversation and message references; logical idempotency; reserved usage key; provider ID; attempt metadata; and explicit `RESERVED → SENDING → ACCEPTED/DELIVERED/READ/FAILED/UNCERTAIN` lifecycle. Each outbound message and minimal outbox reference are committed before any provider call. Queue payloads contain only the outbound UUID.

The worker rechecks the tenant business, active verified connection, encrypted credential eligibility, and the 24-hour customer-service window before sending. It makes the Meta call outside a database transaction. Provider acceptance consumes the existing METER-001 reservation; a definitive synchronous rejection releases it; a timeout or worker restart while `SENDING` marks the record `UNCERTAIN` and keeps the hold. A repeated job never resends an accepted or uncertain message. Because Meta does not promise send idempotency, uncertain messages require an operator to inspect provider history and call the guarded `OutboundMessageService.resolveUncertain` operation. Provider delivery failure remains charged after acceptance.

Receipt processing now matches by tenant, connection and provider message ID. Duplicate and out-of-order statuses are monotonic; unmatched receipts are retained in `whatsapp_unmatched_statuses` and replayed when the send result provides its ID. Owner-command and legacy-onboarding response intents now get a separate durable generation step and outbound job. Generated text is saved before enqueue; an interrupted generation is fenced for review rather than rerun, preventing repeated assistant actions. Customer inquiries remain stored without automated AI responses. No approved template sender exists yet, so free-form text is blocked outside the 24-hour window.

The additive migration `DurableWhatsAppOutbound1760000000011` adds the tenant-scoped outbound and unmatched-status tables, foreign keys, indexes, RLS, the worker-only membership read policy, and response-intent generation state. Existing receipts, conversations, messages and usage rows are preserved; rollback refuses once outbound history or progressed response intents exist. Merchant and identity roles cannot query the new internal tables.

| Command | Result |
| --- | --- |
| `npm run lint:check` | Passed |
| `npm run build` | Passed |
| `npm test` | 41 passed in 9 suites |
| `npm run test:e2e` | 3 passed |
| `npm run test:integration` | Pending final run against disposable PostgreSQL 16 and Redis 7 |

Outbound integration coverage includes the local Meta HTTP fixture and encrypted tenant credential, quota-before-send, acceptance, definitive and ambiguous failures, duplicate and concurrent logical sends, quota exhaustion, disconnected channels, expired windows, worker restart, owner and onboarding dispatch, monotonic delivery callbacks and unmatched-status replay. Existing suites cover Redis outage recovery, signed intake, migration rollback, tenant isolation and metering regression. Live Meta behavior, approved template delivery, hosted CI, staging migration/permissions and operations monitoring remain production blockers. WHATSAPP-003 is locally implemented. Remaining MVP estimate: 78 hours plus 11 contingency hours. Next task: INBOX-001.
