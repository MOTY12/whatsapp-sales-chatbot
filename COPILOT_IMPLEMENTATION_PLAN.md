# Kleva MVP Implementation Plan

## Objective

Deliver a WhatsApp-first assistant that helps a small business capture every
lead, maintain a usable customer CRM, schedule and deliver follow-ups, and
send a daily business brief. The business owner must be able to complete these
workflows from WhatsApp without a dashboard.

## Current-State Decision

Keep the existing NestJS, TypeScript, PostgreSQL, TypeORM, WhatsApp Cloud API,
and Meta Embedded Signup foundations. Do not build a public CRM API or customer
web dashboard for this MVP.

Replace the current in-memory assistant services with database-backed,
tenant-scoped services before adding commands. A database `Customer` created by
the webhook and a customer used by the assistant must be the same record.

## Definition Of Done

1. A business can complete onboarding and connect a WhatsApp Cloud API number.
2. An incoming customer message creates or updates one customer, conversation,
   and message record for the correct business.
3. The owner can find, update, tag, note, and move that persisted customer by
   sending natural-language WhatsApp messages.
4. The owner can schedule, complete, and reschedule customer follow-ups and
   general tasks.
5. Due and overdue follow-ups are delivered to the owner through WhatsApp.
6. A daily business brief is delivered at 08:00 in each business timezone.
7. The owner can request basic analytics through WhatsApp.
8. Key state-changing actions are auditable, idempotent, and covered by tests.

## Architecture

```text
WhatsApp Cloud API
  -> signed webhook controller
  -> webhook message processor
  -> business resolution by phone_number_id
  -> lead capture or owner-command router
  -> LLM intent parser with validated command schema
  -> tenant-scoped CRM / follow-up / task / analytics services
  -> PostgreSQL

Scheduled worker
  -> due follow-ups and tasks
  -> notification records
  -> WhatsApp Cloud API sender

Daily worker
  -> business metrics by timezone
  -> daily brief notification
  -> WhatsApp Cloud API sender
```

Use BullMQ plus Redis for delayed jobs, retries, and separate worker processes.
Use a small, explicit command schema between the intent parser and business
services; the LLM must never directly issue database queries or arbitrary
actions.

## Delivery Order

### Milestone 0: Stabilize The Baseline

1. Preserve the existing uncommitted onboarding persistence work; do not fold
   unrelated refactors into it.
2. Make Jest compatible with the installed ESM packages, or pin compatible
   CommonJS versions. `npm test -- --runInBand` must execute all suites.
3. Add an `.env.example` section for PostgreSQL, Redis, Meta, OpenAI, webhook
   verification, and production security settings.
4. Remove unused starter documentation and replace it with accurate local setup,
   worker startup, migration, and webhook configuration instructions.
5. Add CI steps for lint, build, unit tests, integration tests, and migration
   checks.

Acceptance criteria:

- `npm run build`, lint, unit tests, and e2e tests run successfully.
- Migrations run from an empty database and can be reverted in a test database.

### Milestone 1: Persistent, Tenant-Scoped CRM

1. Create `CustomerService` backed by `CustomerRepository`; remove the
   `Map`-based customer store.
2. Resolve an owner WhatsApp ID to `User` and `Business` once at the router.
   Pass `businessId` and `ownerId` to every command service. Never use a phone
   number alone as the tenancy boundary.
3. Implement database operations for:
   - create customer
   - find by name, phone, or WhatsApp ID
   - show customer profile
   - update phone
   - add note
   - add/remove tags
   - update pipeline stage
4. Validate pipeline stages against the PRD enum: `New Lead`, `Interested`,
   `Negotiating`, `Paid`, `Delivered`, and `Lost`.
5. When a customer is marked `Paid`, update pipeline stage, increment sales
   fields only when a sale amount/order is explicitly supplied, and write an
   audit log.
6. Improve lead capture to assign the actual business owner as `ownerId`,
   preserve the first message, and make concurrent first-message creation safe
   with transactions/upserts.

Repository areas:

- `src/assistant/customer.service.ts`
- `src/assistant/assistant.service.ts`
- `src/database/repositories/customer.repository.ts`
- `src/whatsapp/webhook-lead-capture.service.ts`
- new CRM-focused tests under `src/assistant/` and `src/whatsapp/`

Acceptance criteria:

- A webhook-created lead is returned by `Find customer Sarah`.
- `Move Sarah to Paid`, `Add note to Sarah`, and `Tag Sarah VIP` persist after
  an application restart.
- A business cannot read or alter another business's customer.

### Milestone 2: Reliable Intent Parsing And Command Execution

1. Add the OpenAI SDK and an `AiIntentParserService` with structured JSON
   output. Use a low-latency model and a strict Zod/class-validator schema.
2. Define command types for CRM, pipeline, follow-up, task, analytics, and help.
3. Resolve ambiguous customers by asking a targeted WhatsApp follow-up rather
   than guessing.
4. Keep a deterministic parser only as a fallback for common commands and
   ensure parser output uses the same command types as the LLM path.
5. Persist pending conversational command state in PostgreSQL or Redis with an
   expiry; remove `AssistantStateService`'s in-memory `Map`.
6. Correct command gaps, including `Show today's sales` and `Mark customer paid`.
7. Add idempotency keys based on the provider message ID so webhook retries
   cannot repeat business actions.

Acceptance criteria:

- The documented PRD example commands map to validated actions.
- Unknown or unsafe commands result in a concise help response.
- The 95th percentile command path stays below three seconds excluding Meta
  delivery latency; measure and log parser/service timings.

