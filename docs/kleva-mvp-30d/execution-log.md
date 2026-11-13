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
