# Kleva pilot deployment runbook

## Status

Repository deployment artifacts are prepared; a live staging environment is **BLOCKED** until an approved AWS account, domain, staging OIDC registration, Meta test app/assets, and operator-held secrets are available. No infrastructure has been provisioned and no live endpoint has been verified.

## Pilot topology

Use one small Linux VM for staging and the first few pilot merchants: 2 vCPU and 8 GiB RAM as a starting point, 40–80 GiB encrypted disk, Docker Compose, Caddy, the NestJS API, a separate NestJS worker, the standalone Next.js dashboard, and private Redis with a 256 MiB memory ceiling. Use a TLS-enabled private PostgreSQL service in a separate managed database instance, starting around 2 vCPU/4 GiB and resizing from observed load. Store encrypted dumps in a separate versioned S3 bucket with lifecycle rules. These are sizing starting points, not load-tested guarantees.

The main cost drivers are VM uptime/disk, PostgreSQL compute/storage/backup, public data transfer, object storage, log retention, and Meta/model usage. No AWS prices are asserted. Do not add Kubernetes, ECS, or Terraform for this pilot.

Single-VM failure stops HTTP, dashboard, worker, Caddy and Redis. Caddy certificate data and Redis AOF survive container recreation on the VM volume, but not VM/disk loss. PostgreSQL and encrypted backups are off-VM. Redis is a delivery accelerator; PostgreSQL outbox state is authoritative and the worker relay recovers dispatch after Redis returns. A VM outage therefore pauses processing until recovery. This design has no host-level HA or automatic cross-region failover.

## Network and TLS

1. Create a DNS A/AAAA record for the pilot hostname to the VM. Allow inbound TCP 80/443 and UDP 443 only; administer with AWS SSM Session Manager. Do not open SSH, PostgreSQL, or Redis to the internet.
2. Permit VM egress required for PostgreSQL TLS, Meta, OIDC, SSM, S3, and explicitly approved AI provider calls. Permit database ingress on 5432 only from the VM security group. Redis has no published port and Compose places it on the worker-only `jobs` network.
3. Caddy obtains and renews certificates through ACME. Its reverse proxy sends `/health/*`, `/merchant/*`, `/meta/*`, `/webhooks/*`, and `/public/*` to the API; all other paths go to the dashboard BFF. `/public/*` serves the cross-origin widget assets and APIs. API SSE streams use `flush_interval -1` and disable buffering; preserve streaming behavior and allow idle connections through any outer load balancer. Redis is attached to the private `jobs` network, shared by API and worker for website Pub/Sub; it remains unpublished to the host/internet. No sticky sessions are required for event fan-out, but Redis loss temporarily degrades notifications while PostgreSQL history remains authoritative. Caddy does not emit request access logs, which avoids webhook verification query strings and customer data in proxy logs. API signature validation continues to use the exact request bytes.
4. Configure the Meta callback as `https://<host>/webhooks/whatsapp`; set the dashboard callback from the OIDC client registration and `DASHBOARD_PUBLIC_ORIGIN` to the same HTTPS origin.

## Prepare PostgreSQL roles and schema

Use a restricted administrative session over verified TLS. Bootstrap roles from `deploy/role-bootstrap.sql` while connected to a database named `kleva`; enter role passwords interactively with `\password` and never put them in shell history. Confirm the DB has the required UUID extension. Use the migration role for schema changes and separate runtime, merchant-auth, identity-auth, and backup credentials for their respective clients.

From a reviewed release artifact on the VM, configure the AWS CLI region and instance profile, then render `/etc/kleva/migration.env` from `/kleva/staging/runtime/` and `/kleva/staging/migration/` using `scripts/render-ssm-env.sh`. Keep it mode 0600 and owned by root. Set the Compose interpolation file to `/etc/kleva/compose.env` using the values in `deploy/.env.compose.example` (do not copy placeholder secrets).

Before every migration, take and verify a database backup. Run `npm ci`, `npm run build`, then `npm run migration:run:locked` with the migration environment loaded. The runner holds a PostgreSQL session advisory lock across the migration operation. Review migration compatibility and the generated migration list before applying. Then run `npm run auth:grant`, `npm run tenant:preflight`, `psql ... -f deploy/runtime-grants.sql`, and `psql ... -f deploy/verify-schema.sql`. The runtime role must remain `NOSUPERUSER NOBYPASSRLS`; inspect all forced RLS results and fail the release if any tenant table/policy or grant is missing.

Install only a reviewed release, then build and start:

```sh
docker compose --env-file /etc/kleva/compose.env -f deploy/compose.yaml build
docker compose --env-file /etc/kleva/compose.env -f deploy/compose.yaml up -d
docker compose --env-file /etc/kleva/compose.env -f deploy/compose.yaml ps
```

Confirm `/health/live`, `/health/ready`, dashboard `/healthz`, Caddy-issued HTTPS, authenticated OIDC login, tenant isolation, and a fixture-backed webhook/worker recovery before enabling any approved pilot merchant. AI remains disabled until explicit operator approval and provider credentials are provisioned. Do not enable it merely by setting a model key.

## Release and rollback

Deploy a pinned image tag. First take a database backup, apply additive migrations and grants, start the new API/dashboard/worker, check readiness and error/backlog signals, then direct the hostname to the release. Retain the previous image tag. Revert the image tag only if the migrated schema remains backward compatible. If not, roll forward with a corrective migration; never automatically drop or restore production data to roll back. Follow [rollback](rollback.md) and [incident response](incident-response.md).

## Current external gates

- AWS account access, VM, private PostgreSQL, security groups, SSM and S3 bucket/KMS policy.
- DNS hostname and public HTTPS issuance.
- Staging OIDC issuer/client/callback and restricted DB auth users.
- Meta app secret, webhook verify token, approved test business/phone assets and required permissions.
- Operator-managed credential keyring and AI approval/provider secret if AI is to be exercised.
- Hosted CI run and named on-call/incident owner.
