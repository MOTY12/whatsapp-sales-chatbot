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
