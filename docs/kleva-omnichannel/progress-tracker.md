# Progress tracker

Planning snapshot at `adb74b3ec7d8810c3788119cdb1e220bb79cf61a`. TENANT-002 reflects the November 13 verification in the [execution log](../kleva-v1/execution-log.md). VERIFIED indicates evidence within the stated boundary. IN_PROGRESS indicates an implementation without passing acceptance. NOT_STARTED includes tasks waiting on earlier work. CONDITIONAL indicates access and a positive provider decision must precede development. See [repository assessment](repository-assessment.md) and [execution roadmap](execution-roadmap.md).

| Task | Phase | Status | Direct dependencies | Evidence or next action |
| --- | --- | --- | --- | --- |
| FOUNDATION-001 | Groundwork | VERIFIED | None | Prior local evidence retained. Auth lint regression is tracked in TENANT-002. |
| POLICY-001 | Groundwork | NOT_STARTED | None | Establish official WhatsApp pilot eligibility and cost evidence. |
| FOUNDATION-002 | Groundwork | VERIFIED | FOUNDATION-001 | Prior local evidence and applicable passing regression suites at audited HEAD. |
| FOUNDATION-003 | Groundwork | VERIFIED | FOUNDATION-002 | Prior local evidence and applicable passing regression suites at audited HEAD. |
| FOUNDATION-004 | Groundwork | VERIFIED | FOUNDATION-002 | Prior local evidence and applicable passing regression suites at audited HEAD. |
| TENANT-001 | Groundwork | VERIFIED | FOUNDATION-002 | Prior local evidence and applicable passing regression suites at audited HEAD. |
| TENANT-002 | Groundwork | VERIFIED | TENANT-001 | Signed fixture verifies OIDC, sessions and restricted PostgreSQL RLS. Hosted CI and staging OIDC remain release checks. |
| CHANNEL-001 | Groundwork | VERIFIED | TENANT-001, FOUNDATION-004 | WhatsApp adapter contract, fail-closed resolver and migration verified locally. Live cutover and credentials remain later work. |
| TENANT-003 | Paid pilot | IN_PROGRESS | TENANT-001, TENANT-002 | December merchant creation and profile slice verified locally. Legacy claims, invitations, team management and broader audit workflow remain open. |
| TENANT-004 | Paid pilot | IN_PROGRESS | FOUNDATION-003, FOUNDATION-004, TENANT-002, TENANT-003, CHANNEL-001 | Supervised credential setup verified locally. Live Meta proof, self-service Embedded Signup and external key-management integration remain open. |
| KNOWLEDGE-001 | Paid pilot | NOT_STARTED | TENANT-003 | Implement knowledge source and revision lifecycle. |
| METER-001 | Paid pilot | VERIFIED locally | FOUNDATION-004, TENANT-003 | PostgreSQL ledger enforces UTC monthly WhatsApp/input-token/output-token budgets, per-request token ceilings, idempotent reservations, conservative uncertain outcomes and merchant-role isolation. Hosted CI and production limit provisioning remain deployment checks. |
| DASHBOARD-001 | Paid pilot | NOT_STARTED | TENANT-002, TENANT-003, TENANT-004 | Build dashboard shell and onboarding. |
| WHATSAPP-001 | Paid pilot | VERIFIED | TENANT-004, FOUNDATION-004, CHANNEL-001 | Signed raw intake and atomic receipt/outbox handoff verified locally. |
| KNOWLEDGE-002 | Paid pilot | NOT_STARTED | KNOWLEDGE-001 | Add private upload and PDF extraction. |
| CATALOG-001 | Paid pilot | NOT_STARTED | TENANT-003, DASHBOARD-001 | Publish native product and service offers. |
| WHATSAPP-002 | Paid pilot | VERIFIED locally | WHATSAPP-001 | PostgreSQL outbox worker persists tenant-scoped inbound messages, classifies verified owner commands and legacy onboarding, and retains pending response intents. Actual response delivery and unmatched status reconciliation continue in WHATSAPP-003. |
| WHATSAPP-003 | Paid pilot | NOT_STARTED | WHATSAPP-001, METER-001 | Implement safe send and status reconciliation. |
| KNOWLEDGE-003 | Paid pilot | NOT_STARTED | KNOWLEDGE-001, KNOWLEDGE-002, FOUNDATION-004 | Add chunking, embeddings and reindex jobs. |
| INBOX-001 | Paid pilot | NOT_STARTED | WHATSAPP-002, WHATSAPP-003 | Add conversation and handoff APIs. |
| KNOWLEDGE-004 | Paid pilot | NOT_STARTED | DASHBOARD-001, KNOWLEDGE-002, KNOWLEDGE-003 | Build knowledge management screens. |
| RAG-001 | Paid pilot | NOT_STARTED | KNOWLEDGE-003 | Evaluate tenant-scoped hybrid retrieval. |
| INBOX-002 | Paid pilot | NOT_STARTED | DASHBOARD-001, INBOX-001 | Ship the shared inbox. |
| SALES-001 | Paid pilot | NOT_STARTED | TENANT-003, INBOX-001, CATALOG-001 | Persist leads and opportunities with an activity trail. |
| RAG-002 | Paid pilot | NOT_STARTED | RAG-001, KNOWLEDGE-004, DASHBOARD-001, METER-001 | Add grounded generation, configuration and playground. |
| SALES-002 | Paid pilot | NOT_STARTED | SALES-001, INBOX-002 | Configure qualification fields and manual conversion. |
| TOOLS-001 | Paid pilot | NOT_STARTED | RAG-002, SALES-002, CATALOG-001, INBOX-001 | Enforce typed pilot sales tools. |
| AGENT-001 | Paid pilot | NOT_STARTED | RAG-002, INBOX-002, TOOLS-001 | Enable grounded WhatsApp answers with bounded memory. |
| LEARNING-001 | Paid pilot | NOT_STARTED | AGENT-001 | Capture feedback and group redacted gaps. |
| ANALYTICS-001 | Paid pilot | NOT_STARTED | AGENT-001 | Ship tenant-scoped support analytics. |
| OPS-001 | Paid pilot | NOT_STARTED | AGENT-001 | Monitor, throttle and recover API and workers. |
| LEARNING-002 | Paid pilot | NOT_STARTED | LEARNING-001, KNOWLEDGE-003 | Review, approve, publish and replay suggestions. |
| PILOT-001 | Paid pilot | NOT_STARTED | ANALYTICS-001, METER-001, OPS-001 | Prepare paid pilot and manual collection. |
| OPS-002 | Paid pilot | NOT_STARTED | LEARNING-002 | Enforce retention, deletion and restore controls. |
| QA-001 | Paid pilot | NOT_STARTED | ANALYTICS-001, OPS-001, OPS-002, LEARNING-002, TOOLS-001, SALES-002, METER-001 | Exercise the full flow and failure matrix in CI. |
| QA-002 | Paid pilot | NOT_STARTED | QA-001, POLICY-001, PILOT-001 | Run staged Meta pilot and release gates. |
| CHANNEL-002 | Expansion | NOT_STARTED | QA-002, CHANNEL-001 | Add authorized website live chat. |
| CHANNEL-003 | Expansion | NOT_STARTED | QA-002, CHANNEL-001 | Add Telegram Bot API adapter. |
| CHANNEL-004 | Expansion | NOT_STARTED | QA-002, CHANNEL-001 | Add Instagram professional messaging adapter. |
| CHANNEL-005 | Expansion | NOT_STARTED | QA-002, CHANNEL-001 | Add Facebook Messenger Page adapter. |
| CHANNEL-006 | Expansion | NOT_STARTED | QA-002, CHANNEL-001 | Add one official mailbox provider. |
| SALES-003 | Expansion | NOT_STARTED | QA-002, TOOLS-001, CATALOG-001 | Create approved draft orders. |
| SALES-004 | Expansion | NOT_STARTED | QA-002, TOOLS-001, CATALOG-001 | Book confirmed appointments. |
| SALES-006 | Expansion | NOT_STARTED | QA-002, SALES-002, WHATSAPP-003 | Schedule authorized sales follow-ups. |
| BILLING-001 | Expansion | NOT_STARTED | QA-002, PILOT-001, METER-001 | Automate hybrid subscription billing. |
| KNOWLEDGE-005 | Expansion | NOT_STARTED | QA-002, KNOWLEDGE-003 | Ingest authorized merchant website content. |
| CATALOG-002 | Expansion | NOT_STARTED | QA-002, CATALOG-001, TOOLS-001 | Read authoritative price and inventory from one connector. |
| SALES-007 | Expansion | NOT_STARTED | QA-002, SALES-002 | Add explainable merchant-controlled lead scoring. |
| CHANNEL-009 | Expansion | NOT_STARTED | QA-002, CHANNEL-001, KNOWLEDGE-002 | Fetch and scan approved channel media. |
| IDENTITY-001 | Expansion | NOT_STARTED | CHANNEL-002, CHANNEL-001 | Link verified contacts across channels. |
| SALES-005 | Expansion | NOT_STARTED | SALES-003 | Generate links and verify payments. |
| ACCESS-001 | Conditional access | NOT_STARTED | None | Verify official LinkedIn access. |
| ACCESS-002 | Conditional access | NOT_STARTED | None | Verify official TikTok Business Messaging access. |
| CHANNEL-007 | Conditional access | CONDITIONAL | QA-002, CHANNEL-001, ACCESS-001 | Start only after approved sandbox and positive access decision. |
| CHANNEL-008 | Conditional access | CONDITIONAL | QA-002, CHANNEL-001, ACCESS-002 | Start only after approved sandbox and positive access decision. |
