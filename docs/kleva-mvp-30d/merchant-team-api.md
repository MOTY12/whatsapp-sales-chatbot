# Merchant team management (TENANT-003)

This API builds on the merchant browser session and the existing fixed role matrix. Every business route uses `MerchantSessionGuard`; mutations also require the configured dashboard Origin and CSRF token. Responses use `Cache-Control: no-store`. Team administration is owner-only; WhatsApp approval is not required.

## Roles

| Role         | Existing permissions                                                                    | Team administration                                       |
| ------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Owner        | Business settings, channels, knowledge, assistant, inbox, sales, website and team       | Invite, list, change eligible roles, revoke, review audit |
| Editor       | Knowledge, assistant and sales operations already permitted by the authorization matrix | None                                                      |
| Agent        | Business read and shared inbox operations                                               | None                                                      |
| Legacy staff | No merchant browser permissions                                                         | None                                                      |

Only `editor` and `agent` can be assigned by an invitation. Ownership transfer is not implemented; role updates may demote an owner only when another active owner remains. Role changes and revocation require the current membership version. The database serializes owner modifications on the business row, and rejects changes that would remove the final owner.

## Routes

| Method | Path                                                                                                    | Behavior                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET    | `/merchant/businesses/:businessId/team?status=active&role=agent&search=name-or-email&limit=50&offset=0` | Owner-scoped searchable/paginated member list. `status` is `active` or `inactive`; role is owner/editor/agent/staff. |
| GET    | `/merchant/businesses/:businessId/team/:membershipId`                                                   | Owner-scoped membership detail.                                                                                      |
| PATCH  | `/merchant/businesses/:businessId/team/:membershipId`                                                   | Change role with `{ "role": "editor"                                                                                 | "agent", "version": 1 }`.            |
| POST   | `/merchant/businesses/:businessId/team/:membershipId/revoke`                                            | Revoke using `{ "version": 1 }`.                                                                                     |
| GET    | `/merchant/businesses/:businessId/team/invitations`                                                     | Invitation and email queue status.                                                                                   |
| POST   | `/merchant/businesses/:businessId/team/invitations`                                                     | Invite with `{ "email": "…", "role": "editor"                                                                        | "agent" }`and a v4`Idempotency-Key`. |
| POST   | `/merchant/businesses/:businessId/team/invitations/:invitationId/resend`                                | Rotate the invitation credential and queue a new message.                                                            |
| POST   | `/merchant/businesses/:businessId/team/invitations/:invitationId/revoke`                                | Revoke a pending invitation.                                                                                         |
| GET    | `/merchant/businesses/:businessId/team/audit`                                                           | Read the business team activity log.                                                                                 |
| POST   | `/merchant/invitations/accept`                                                                          | Authenticated recipient accepts `{ "token": "…" }`; email verification comes from the stored OIDC identity profile.  |

404 indicates an inaccessible or absent business/member/invitation. 403 indicates insufficient role or CSRF proof. Stale versions return 409. A last-owner attempt returns 409. Invitation attempts are limited per session, and creation/resend is rate limited.

## Invitation safety and email operations

- Invitation secrets contain 256 bits of randomness. PostgreSQL stores only SHA-256 digests; the same token is accepted once and only by an active merchant account with a verified, exact normalized email match.
- The URL is built from the configured `FRONTEND_URL`, never an incoming Host header. The `/invite/consume` Next.js handler puts a syntactically valid token in a short-lived, HttpOnly, SameSite=Lax cookie scoped to the acceptance API, redirects to a clean URL, and sets `Referrer-Policy: no-referrer`. The client does not place the token in local or session storage.
- Email delivery reuses the encrypted merchant-email payload and PostgreSQL outbox. Delivery status distinguishes pending, queued, accepted by Mailjet, and failure in the email delivery record; invitation status remains separate. “Queued” means Kleva accepted the delivery job, not that Mailjet delivered the message.
- Resend rotates the digest, invalidating the old link. Default lifetime is 72 hours; resend cooldown is 5 minutes, with up to 5 resends. Attempt limits default to 5 per session per hour. Configure `MERCHANT_INVITATION_TTL_SECONDS`, `MERCHANT_INVITATION_RESEND_COOLDOWN_SECONDS`, and `MERCHANT_INVITATION_MAX_ATTEMPTS` within the ranges enforced by `merchantTeamConfig()`.
- Apply the additive migration with the migration owner, then rerun `npm run auth:grant` so the provisioned merchant role receives only the listed SECURITY DEFINER function executions. Do not grant direct INSERT/UPDATE on memberships, invitation records, audit records, or invitation-attempt records.

## Revocation, inbox, and audit

Merchant API authorization is re-read from PostgreSQL membership state on every business request. Revocation does not revoke sessions for other businesses. Existing inbox assignments to a revoked or newly ineligible member are atomically cleared and recorded as assignment changes; existing messages and notes remain attributable to their original authors. SSE authorization is periodically revalidated by the existing inbox stream. Team audit writes occur in the same transaction as team changes and carry the validated request correlation ID when available. Audit data contains no invitation credentials or OIDC tokens.

## Onboarding and legacy ownership

Browser-created businesses keep using `kleva_create_merchant_business`, which atomically creates the business, owner membership, and idempotency receipt. Legacy WhatsApp registration now serializes requests by the supplied WhatsApp identity and commits business, legacy user, and legacy owner membership in one TypeORM transaction. That legacy identity remains separate from browser accounts.

**Legacy business claims are intentionally not enabled.** The reviewed records and provider integration do not expose an approved, independently verifiable ownership challenge channel for a browser merchant. A business name, public phone number, legacy WhatsApp ID, or unverified email is not sufficient evidence. Existing unlinked legacy businesses stay unclaimed until an approved ownership channel is configured; no account backfill is performed.

Team invitations are optional. They do not gate single-owner onboarding, website chat, WhatsApp setup, AI activation, or dashboard access. Existing owner approval and provider readiness gates remain in force.

## Operational follow-up

The legacy claim verification channel, real email-provider delivery events, deployed role-grant execution, and concurrent PostgreSQL integration verification are release checks. TENANT-003 remains `IN_PROGRESS` until the disposable PostgreSQL/Redis tests and dashboard acceptance run pass; do not mark this milestone VERIFIED based on a successful build alone.
