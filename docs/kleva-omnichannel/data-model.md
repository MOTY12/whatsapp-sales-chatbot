# Provider-neutral data model

PostgreSQL owns tenant identities and durable state. Existing tables retain their IDs. Add tenant keys with composite foreign keys on each tenant-owned relationship, indexes for queue/window/lookup predicates, and RLS with validated scope before merchant exposure. UUIDs are internal, external IDs remain opaque strings, timestamps use UTC, and append-only histories carry an actor and reason.

| Entity | Fields and constraints | Existing reuse |
| --- | --- | --- |
| Business, Account, BusinessMember | Business status, issuer/subject account, explicit role, active status, optional verified legacy claim, unique business+account | Existing business, account and membership IDs |
| ChannelConnection | CHANNEL-001 stores business, provider/account/asset IDs, display name, status, verification and lifecycle timestamps, and legacy import provenance. Provider+asset is unique across all statuses. Business, provider and asset cannot be changed in place. Later work adds credential envelopes and capability snapshots. | Backfill complete, unambiguous legacy WhatsApp mappings without copying credentials |
| CustomerProfile | business, contact display data, consent state, primary identifier optional. All identities point to an internal customer | Existing Customer, never duplicate existing IDs |
| ExternalContactIdentity | business, connection, provider external contact, customer, verification evidence, first/last seen. Unique connection+external ID. Explicit link/unlink audit | Backfill attributable WhatsApp IDs, retain legacy phone field |
| Conversation | business, connection, customer, provider thread key, lifecycle, AI/human control, mode/version, assignment, latest sequence and last inbound | Extend Conversation, unique active thread per approved provider key after conflict review |
| Message, MessageAttachment | business, conversation, sequence, author, direction, provider key, state, revision and attribution. Unique connection/provider ID where known. Attachment points to private object, type, checksum, size and safety state | Extend Message, keep legacy WhatsApp IDs |
| WebhookReceipt, SendAttempt, Outbox | typed provider key unique by connection, normalized payload/version, send intent/attempt and status events. Stable logical ID, lease and due state | Reuse OutboxOperation, add receipt and attempt tables |
| AgentConfig, AgentRun, AgentToolExecution, HumanApproval | configuration version, logical turn and attempt, tool policy, argument digest, replay/approval state and evidence, expiry and audit | Keep owner AssistantSession separate from customer AgentRun |
| ConversationMemory | summary through sequence, timestamp, provenance and retention, bounded recent turns in Message | No customer-memory source table today |
| KnowledgeSource, KnowledgeRevision, KnowledgeChunk | source kind, immutable revision, status, publication pointer, generation, embedding, keyword index and anchors, same-source pointers | Existing business profile may be imported explicitly by merchant |
| CatalogOffer | business, kind, SKU/slug, title, status, revisions, explicit price and availability with source and freshness | No authoritative catalog today |
| Lead, Opportunity, SalesActivity | scoped customer/thread, qualification fields+evidence, stage, owner and outcome history. Dedup active scope and tool intent | Map Customer.leadStage conservatively. Preserve legacy Sale and FollowUp |
| FollowUp, Handoff | consent and due time, intended channel and template, and job/attempt. Handoff records actor, reason, time and fence version | Extend FollowUp and add handoff audit state |
| Order, Booking, Payment | quote/slot, confirmation, external provider ref, valid transition, amount and currency. Unique logical/provider keys, dedicated immutable evidence | Post-pilot. Preserve Sale records separately |
| UsageEvent, BudgetReservation, BillingEvent | business, operation, period, quantities, estimated/actual costs, rate-card version, reservation state and adjustment reason | New metering, manual invoicing first |
| ConsentEvidence, AuditLog, KnowledgeGap | purpose, scope, timestamp and actor, revocation, redacted audit and learning review provenance | Reuse AuditLog and publish through versioned knowledge |

Cross-channel identity links require an authenticated customer account, verified challenge to both endpoints, or explicit operator review with independently verified evidence and recorded consent. Store the source, scope and time. No matching by names, raw phone numbers, or AI inference alone. Keep both original message threads and allow reversible unlinking. Cross-tenant linkage is prohibited by database constraints. Platform identity claims are only valid within their connection namespace.

Review orphaned rows, unbound historical conversations, multiple active threads and provider ID collisions before adding unique constraints. Keep ambiguous historical rows readable through a labeled legacy path. Reconcile counts, tenant mappings, duplicate receipts and outbound versions before cutover. See [migration strategy](migration-strategy.md).
