# Kleva V1 execution log

## 10 November 2026 · FOUNDATION-001

- **Starting point.** Clean `main` at `d75fb02f867d89dc54055e273de54cc56f437f38`, the requested reference commit. Its only changes from `26f0e77` were the three V1 planning documents. Compared the current code, migrations, tests and CI against those documents and recorded the status, dependencies and reusable pieces for all 28 tasks in the [progress tracker](progress-tracker.md).
- **Completed.** Removed the two Prettier violations. Isolated and restored the HTTP test fixture's environment with Jest so missing variables remain absent after teardown. Corrected README setup, including Node 22 and PostgreSQL 16 as CI targets, the Meta settings read at boot, and the limits of the HTTP suite. Updated database setup for all three migrations, disabled synchronization, and the distinction between CI's partial rollback and a disposable full rollback.
- **Decisions.** Kept existing CI and test entry points. The task changes formatting, fixture isolation and documentation. Repository integration and seeded migration checks belong to FOUNDATION-002. Kept the audit as a historical snapshot. The customer-facing roadmap retains tenant checks, reliable transport and handoff before live AI. See the tracker for scoped implementation choices and sales grounding requirements.

| Verification | Result |
| --- | --- |
| `npm run lint:check` before the fix | Failed with the two expected Prettier violations. |
| `npm run lint:check` after the fix | Passed. |
| `npm run build` | Passed. |
| `npm test` | Passed, 18 tests in five suites. |
| `npm run test:e2e` | Passed, three HTTP tests, with local socket access. WhatsApp service stubbed. |
| `npm run migration:run` and TypeORM `migration:show` | Passed against a fresh disposable PostgreSQL 16.14 database. All three migrations applied. |
| `node dist/main.js` and `GET /` | Full Nest app booted against the migrated database with local fixture Meta settings. The root endpoint returned `Hello World!`. |

**Status.** VERIFIED locally on Node 24.22.1 using the installed dependencies. Hosted Node 22 CI and clean dependency installation were not run. The smoke used no real Meta credentials or model provider calls. There is no blocker for the next task.

**Next unblocked task.** FOUNDATION-002 adds a guarded real PostgreSQL test harness, clean and populated migration checks, and a two-tenant regression fixture to CI.

## 11 November 2026 · FOUNDATION-002

- **Starting point.** Clean `main` at `19768f268223e6a34c6e64b33f2dcb90d3efb766`. Reviewed the five V1 planning and tracking documents, the TypeORM configurations, entities and migrations, Jest suites, package scripts, and CI workflow. Reconfirmed the FOUNDATION-001 baseline.
- **Implemented.** Added `test:integration` in `package.json`, a dedicated Jest configuration, and a PostgreSQL harness, fixtures, and three suites in `test/integration/`. The harness creates a fresh database for each migration scenario and one for the repository suite. It uses an explicitly configured local control database, a migration role that owns schema objects, and a runtime role with application-table CRUD privileges. Cleanup removes only generated resources from that run. Jest uses type-aware TypeScript compilation so TypeORM receives the same column metadata as the Nest build.
- **Wiring.** Extracted the existing CLI entity and migration registry into `src/database/schema.ts` and reused it in the harness. Updated `.github/workflows/ci.yml` to replace the partial rollback check with the full suite on PostgreSQL 16. Added local commands in `DATABASE_SETUP.md` and linked them from `README.md`.
- **Migration findings.** The full apply/revert/reapply passed. The clean seeded upgrade preserved business, owner, customer, conversation, and message IDs and relationships. Duplicate non-null legacy provider IDs cause `AddWebhookPersistence` to fail with PostgreSQL `23505` and leave the pre-upgrade rows intact. Its down migration leaves `businesses.phoneNumberId` and `businesses.accessToken` nullable. Historical migrations were left intact.
- **Isolation findings.** Existing scoped repository queries distinguish two businesses with the same customer name, phone and WhatsApp ID. PostgreSQL rejects within-tenant customer duplicates, global provider message duplicates, and references to missing parents. The schema still permits a conversation to reference a customer in another business and a message's business to differ from its conversation's business. The characterization test records those gaps for TENANT-001.

| Verification | Result |
| --- | --- |
| `npm run lint:check` and `npm run build` | Passed. |
| `npm test` | 18 tests passed. |
| `npm run test:e2e` | 3 HTTP tests passed with local socket access. |
| `npm run test:integration` | 21 tests passed in 3 suites on PostgreSQL 16.14. Covered the safety guards, all 13 application tables, all 18 foreign keys, clean and seeded migrations, expected migration failure and rollback, restricted runtime access, and a real owner create-customer flow resumed on a new connection. |
| Database cleanup | A catalog check found no generated integration databases or roles after the suite. |
| `npm run migration:run` and full Nest startup | All three migrations applied through the normal CLI to a separate fresh database. The app booted with fixture Meta settings and served `GET /`. |

**Status.** VERIFIED locally on Node 24.22.1 and PostgreSQL 16.14. Hosted GitHub Actions on Node 22 remains pending. There is no blocker for FOUNDATION-003.

**Next unblocked task.** FOUNDATION-003 consolidates runtime database configuration and adds verified production TLS, readiness checks, and redaction.

## 11 November 2026 · FOUNDATION-003