### Milestone 3: Follow-Ups, Tasks, And Notifications

1. Replace `ReminderService` with a persistent `FollowUpService` using
   `FollowUpRepository`.
2. Add a database-backed `TaskService` and task repository. Support title, due
   date, status, and owner.
3. Parse relative dates in the business timezone. Ask for clarification when a
   date or time is ambiguous.
4. Add BullMQ queues for:
   - scheduled follow-up reminders
   - task reminders
   - notification delivery retries
5. Create a worker that sends a WhatsApp reminder containing customer name,
   phone, latest inbound message, and suggested reply. Record every attempt in
   `Notification`.
6. Implement WhatsApp interactive buttons where supported: `Mark Complete` and
   `Reschedule`. Handle button webhooks and update the follow-up atomically.
7. Surface `Today's follow-ups`, tomorrow's follow-ups, and overdue items from
   persisted records.

Acceptance criteria:

- `Check on Sarah next week` creates a durable follow-up tied to Sarah.
- A due follow-up produces one owner notification despite worker retries.
- Completing or rescheduling through WhatsApp updates the record and prevents
  duplicate reminders.

### Milestone 4: Analytics And Daily Business Brief

1. Implement an `AnalyticsService` that calculates metrics from persisted
   customers, follow-ups, tasks, and messages:
   - leads
   - customers
   - deals won and lost
   - completed follow-ups
   - conversion rate
   - pipeline value
2. Add command handlers for `Show analytics`, `Today's sales`, `Conversion
   rate`, `Leads this month`, and `Customers this week`.
3. Schedule a timezone-aware daily job for 08:00 local business time.
4. Send the daily brief through WhatsApp and store its notification status.
5. Define pipeline-value semantics before implementation. The current schema
   needs either an expected deal value on `Customer` or a dedicated `Deal`
   entity; do not invent values from lifetime value.

Acceptance criteria:

- Metric queries return correct scoped values for seeded data.
- Each active business receives at most one daily brief per local calendar day.
- Failed deliveries retry and remain observable.

### Milestone 5: Security, Operations, And Admin Support

1. Encrypt WhatsApp access tokens at rest using application-managed envelope
   encryption or a managed KMS; never return them from logs or APIs.
2. Keep webhook signature validation and add request-size limits, rate limits,
   structured error handling, and correlation IDs.
3. Implement `AuditLogService` for customer, pipeline, follow-up, task, and
   business-status changes.
4. Build internal-only, authenticated admin endpoints for businesses, users,
   conversations, audit logs, AI action diagnostics, and business suspension.
   A React dashboard is not required for MVP; authenticated internal REST
   endpoints are sufficient until version 2.
5. Respect business suspension in inbound command processing and job delivery.
6. Configure production PostgreSQL TLS with certificate verification; do not
   leave `rejectUnauthorized: false` as the production default.
7. Add health/readiness endpoints and worker monitoring.

Acceptance criteria:

- Secrets are encrypted at rest and redacted from logs.
- Every mutating command creates an audit event.
- A suspended business cannot process new commands or receive scheduled work.

## Data And Migration Work

Create a new migration for each additive schema change. Do not edit an applied
migration. Expected additions include:

- `tasks` repository and indexes
- `notifications` repository and delivery/idempotency fields
- persistent assistant conversation/command state
- optional customer `expectedDealValue` field for pipeline value
- unique notification/job idempotency constraints
- indexes for due follow-ups, pending tasks, and date-based analytics

All migrations must be safe on existing data and tested against a clean schema.

## Test Strategy

1. Unit tests: date parsing, intent validation, stage validation, analytics,
   message construction, and retry decisions.
2. Repository integration tests: tenant isolation, transactions, uniqueness,
   due/overdue queries, and audit logs.
3. Webhook integration tests: valid/invalid signatures, Meta payload parsing,
   idempotency, lead creation, owner routing, and interactive-button actions.
4. Worker integration tests: delayed job execution, retry behavior, exactly-once
   notification effects, and timezone-aware daily briefs.
5. End-to-end test: onboard business, connect a mocked Meta number, receive a
   lead, find and move the lead, schedule a follow-up, dispatch it, complete it,
   and request analytics.

## Implementation Guardrails

- Do not add a customer-facing dashboard, inventory, payments, broadcasts, or
  public API; they are explicitly out of scope.
- Do not store operational state only in process memory.
- Do not let LLM output bypass validation, authorization, or tenant scoping.
- Do not send WhatsApp messages inline from webhook processing when a queued,
  retriable notification is required.
- Keep Meta webhook acknowledgement fast; perform nonessential work in jobs.
- Use business timezones for all human-facing dates and scheduled work.

## Recommended Copilot Prompt Sequence

1. "Implement Milestone 0 only. Preserve existing changes. Make tests execute
   and document the verified commands."
2. "Implement Milestone 1 only. Replace in-memory customer state with
   repository-backed tenant-scoped CRM services and add tests."
3. "Implement Milestone 2 only. Add validated structured AI intent parsing,
   persistent command state, and idempotent command execution."
4. "Implement Milestone 3 only. Add durable follow-ups, tasks, BullMQ workers,
   notification delivery, and WhatsApp completion/reschedule actions."
5. "Implement Milestone 4 only. Add analytics and timezone-aware daily briefs
   with integration tests."
6. "Implement Milestone 5 only. Add encryption, audit logging, internal admin
   support endpoints, observability, and production hardening."

Each implementation request should require a build, full test run, migration
verification, and a concise report of changed files and unmet acceptance
criteria.
