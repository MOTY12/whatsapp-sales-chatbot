Implement the Kleva MVP in this existing NestJS/TypeScript codebase, using the supplied PRD as the product specification.

Before editing, inspect the repository and follow its current NestJS, TypeORM, and module patterns. Keep changes incremental and focused. Do not build a web dashboard: WhatsApp is the MVP interface. Use PostgreSQL as the source of truth. Do not keep business, customer, conversation, reminder, or assistant-flow data in process-local Maps.

CURRENT BASELINE
- WhatsApp webhook verification and basic inbound text handling exist in src/whatsapp.
- Business onboarding and Meta embedded signup flows exist in src/onboarding and src/meta-embedded-signup.
- PostgreSQL entities exist for Business, User, Customer, Conversation, Message, PipelineStage, FollowUp, Task, Notification, and AuditLog.
- Repositories exist for a subset of those entities.
- Business registration writes to PostgreSQL, but onboarding state and embedded signup connection data are in memory.
- Customer, sales, reminder, and assistant flow services are in-memory implementations.
- The command parser is regex-based; there is no LLM integration.
- Auth files exist but are empty.
- No automatic customer lead capture, reminder worker/scheduler, daily brief, analytics implementation, or admin interface is evident.

IMPLEMENTATION RULES
1. Read the relevant code and tests before changing each area. Preserve existing behavior where it matches the PRD.
2. Implement a working vertical slice at each milestone. Do not leave stub methods, TODO-only paths, or success responses that hide failures.
3. Scope every customer, conversation, follow-up, task, and metric query by businessId. Resolve the business and owner from persisted records; never trust a businessId supplied in a user message.
4. Persist webhook message IDs and make processing idempotent so Meta retries do not create duplicate customers, conversations, messages, reminders, or replies.
5. Keep secrets in environment variables. Never log access tokens, full customer message payloads, or sensitive personal data.
6. Use database migrations for schema changes. Avoid TypeORM synchronize in production.
7. Add focused unit/integration tests for each implemented flow. Update configuration and documentation only as needed.
8. Do not add payments, inventory, broadcasts, public APIs, or a dashboard; they are outside this MVP.

MILESTONE 0 — CONFIRM THE FOUNDATION
- Trace the app module graph and current webhook/onboarding/assistant flows.
- Review the existing entity relationships, constraints, and repository patterns.
- Identify required environment variables and make startup/configuration errors clear.
- Add or update migrations for missing fields and indexes. In particular, ensure webhook provider message IDs are unique when present, customer lookup is tenant-scoped, and persisted onboarding/assistant state has an explicit storage model.
- Confirm existing tests still represent intended behavior; update tests when replacing in-memory services.
- Document local setup, database migration commands, webhook configuration, and required Meta credentials.

MILESTONE 1 — PERSISTENT BUSINESS ONBOARDING AND WHATSAPP CONNECTION
- Persist onboarding progress/draft data so a restart or multi-instance deployment does not lose a conversation.
- Ensure each WhatsApp owner resolves to their persisted user and business. Implement the unfinished owner lookup; add an indexed WhatsApp ID field or a deliberate indexed metadata strategy rather than scanning users.
- Make business and owner creation transactional and safe against duplicate onboarding/webhook retries.
- When Meta embedded signup completes, persist WABA ID, phone number ID, display number, access token, connection status, and connected timestamp to the correct business. Do not keep the connection only in memory.
- Route outbound messages using the connected business's phone number ID and token, rather than one global phone number configuration. Keep a documented development/test configuration if needed.
- Validate and persist business profile details such as timezone, description, opening hours, and logo metadata. If media storage is not in MVP, record a clear supported limitation instead of pretending a file was uploaded.
- Add tests for onboarding completion, interrupted onboarding, duplicate registration, signup callback state validation, and persisted connection lookup.

MILESTONE 2 — WEBHOOK PROCESSING AND AUTOMATIC LEAD CAPTURE
- Verify Meta webhook signatures for POST requests using the configured app secret, in addition to the existing GET verification token flow.
- Parse supported inbound text events and status updates safely. Ignore unsupported event types without crashing.
- Resolve the receiving business by the webhook's phone_number_id, not by assuming all traffic belongs to one global number.
- Persist inbound messages and conversations, updating last interaction. Store provider message IDs and handle duplicate deliveries idempotently.
- For a new customer phone/WhatsApp ID, create a Customer with name derived from the WhatsApp profile when available (otherwise a reasonable placeholder), phone, WhatsApp ID, first message/source, New Lead stage, and last interaction.
- For an existing customer, update interaction/conversation history without creating a duplicate.
- Notify the seller of a newly captured lead via WhatsApp, with an appropriate rate/duplicate guard.
- Separate customer-originated messages from seller/owner commands. Route seller messages to the assistant and customer messages to lead capture/customer response behavior; never treat every sender as the business owner.
- Add tests for new lead, existing lead, duplicate webhook, multiple businesses/phone numbers, malformed payload, and signature failure.

MILESTONE 3 — DATABASE-BACKED CRM AND PIPELINE
- Replace the in-memory CustomerService with application services backed by CustomerRepository.
- Implement scoped create/list/find-by-name/find-by-phone/find-by-WhatsApp-ID, add note, tag, profile display, phone update, and stage movement operations.
- Normalize phone numbers consistently before storing and searching; handle unique-constraint conflicts cleanly.
- Use the PRD stages: New Lead, Interested, Negotiating, Paid, Delivered, Lost. Create default pipeline stages for each business and ensure queries/counts use the canonical values.
- Add command support for: create customer, add note, tag customer, find/show customer profile, search by phone, update phone, move stage, show pipeline, show a stage's deals, count paid customers, and total customers.
- Make “mark paid” update pipeline stage and relevant sale/order metrics consistently. Do not silently leave the current markPaid behavior disconnected from the pipeline.
- Add audit records for customer creation/updates, notes, tags, stage changes, and paid status, recording business, actor where known, entity, action, and relevant before/after values.
- Test business isolation, name ambiguity, phone normalization, valid/invalid stages, and audit behavior.

