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
| `npm run test:integration` | 83 passed in 12 suites against disposable PostgreSQL 16 and Redis 7 |

Outbound integration coverage includes the local Meta HTTP fixture and encrypted tenant credential, quota-before-send, acceptance, definitive and ambiguous failures, duplicate and concurrent logical sends, quota exhaustion, disconnected channels, expired windows, worker restart, owner and onboarding dispatch, monotonic delivery callbacks and unmatched-status replay. Existing suites cover Redis outage recovery, signed intake, migration rollback, tenant isolation and metering regression. Live Meta behavior, approved template delivery, hosted CI, staging migration/permissions and operations monitoring remain production blockers. WHATSAPP-003 is locally implemented. Remaining MVP estimate: 78 hours plus 11 contingency hours. Next task: INBOX-001.

## November 14, 2026 · INBOX-001

Implemented authenticated merchant conversation APIs under `/merchant/businesses/:businessId/conversations`: list with stable descending `(updatedAt,id)` cursor pagination, conversation detail, paginated message history, takeover, release, and manual text replies. Read routes require an active owner or agent membership; mutating routes additionally require the existing same-origin CSRF proof. Tenant-scoped `SECURITY DEFINER` functions run through the restricted merchant database role, which receives only explicit function grants. No direct merchant grants to message, outbound or audit tables were added. Preview/history responses use existing `messages` and outbound records, expose safe status classifications, and set `Cache-Control: no-store`. Contracts and cursor details are recorded in [merchant-inbox-api.md](merchant-inbox-api.md).

Migration `MerchantInbox1760000000012` adds default-AUTO conversation control fields (mode, monotonic bigint version, actor, takeover time and mode-change time), tenant-scoped control audit rows, captured response-intent versions, outbound authorization kind/version, indexes and narrowly scoped inbox functions. Existing rows retain AUTO/version 1. Every actual mode transition records the actor and new version; repeated same-mode requests are idempotent. Page sizes are 1–100 with a default of 30. Message pages are returned oldest-to-newest within each page; the opaque cursor continues toward older records. Unread counts are omitted because there is no existing reliable per-merchant read marker.

AI response intents capture the conversation version when their inbound intent is persisted. Before generation and again before queueing, response dispatch suppresses an intent if the mode is HUMAN or the version changed. The outbound worker uses the same advisory transaction lock key as takeover/release. It locks and reads the current conversation state, and atomically transitions an eligible AI outbound row from RESERVED to SENDING only when the mode is AUTO and its captured version still matches. The short authorization transaction commits before Meta I/O. If takeover commits first, the worker suppresses the AI intent, including after a later release because the version remains stale. If the worker obtains the fence first, SENDING is durable and visible as in-flight; a provider request already underway cannot be cancelled, and its outcome continues through the existing accepted/uncertain reconciliation path. Human-authored replies bypass the AI fence while still using the existing tenant connection checks, 24-hour messaging-window check, durable outbox and usage reservation.

| Command | Result |
| --- | --- |
| `npm run lint:check` | Passed |
| `npm run build` | Passed |
| `npm test` | 41 passed in 9 suites |
| `npm run test:e2e` | 3 passed |
| `npm run test:integration` | 88 passed in 12 suites against disposable PostgreSQL 16 and Redis 7 |

Integration evidence covers owner/agent authorization, cross-tenant denial, list and history pagination, duplicate and concurrent control changes, audit writes, manual reply idempotency and history visibility, AI suppression on takeover, stale suppression after release, takeover winning against a waiting send claim, an already-started provider request remaining visible as SENDING, manual delivery in HUMAN mode, migration rollback/reapply and the existing webhook/outbound/usage suites. The local Meta HTTP fixture is used; no live customer account or provider credentials were used. Hosted CI and staging/live Meta proof remain release checks. INBOX-001 is VERIFIED locally. Remaining MVP estimate: 69 hours plus 11 hours of contingency. Next task: INBOX-002.

