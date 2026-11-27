# Merchant AI pilot API

All routes require an authenticated merchant session. Mutating requests also require the existing CSRF token. The backend sets the selected `businessId` and session scope before running tenant authorization checks; a request body cannot choose a different tenant.

## Read readiness and automation state

`GET /merchant/businesses/:businessId/pilot` returns the current enrollment plus:

- `automation_status`: `OFF`, `PENDING_APPROVAL`, `READY`, or `ACTIVE`.
- `activation_ready`: all merchant setup requirements, global AI enablement and positive remaining quotas are satisfied.
- `assistant_ready`: activation readiness, Kleva operator approval, and approval for the current WhatsApp connection are all verified.
- `connection_id` and `human_takeover_count`.
- `prerequisites`: `businessActive`, `whatsappConnectedAndVerified`, `publishedKnowledge`, `assistantConfigured`, `pilotApproved`, `approvalMatchesConnection`, `aiResponsesEnabled`, and `usageQuotaReady`. Quota readiness includes positive monthly AI input/output and WhatsApp allowances plus a positive per-request AI token limit.

The backend computes these values from PostgreSQL and current runtime configuration. The dashboard must not infer an ACTIVE state from a connected phone number or a prior enrollment alone.

## Request owner consent and pilot review

`POST /merchant/businesses/:businessId/pilot/enroll` accepts:

```json
{
  "connectionId": "<verified connection UUID>",
  "consentVersion": "pilot-merchant-v1",
  "aiProviderDisclosureAccepted": true,
  "humanEscalationAccepted": true
}
```

Only a business owner can submit. The server requires `activation_ready`, checks the active connection and stores the consent against that connection. This submits a review request; customer replies remain disabled while `PENDING_REVIEW`. A Kleva pilot operator must approve it using the restricted database operator function and a recorded evidence reference. Live AI remains disabled if the current approved connection changes, the business or channel is inactive, required published knowledge/settings disappear, the global AI flag is off, or quota is exhausted.

## Revoke or withdraw

`POST /merchant/businesses/:businessId/pilot/:enrollmentId/revoke` accepts the normal CSRF-protected request and requires owner permission. The revoke operation changes the enrollment state immediately. AI generation, tool writes, queued outbound work and dispatch recheck pilot approval and conversation control before continuing.

## Rollout notes

Apply migration `1760000000028-AgentActivationAndMemory` before deploying the code that reads the readiness function or summary table. It adds tenant-scoped durable conversation summaries and operator activation checks. Keep `AI_RESPONSES_ENABLED=false` until staging verifies merchant opt-in, operator approval, current Meta assets, customer opt-out handling, model behavior and rollback controls. This API does not prove external Meta or model-provider eligibility.

## Separate commercial pilot account

Commercial offers, invoices and payments are a separate domain from WhatsApp AI activation. See [commercial pilot API and operations](../kleva-omnichannel/commercial-pilot.md).

- `GET /merchant/businesses/:businessId/commercial` returns only the authenticated tenant's commercial account, offer acceptance evidence, invoice/payment history and current entitlements.
- `GET /merchant/businesses/:businessId/commercial/readiness` returns backend-derived setup blockers scoped to the enrollment's selected channels. A website-only package does not require Meta assets; that result does not activate the website assistant.
- `POST /merchant/businesses/:businessId/commercial/offers/:offerId/accept` requires the existing merchant session, CSRF protection, owner permission and a request key. It records agreement acceptance atomically and does not approve a WhatsApp pilot or enable AI.

Commercial payment status and commercial enrollment status do not replace the WhatsApp pilot endpoints above. Merchant payment claims cannot confirm invoices. Commercial operator mutations are available only through the restricted operator CLI and permission groups; no operator HTTP API is exposed. Local integration evidence is separate from approved terms, actual merchant consent, external payment settlement and staging QA.