MILESTONE 4 — NATURAL-LANGUAGE COMMAND ROUTING
- First define a typed command/intent contract: intent, validated entities, confidence/clarification needs, and supported action.
- Keep deterministic parsing for clear known commands and add an OpenAI-backed parser only behind a provider interface and environment configuration. If AI is unavailable or returns invalid output, gracefully fall back to deterministic parsing or ask a clarifying question.
- Require structured output validated against a schema. The model may classify/extract; it must not execute database actions directly.
- Confirm ambiguous customer matches and consequential changes before applying them. Never guess a customer or stage when multiple matches exist.
- Add timeout, retry limits, safe error handling, and tests for parser fallback, malformed AI output, ambiguous entities, and prompt-injection-like user text.
- Fix mismatches between parser intents and assistant handling (for example “show sales today” versus “what sold today”) and ensure every advertised command is implemented.

MILESTONE 5 — FOLLOW-UPS, TASKS, AND REMINDERS
- Replace in-memory ReminderService with FollowUpRepository-backed persistence. Implement Task repository/service for task creation, listing, completion, cancellation, and rescheduling.
- Support “follow up tomorrow”, named weekdays/dates/times, customer-linked reminders such as “check on Sarah next week”, and general tasks such as “call Sarah tomorrow” or “prepare invoice”.
- Parse dates in the business timezone, store timestamps consistently (UTC), and validate invalid/past/ambiguous dates with a clarification.
- Add reminder lifecycle commands: due today, overdue, mark complete, reschedule, and task listing/completion.
- Implement a durable scheduler/worker for due reminders and daily jobs. Use BullMQ + Redis only if adding and configuring those dependencies; otherwise select a reliable existing-compatible job mechanism and document its delivery/retry guarantees. Avoid in-process timers as the production scheduler.
- Send reminders to the correct business owner through that business's WhatsApp connection. Include customer name/phone, last relevant message when available, and a suggested reply only when safely supported by available context.
- Persist notification status and retry failures without duplicating successful sends.
- Add tests for timezone boundaries, due/overdue classification, completion/reschedule, worker retries, and duplicate delivery protection.

MILESTONE 6 — SALES, DAILY BRIEF, AND ANALYTICS
- The current SalesService has no corresponding Sale/Order entity. Add a persisted sales/order entity and migration with businessId, optional customerId, amount/currency, product/description, status, and timestamps; define what creates a sale from explicit seller commands.
- Do not infer a sale merely because a customer is marked Paid unless the product behavior captures an amount. Ask for amount/details when required.
- Implement seller commands for today’s sales, leads, follow-ups, pipeline by stage, overdue work, monthly leads, weekly customers, won/lost counts, completed follow-ups, and conversion rate.
- Define each metric precisely, use business timezone boundaries, and scope all queries by business.
- Build a daily brief from persisted metrics and send it at the business's configured morning time (default 08:00 local time). Make sending idempotent per business and local date; record status and support retry.
- Use database aggregation queries rather than loading all tenant records into memory for metrics.
- Add tests for metric definitions, timezone/date boundaries, empty businesses, daily-job idempotence, and failures.

MILESTONE 7 — AUTHENTICATION, SECURITY, AND OPERATIONS
- Complete the empty Auth module only for any backend/operator endpoints needed by the MVP; WhatsApp onboarding remains the primary signup interface. Hash passwords with bcrypt and use validated JWT configuration, expiry, and guards if username/password auth is actually exposed.
- Do not invent public signup/dashboard requirements; PRD's admin panel is internal and version 2 dashboard is out of MVP scope. For MVP operational needs, prefer secured internal/admin APIs or documented operational tooling.
- Ensure transport security is deployment-configured, use SSL for production PostgreSQL, and use a managed encrypted database/storage setup for encryption at rest.
- Review secret handling, webhook signature verification, rate limiting/abuse controls, input validation, access-token storage, and log redaction.
- Add audit coverage for business-critical actions and meaningful operational logs with correlation IDs.
- Add health/readiness checks for application and database. Document backup, migration, deployment, and recovery expectations.
- Do not claim 99.9% availability without corresponding deployment monitoring, redundancy, backups, and operational support.

MILESTONE 8 — ACCEPTANCE AND RELEASE
- Run build, lint, unit tests, and e2e tests; fix regressions rather than suppressing checks.
- Add e2e coverage for: business onboarding and connection, webhook lead capture, seller CRM command, customer stage movement, scheduling/completing a follow-up, receiving a reminder, daily brief, and cross-business data isolation.
- Add integration tests with mocked Meta/OpenAI clients and a test PostgreSQL database or the repository's established test strategy.
- Verify fresh database migration and restart behavior; no core workflow state should disappear on restart.
- Update README with product architecture, environment variables, migrations, Meta webhook setup, supported WhatsApp commands, scheduler setup, and known MVP boundaries.
- Report implemented milestones, commands/tests run, required external credentials/services, and remaining limitations. Do not describe unimplemented features as complete.

DELIVERY ORDER
Implement and review one milestone at a time in the order above. Start with persistent tenant/business resolution and webhook lead capture because later CRM and analytics depend on trustworthy business-scoped records. Then complete persistence-backed CRM, follow-ups/tasks, and scheduled notifications before daily analytics/brief. Keep each milestone buildable and tested before beginning the next.