## November 14, 2026 · DASHBOARD-001

Added `apps/merchant-dashboard`, a standalone Next.js App Router, TypeScript and Tailwind application. The NestJS server and its OIDC/session contracts remain authoritative. The same-origin login route forwards Nest's short-lived binding cookie to the dashboard origin before the identity-provider redirect; the callback bridge forwards callback cookies and query to Nest, relays session/CSRF cookies to the browser, and returns to the dashboard. Server Components use a server-only typed API client that forwards cookies, disables caching, applies request timeouts, retries only transient safe GETs, and attaches the backend-required Origin and CSRF proof to mutations.

Implemented an authenticated responsive shell, membership-scoped business selection, idempotent business setup, owner-only profile editing, logout, setup overview, live WhatsApp status and supervised provisioning guidance. WhatsApp credentials are never collected or displayed; the safe status API does not expose a phone number, so the UI does not mislabel a Meta phone-number asset ID as one. Conversations, Knowledge Base, Products and Leads have honest placeholders. Setup, API and local test instructions are in [merchant dashboard README](../../apps/merchant-dashboard/README.md).

| Command | Result |
| --- | --- |
| `npm run lint:check` | Passed |
| `npm run build` | Passed |
| `npm test` | 41 passed in 9 suites |
| `npm run test:e2e` | 3 passed |
| `npm run test:integration` | Could not run: `KLEVA_TEST_PG_DATABASE` is not set to the required `kleva_integration_control`; PostgreSQL integration cases did not execute successfully in this environment |
| Dashboard lint/typecheck/build | Passed |
| Dashboard component tests | 4 passed |
| Dashboard browser smoke | 2 passed: OIDC cookie bridge, onboarding, CSRF profile edit, safe GET retry, pending WhatsApp, logout, invalid business selection and mobile navigation |
| `npm audit` / `npm audit --omit=dev` | 0 vulnerabilities after updating Vitest and the vulnerable transitive minimatch dependency |

Browser journeys use a local API fixture and do not establish real identity-provider behavior. Configure the production OIDC callback to the dashboard origin and verify login, session expiry and cookie policy in staging; hosted CI remains outstanding. DASHBOARD-001 is VERIFIED locally. Remaining MVP estimate: 61 hours plus 11 hours of contingency. Next task: INBOX-002.

## November 14, 2026 · INBOX-002

Replaced the Conversations placeholder with a responsive merchant inbox. The server-rendered page derives business choices from the authenticated owner/agent memberships and loads the first opaque-cursor page through the server-only API client. A same-origin `/api/inbox` Route Handler proxies history and mutations without exposing backend credentials; it checks the dashboard Origin and CSRF cookie/header pair for POSTs, while Nest continues to enforce membership, tenant scope, takeover state, messaging window and usage metering. The client supports cursor pagination for conversations and older messages, chronological message display with scroll restoration, AUTO/HUMAN takeover and release, a 4096-character manual composer, one UUID v4 idempotency key per logical draft, queued acknowledgement, and 8-second selected-thread plus 20-second list polling. QUEUED is displayed separately from later provider delivery states; safe labels replace internal provider classifications. Switching business remounts the inbox to clear prior tenant data.

Added local Playwright fixtures and browser journeys for conversation list/history, older-message pagination, takeover, one queued reply despite a repeated click, delivery polling, quota/disconnected/closed-window failures with draft retention, empty inbox, foreign tenant denial, business switching, mobile navigation, session expiry, and the existing onboarding journeys. The fixture simulates delivery status changes and does not establish real Meta delivery. Component presentation tests cover status labels, safe failure copy and message merging.