- **Starting point.** Clean `main` at `0fd914e2032a88a01eb6733b14c52044496486eb`. Reviewed the V1 audit, architecture, roadmap, tracker and log, the environment and TypeORM settings, and the existing CI and test profiles. FOUNDATION-001 and FOUNDATION-002 remain verified.
- **Configuration.** Centralized validation in `src/config/env.ts`. `src/database/options.ts` supplies the Nest and CLI database options and schema registry. The integration harness uses the same database parser after its dedicated safety checks. The CLI validates only database settings. The HTTP bootstrap also validates server, logging, Meta and optional Redis and OpenAI settings. WhatsApp and Embedded Signup consume the shared Meta configuration.
- **TLS and logging.** Production requires a trusted PEM CA and verifies the server certificate chain and configured DNS name or IP address. Plaintext and insecure certificate verification settings fail before connection. The Graph origin is restricted in production and credential-bearing requests reject redirects. JSON application logs carry validated or generated request IDs. Request logs omit URLs, headers and payloads, and database and provider logs retain safe failure metadata. The CLI retains migration names and status while suppressing SQL, parameters and raw errors. Embedded Signup error pages keep their status and retry guidance with generic provider failure text.
- **Health.** Added `GET /health/live` and `GET /health/ready`. Readiness uses a PostgreSQL probe with a one-second response budget and shares the pending probe across concurrent requests. Liveness is independent of PostgreSQL after the app starts. The initial Nest startup still requires a working database connection.
- **Documentation.** Updated `.env.example`, `README.md` and `DATABASE_SETUP.md` with setup, production TLS, logging, health and integration-test instructions.

| Verification | Result |
| --- | --- |
| `npm run lint:check` and `npm run build` | Passed. |
| `npm test` | 37 tests passed across seven suites, including environment validation, log redaction, and the readiness timeout. |
| `npm run test:e2e` | Three tests passed with local socket access. |
| `npm run test:integration` | 24 tests passed across five suites on disposable PostgreSQL 16.14. The new suites verified matching API/CLI options, correlation, readiness recovery, and PostgreSQL queries through a locally terminated TLS connection. The client rejected an untrusted certificate and a hostname mismatch. |
| Compiled API and migration CLI with `NODE_ENV=production DATABASE_SSL=false` | Both rejected the setting before connecting and omitted the fixture password from output. |
| Migration and process outage smoke | The normal CLI applied and reported all three migrations. The compiled Nest app booted and returned HTTP 200 readiness. After PostgreSQL stopped, liveness returned HTTP 200 and readiness HTTP 503. Test database and role cleanup passed. |

**Status.** VERIFIED locally on Node 24.22.1 and PostgreSQL 16.14. Hosted Node 22 CI and deployment connectivity to PostgreSQL and Meta remain unverified. The TLS test uses a temporary certificate and a local TLS relay to the disposable database.

**Next unblocked task.** FOUNDATION-004 adds the BullMQ worker runtime and durable PostgreSQL outbox. Use a disposable Redis instance for verification.

## 11 November 2026 · FOUNDATION-004

- **Starting point.** Clean `main` at `4ef22864742b768762568eeb41a1513462aa0e38`. Reviewed the five V1 documents, database schema and migrations, HTTP and webhook flow, centralized environment configuration, CI and integration harness. FOUNDATION-001 through FOUNDATION-003 remain verified.
- **Outbox.** Added `AddOutboxOperations1760000000002`, the TypeORM entity, and the transaction-bound `OutboxStore`. One table holds durable intent and operation status. UUIDs identify logical operations, metadata accepts only UUID references, and status reads require explicit business scope. Reusing an ID for different intent fails. The relay claims due rows with `FOR UPDATE SKIP LOCKED`. Status transitions use lease tokens, and the scheduler timestamp records the retry, lease, or redelivery deadline according to state.
- **Worker.** Added BullMQ and ioredis, the relay, processor, and standalone Nest worker. BullMQ job IDs use the logical ID and execution attempt, and payloads contain only the UUID. PostgreSQL retains intent when Redis is unreachable or loses a job. Redis dispatch retries use exponential backoff with jitter. Handler execution allows five attempts, and failed writes roll back. Transactional handler effects commit together with `COMPLETED`. External side effects require their own idempotency or reconciliation. The worker stops claiming and drains active work on shutdown. An empty handler registry leaves feature registration to later roadmap tasks.
- **Scope and setup.** HTTP webhook processing continues through the existing services. The migration CLI and API open no Redis connections. Updated the README, environment example, database setup and existing CI workflow. CI uses disposable PostgreSQL 16 and Redis 7 services.

| Verification | Result |
| --- | --- |
| `npm run lint:check` and `npm run build` | Passed. |
| `npm test` | 37 unit tests passed. |
| `npm run test:e2e` | Three HTTP tests passed with local socket access. |
| `npm run test:integration` | 30 tests passed, including six outbox tests on disposable PostgreSQL 16.14 and Redis 8.2.2. Covered rollback and conflicting IDs, Redis connection recovery, two relays racing, a crash after enqueue, a lost Redis job, a stale execution lease, duplicate delivery, retry exhaustion and graceful drain. |
| Migration and standalone process smoke | All four migrations applied through the normal CLI with invalid Redis configuration. The worker started without Meta settings, parked an unregistered operation and shut down on SIGTERM. |
| Cleanup | No generated test databases, roles, or Redis queue keys remained after the suite. |

**Status.** VERIFIED locally. Hosted CI on Node 22 and Redis 7 remains pending. No live Meta calls or production services were used.

**Next unblocked task.** TENANT-001 migrates business memberships and validates tenant integrity while preserving existing owner and CRM IDs.
