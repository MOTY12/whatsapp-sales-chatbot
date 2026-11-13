# December execution plan

Plan dated November 13, 2026. Estimates are engineering hours for the remaining work after local TENANT-002 verification. They assume reuse of the existing schema, owner CRM, outbox, Meta client, and test harness. The focused budget is 150 hours. The original scope allocated 139 hours and left 11 hours for defects and staging retries. TENANT-003 completes a 12-hour allocation, leaving 127 estimated implementation hours, plus the original 11-hour contingency. The milestones retain the original allocations for reference.

| Period | Hours | Deliverable and order |
| --- | ---: | --- |
| Nov 14–20 | 35 | POLICY-001 (3), TENANT-003 (12, verified locally), CHANNEL-001 (5), DASHBOARD-001 (8), TENANT-004 start (7). Start Meta and OIDC staging setup immediately. Demo signed-in business creation and profile editing. |
| Nov 21–27 | 35 | TENANT-004 finish (5), WHATSAPP-001 (8), WHATSAPP-002 (8), METER-001 (5), WHATSAPP-003 start (9). Prove signed intake commits before acknowledgement and duplicate receipts create one turn. |
| Nov 28–Dec 4 | 35 | WHATSAPP-003 finish (2), INBOX-001 (9), INBOX-002 (6), KNOWLEDGE-001 and KNOWLEDGE-004 (8), CATALOG-001 (5), RAG-001 (5). Demo manual delivery, takeover and published content retrieval. |
| Dec 5–11 | 34 | SALES-001 (5), RAG-002 and AGENT-001 (11), OPS-001 and OPS-002 (7), QA-001 (6), QA-002 (5). Prove the full flow in CI and then on approved staging assets. |
| Dec 12–13 | 10 | Hold for release defects and staged rollout. Keep the remaining one hour of buffer during Dec 5–11. |

## Scope and contingencies

- Use one official WhatsApp configuration. Pilot with a verified asset and supervised connection. Require encrypted credentials, tenant binding and safe rotation. Defer self-service Embedded Signup UX, multi-asset routing and additional channels.
- Create a browser business and owner atomically, with a basic profile. Preserve legacy accounts and require explicit identity verification before enabling any claims. Defer claim flows, invitations and full team management.
- Use plain-text FAQs, lightweight products and one publishing flow. Defer files, PDFs, embeddings, hybrid search, learning and analytics. Add pgvector only if retrieval evaluation justifies it.
- Capture contacts with a simple lead status and conversation link. Use deterministic writes, manual takeover and a single inbox. Defer advanced qualification, model-driven actions, payment automation and broader CRM.
- Apply per-tenant message and token caps with usage reconciliation. Record modest operating limits, redacted logs and alert thresholds. Run a backup/restore drill and document retention and access procedures.
- Treat December 13 as achievable for the narrowed pilot only if staging OIDC, WhatsApp access and hosted infrastructure are ready in time. External approval time is outside the 150-hour estimate. If it slips, use the same flow in a fixture-backed demo and keep live access gated. Defer stylistic polish and optional operator convenience before cutting security, durability, metering or takeover.

## Technical risks

Legacy WhatsApp POST processing is inline. The current sender does not persist delivery receipts, and legacy connection credentials require migration to encrypted storage. Constrain the new path to verified assets and exercise recovery and ambiguous sends before cutover. The restricted merchant database currently exposes business and membership reads. Each new merchant feature requires its own least-privilege SQL and a two-tenant integration test. The dashboard and grounded customer replies have no existing production implementation.