| Command | Result |
| --- | --- |
| `npm run dashboard:lint` | Passed |
| `npm run dashboard:typecheck` | Passed |
| `npm run dashboard:test` | 4 passed |
| `npm run dashboard:build` | Passed |
| `npm run dashboard:test:browser` | 8 passed (6 inbox journeys and 2 existing dashboard journeys) |
| `npm run lint:check` | Passed |
| `npm run build` | Passed |
| `npm test` | 41 passed in 9 suites |
| `npm run test:e2e` | 3 passed |
| `npm run test:integration` | Could not run: `KLEVA_TEST_PG_DATABASE` is not set to the required `kleva_integration_control`; PostgreSQL integration cases did not execute successfully in this environment |

INBOX-002 is VERIFIED locally against the local HTTP fixture. Staging identity-provider and live Meta send/reconciliation evidence, hosted CI and the PostgreSQL integration run remain release work. Remaining MVP estimate: 55 hours plus 11 hours of contingency. Next task: KNOWLEDGE-001 / KNOWLEDGE-004, publishing and editing merchant FAQs.

## November 15, 2026 · KNOWLEDGE-001 / KNOWLEDGE-004 (FAQ slice)

Reviewed the current `main` checkout at `0bc7af8` and preserved the existing inbox work. Added a new tenant-scoped PostgreSQL FAQ schema with immutable numbered revisions, a draft pointer and a separately controlled published pointer, append-only lifecycle events, idempotent creation, and owner/editor-only management functions. Added merchant FAQ list/detail/create/edit/publish/unpublish routes with CSRF protection, optimistic revision checks, and safe error mapping. Added a restricted service retrieval function that returns only currently published revisions. The merchant dashboard now has a responsive FAQ editor, explicit publication controls, a same-origin API proxy, and fixture-backed journeys. API behavior is documented in [merchant-knowledge-api.md](merchant-knowledge-api.md).

This completes the plain-text FAQ portion of KNOWLEDGE-001 and the FAQ management portion of KNOWLEDGE-004. PDF upload/extraction and chunking/embeddings remain KNOWLEDGE-002 and KNOWLEDGE-003; retrieval grounding remains RAG-001/002.

| Command | Result |
| --- | --- |
| `npm run lint:check` / `npm run build` | Passed |
| `npm test` / `npm run test:e2e` | 41 unit tests in 9 suites; 3 end-to-end tests passed |
| `npm run test:integration` | 89 passed across 12 suites using disposable PostgreSQL and Redis; includes FAQ migration, role/tenant isolation, revision conflicts, publish/edit/unpublish and published-only retrieval |
| `npm run dashboard:lint` / `npm run dashboard:typecheck` / `npm run dashboard:build` | Passed |
| `npm run dashboard:test` | 5 passed |
| `npm run dashboard:test:browser` | 12 passed, including FAQ lifecycle, literal-text safety, tenant switching, access denial, service failure and expired session |

KNOWLEDGE-001 and the FAQ slice of KNOWLEDGE-004 are VERIFIED locally. Hosted CI and staging checks remain release work. Remaining MVP estimate: 47 hours plus 11 hours of contingency. Next task: CATALOG-001.

## November 15, 2026 · CATALOG-001

Reviewed the clean `main` checkout at `41aac6d` and preserved the completed FAQ implementation. Added an additive PostgreSQL catalog migration with tenant-scoped product records, immutable numbered revisions, idempotent creation, optimistic edits, append-only lifecycle events and explicit publish/unpublish pointers. Owner/editor functions enforce business scope; merchant roles cannot directly query catalog tables. A restricted runtime function returns only published revisions for active businesses. Price is stored as `numeric(14,2)` and accepted only as a decimal string or `null`; availability remains explicit, including `UNKNOWN`.

Added authenticated merchant catalog APIs, the same-origin dashboard proxy, a responsive product editor, and published-only retrieval integration. The dashboard supports pagination, exact price entry, currency selection, explicit stock state and review of unpublished changes. Route shapes, limits, supported currencies, decimal rules and retrieval access are documented in [merchant-catalog-api.md](merchant-catalog-api.md). Existing FAQ and product lifecycle tests cover parallel publication workflows.

