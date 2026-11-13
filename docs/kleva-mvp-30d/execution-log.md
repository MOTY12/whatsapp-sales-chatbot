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