| Command | Result |
| --- | --- |
| `npm run lint:check` / `npm run build` | Passed |
| `npm test` / `npm run test:e2e` | 41 unit tests in 9 suites; 3 HTTP end-to-end tests passed |
| `npm run test:integration` | 90 passed across 12 suites using disposable PostgreSQL 16 and Redis; includes catalog access control, tenant isolation, idempotency, revision conflicts, exact decimal storage, publication, unpublication and restricted retrieval |
| Dashboard lint / typecheck / component tests / build | Passed; 6 component tests passed |
| `npm run dashboard:test:browser` | 17 passed, including five product journeys for lifecycle, decimal price, tenant/role access, failure/session expiry and mobile layout |

CATALOG-001 is VERIFIED locally. Hosted CI and staging checks remain release work. Remaining MVP estimate: 42 hours plus 11 hours of contingency. Next task: RAG-001.

## November 15, 2026 · RAG-001

Reviewed the clean `main` checkout at `54f28cc` and reused the FAQ and product published-revision pointers introduced by KNOWLEDGE-001 and CATALOG-001. Added an additive TypeORM migration with generated `simple`-configuration search vectors on existing FAQ/product revision tables, GIN indexes and a normalized exact-SKU btree index. No second knowledge store, vector database, embedding pipeline, HTTP search endpoint or model call was added.

The internal `UnifiedKnowledgeRetrievalService` combines FAQ and product evidence through a parameterized PostgreSQL security-definer function. Search is scoped to one active business and joins only each source's current published revision. Exact question/name/SKU matches rank first; weighted `websearch_to_tsquery` and `ts_rank_cd` rank other matches with a stable bounded order and a `0.035` threshold. Empty content, no match and low relevance produce explicit insufficient-evidence reasons. Product price stays an exact decimal string or `null`; currency and availability retain their published values. The merchant and identity database roles cannot execute the search function or read revision tables. Ranking, text-search configuration, role boundary, publication semantics and limits are documented in [published-knowledge-retrieval.md](published-knowledge-retrieval.md).

| Command | Result |
| --- | --- |
| `npm run lint:check` / `npm run build` | Passed |
| `npm test` | 43 passed across 10 suites |
| `npm run test:e2e` | 3 passed |
| `npm run test:integration` | 97 passed across 13 suites with disposable PostgreSQL 16 and Redis 7; includes seven retrieval cases and all existing tenant, migration, webhook, inbox and outbox regressions |
| Dashboard lint / typecheck / component tests / build | Passed; 6 component tests passed |
| `npm run dashboard:test:browser` | 17 passed; includes the existing inbox, knowledge, onboarding and product journeys |

The fixture exercises `EXPLAIN (ANALYZE, BUFFERS)` and confirms the search indexes exist. PostgreSQL chooses a sequential scan on these small test tables, so production plan selection and latency still need measurement with pilot-sized data. RAG-001 is VERIFIED locally. Hosted CI and staging remain release gates. Remaining MVP estimate: 37 hours plus 11 hours of contingency. Next task: RAG-002 / AGENT-001 claim-level grounding and abstention.

## November 15, 2026 · SALES-001

Reviewed the SALES-001 prompt against the clean `854f8eb` checkout and preserved the existing durable WhatsApp receipt processor, customer/conversation/message model, owner/onboarding classification, inbox, catalog and retrieval paths. Added an additive tenant-scoped lead table and status-event audit table. A lead is uniquely identified by `(business_id, conversation_id)`: distinct conversations from one customer are distinct opportunities. No historical rows are backfilled; an eligible verified customer text message creates or activity-updates its conversation's lead in the same worker transaction as message persistence. Owner commands, onboarding messages, inactive businesses/connections, unverified input, delivery receipts and outbound messages do not create leads.

Added owner/agent-only tenant-safe list/detail/status APIs with opaque cursor ordering, status filtering, version checks, idempotent repeated status updates and audited transitions. The dashboard now provides status filtering and cursor paging, customer/source/activity details, status editing and a link that opens the source inbox thread. Customer message history remains the system of record. A read-only `findLeadForConversation` contract is available to the later assistant phase.

| Command | Result |
| --- | --- |
| `npm run lint:check` / `npm run build` | Passed |
| `npm test` | 43 passed across 10 suites |
| `npm run test:e2e` | 3 passed with loopback permission enabled |
| `npm run test:integration` | 98 passed across 13 suites with disposable PostgreSQL 16 and Redis 7; a first run had one transient usage-metering timeout, which passed both in isolation and on the complete rerun |
| Focused PostgreSQL/Redis integration | 33 passed across migration, webhook and tenant-auth suites; tenant-auth includes lead list/detail, cross-tenant denial, audited status update, idempotent repeat, concurrent version conflict and audit count |
| Dashboard lint / typecheck / component tests / build | Passed; 9 component tests passed |
| `npm run dashboard:test:browser` | 18 passed, including lead capture display, status update, conversation navigation and existing dashboard journeys |

The migration intentionally has no conversation backfill. Existing pre-migration conversations receive a lead only after a later eligible inbound customer message. SQL and API contracts are documented in [merchant-leads-api.md](merchant-leads-api.md). SALES-001 is VERIFIED locally. Hosted CI and staging remain release checks. Remaining MVP estimate: 32 hours plus 11 hours of contingency. Next task: RAG-002 / AGENT-001 grounded replies and safe abstention.

## November 15–16, 2026 · RAG-002 / AGENT-001

Reviewed the current `main` checkout at `cdbdfcf` and reused the signed webhook receipt transaction, PostgreSQL outbox worker, published-only `UnifiedKnowledgeRetrievalService`, token/message `UsageService`, WhatsApp outbound pipeline, AI control-version fence, conversation inbox and SALES-001 lead records. No external model call runs in the webhook transaction. For eligible verified customer text messages, the receipt transaction now inserts one `ai_response_runs` row and one UUID-only `whatsapp.ai_response` outbox intent. A unique business/inbound-message constraint and stable run ID make duplicate receipt and worker execution replay-safe. Owner/onboarding classifications and conversations not in AUTO mode do not receive AI work.

The independent assistant worker validates business, active verified WhatsApp connection, AUTO mode and authorized conversation version before retrieval and again before outbound enqueue. It retrieves only the active business's published FAQ/product revisions, reserves bounded tenant token allowance before one OpenAI-compatible chat-completions call, reconciles reported usage and saves evidence source/revision IDs. The configured default is disabled. Model key, model name, timeout, and fallback message come from centralized environment configuration; retry is limited to one additional transient provider attempt with jitter. No tools, browsing, CRM mutation, or free-form conversation history are exposed. Server-side checks reject unreferenced evidence, weak evidence overlap, changed or unpriced amounts, currency mismatches, unknown stock claims, unsupported discounts and delivery promises. Missing evidence, invalid output, provider/quota/policy failures result in a recorded handoff or blocked outcome. The merchant inbox exposes the handoff-needed state. AI replies still pass through the existing durable, metered WhatsApp outbound path and takeover/send fence.

The `ai_response_runs` migration is additive and RLS-protected. Lifecycle logging uses safe business/conversation/message/run identifiers and error classifications, without customer message bodies or credentials. Retries of an already generated run preserve its handoff classification, and PostgreSQL advisory locking prevents concurrent workers from generating twice for the same conversation/run. A real-PostgreSQL integration covers published product grounding with exact NGN price, token reconciliation, duplicate concurrent execution, metered outbound intent creation, deterministic WhatsApp fixture send and delivery receipt reconciliation. A no-match delivery question creates a durable fallback handoff without invoking the model. Existing webhook, outbox, metering, inbox and outbound integration suites cover their adjacent boundaries.

| Command | Result |
| --- | --- |
| `npm run lint:check` / `npm run build` | Passed |
| `npm test -- --runInBand` | 60 passed across 13 suites |
| `npm run test:e2e -- --runInBand` | 3 passed |
| `npm run test:integration -- --runInBand --silent` | 100 passed across 14 suites with disposable PostgreSQL 16 and Redis 7 |
| `npm run dashboard:lint` / `npm run dashboard:typecheck` / `npm run dashboard:test` | Passed; 9 component tests |
| Dashboard production build and Playwright fixture suite | Passed in isolated temporary checkout; 18 browser tests. Isolation avoided the existing local Next dev server's shared output lock. |

RAG-002 / the requested initial AGENT-001 WhatsApp response slice is VERIFIED locally. The broader omnichannel AGENT-001 remains in progress for bounded conversation memory, typed tools and tenant-level activation; the merchant-side synthetic playground in the wider RAG-002 roadmap also remains open. Hosted CI, an approved pilot opt-in, real model-provider behavior, live Meta assets/templates, staging OIDC and delivery/recovery proof remain release gates. Remaining MVP estimate: 21 hours plus 11 hours of contingency. Next recommended engineering task: OPS-001 / OPS-002 pilot deployment and recovery (7 hours); start POLICY-001 provider eligibility review in parallel because it depends on external approval evidence.

## November 16, 2026 · OPS-001 / OPS-002

Prepared a single-host pilot deployment with Caddy, separate API/worker/dashboard containers, private Redis, external TLS PostgreSQL, health checks, bounded container privileges, and documented migration/runtime/backup database roles. Added an advisory-locked migration runner, production configuration checks for OIDC, WhatsApp keyring and Redis credentials, worker readiness heartbeat and safe shutdown behavior. Added operations SQL, alert thresholds and response actions, incident/rollback/data-retention guidance, SSM environment rendering, age-encrypted S3 backup scripts, a disposable-only restore guard, and a timed systemd backup unit. AI remains disabled by default.

| Command / check | Result |
| --- | --- |
| `npm run lint:check` | Passed; one existing warning in `test/integration/outbox.spec.ts` |
| `npm run build` | Passed |
| `npm test -- --runInBand` | 63 passed across 13 suites |
| `npm run test:e2e -- --runInBand` | 3 passed |
| `npm run test:integration -- --runInBand --silent` | 100 passed across 14 suites with PostgreSQL 16 and Redis 7 fixtures |
| `docker compose -f deploy/compose.yaml config --quiet` | Passed |
| Caddy config validation | Passed in a disposable container |
| Backend and dashboard production image builds | Passed against the current package lock; dashboard health endpoint returned `200:ok` in a container |
| Local disposable PostgreSQL custom dump/restore | Passed for a tiny fixture; reported 0 seconds. No age/S3/KMS/cloud path was exercised. |
| Latest isolated Node 22 Playwright run | 11 passed, 7 failed; repeated Next dev fixture JSON/runtime errors. Hosted CI has not run. |
| Production dependency audit | Last successful online audit: 3 moderate, 0 high, 0 critical production advisories. A final audit attempt was blocked by unavailable registry DNS. CI now runs `npm audit --omit=dev --audit-level=high`. |

Live staging/deployment is BLOCKED: no staging identity, approved Meta assets, domain, AWS credentials/resources, SSM/S3/KMS configuration or assigned on-call were available. The local AWS CLI also fails during startup due to a Python `pyexpat`/libexpat symbol mismatch, and `age` is not installed locally. Therefore the encrypted off-host backup, real alert delivery, certificate issuance, and restore timing remain unverified. OPS artifacts are locally prepared; hosted CI/browser repair and staging evidence remain release gates. No cloud deployment was attempted.

## November 16, 2026 · QA-001 / Regression stabilization

Reviewed HEAD `9397fefb7ee5e019d198c9aac3107045fad76d17`, the OPS execution evidence and the existing browser, backend, PostgreSQL/Redis, deployment and worker tests. The previous seven Playwright failures were caused by concurrent Next servers in the same dashboard checkout sharing the default `.next` output: the pre-existing developer server on port 3001 and the test server on 3101 could overwrite manifests and incremental runtime state. This produced empty/invalid manifest reads and secondary fixture JSON/runtime errors. The fixture handlers did not reproduce the failure after output isolation.

Playwright now gives each invocation a PID-scoped Next `distDir` via `KLEVA_NEXT_DIST_DIR`. The normal production build continues to use `.next`. Its launcher restores `next-env.d.ts` and `tsconfig.json` after the run only when their differences are exactly the generated type paths for that run; it leaves unexpected concurrent edits untouched. ESLint ignores custom generated Next output, `.gitignore` excludes it, and TypeScript excludes `.next-*` generated paths. No tests were skipped, weakened or given extra retries. The full 18-test suite passed four consecutive local runs after isolation.

The existing real-PostgreSQL/Redis suites cover the end-to-end slices: signed/invalid webhook intake and concurrent deduplication; message persistence and lead capture; published-knowledge retrieval; fake-model grounded AI generation and duplicate execution; usage reconciliation; outbound fixture send and delivery receipt; and inbox takeover/manual reply. Unit, integration and Playwright tests collectively cover quota exhaustion, malformed AI output, unsupported claims, tenant denial, Redis outage/recovery, ambiguous provider outcomes, expired sessions and mobile journeys. Hosted/live Meta and real model behavior remain separate release gates.

| Command / check | Result |
| --- | --- |
| `npm run lint:check` | Passed; 0 errors, one existing floating-promise warning in `test/integration/outbox.spec.ts` |
| `npm run build` | Passed |
| `npm test -- --runInBand` | 63 passed across 13 suites |
| `npm run test:e2e -- --runInBand` | 3 passed |
| `npm run test:integration -- --runInBand --silent` | 100 passed across 14 suites with disposable PostgreSQL 16 and Redis 7 |
| `npm run dashboard:lint` / `npm run dashboard:typecheck` | Passed after excluding generated Next output |
| `npm run dashboard:test` | 9 passed across 4 files |
| `npm run dashboard:build` | Passed with isolated `.next-validation` output; generated Next type references were restored to the default `.next` path afterward |
| `npm run dashboard:test:browser` | 18 passed in each of 4 consecutive isolated runs |
| Focused migration/role integration | 13 passed; migration apply/rollback/reapply and restricted-role checks |
| `npm run migration:run:locked` | Applied all 19 migrations on a fresh disposable PostgreSQL database; the database was dropped after verification |
| API / worker / dashboard production images | All built; worker entry passed syntax validation |
| Compose / Caddy | Compose config passed; Caddy reported valid configuration |
| Hosted CI | Run [#47](https://github.com/MOTY12/whatsapp-sales-chatbot/actions/runs/43840871322) passed every step on base HEAD `9397fef`. It predates this uncommitted QA-001 diff, which still needs its own hosted run. |

Performance measurements for API latency, pagination, knowledge retrieval, queue delay and AI orchestration were not run with representative data. A PostgreSQL process restart/reconnection drill was also not run; transaction rollback and service restart/idempotency cases are not equivalent. These items are `NOT_TESTED` in the [release readiness matrix](release-readiness-matrix.md). Staging and live-provider verification remain `BLOCKED` / `NOT_TESTED` per the OPS record.

QA-001 is VERIFIED locally. After this milestone, 8 engineering hours remain plus 11 hours of contingency. Next recommended task: POLICY-001 (3h); QA-002 (5h) can proceed after staging OIDC, approved Meta assets, domain/secrets, monitoring delivery and pilot approval are available.
