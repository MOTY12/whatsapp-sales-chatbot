# WhatsApp provisioning lifecycle and operations

## Current connection flow

1. An active business owner starts an attempt. PostgreSQL binds it to the business, account, session digest, 15-minute expiry and an attempt version.
2. Meta Embedded Signup v4 returns an authorization code separately from the selected WABA and phone number. The dashboard accepts messages only from HTTPS Facebook origins and sends the code to the authenticated same-origin backend bridge.
3. NestJS atomically claims the attempt and exchanges the code with Meta under a five-second timeout. The token and current standard Cloud API registration PIN are encrypted immediately with tenant/connection-bound AES-256-GCM. The same PostgreSQL transaction creates the pending credential record and `whatsapp.connection.provision` outbox operation. BullMQ carries only an attempt UUID.
4. The worker uses the outbox lease to load the pending envelope, checks the still-valid merchant session, business and owner membership, then asks Meta to validate app identity, scopes and the exact WABA/phone association before making provider changes.
5. The worker subscribes the selected WABA, registers the number for the configured standard Cloud API flow, verifies asset membership and app subscription, then activates the existing ChannelConnection transactionally. Checkpoints and outbox leases fence stale/retried workers. Reconnect retains the previous credential until activation succeeds.
6. The owner dashboard reads persisted stages and never treats initial HTTP acceptance as a completed connection. Failed and action-required states expose only safe categories.

## Local verification

Run migrations as the migration owner, then run `npm run auth:grant` so the restricted merchant role receives the new attempt and staging function grants. Run the backend worker with the existing backend runtime database identity and Redis configuration. A migration rollback is permitted only on an empty disposable database with no pending or completed provisioning operation history.

Automated provider tests use deterministic Jest mocks. They do not establish live Meta authorization, phone registration or webhook receipt. Staging acceptance still requires approved Meta app configuration and a permitted business asset.

## Credential encryption

`WHATSAPP_KEY_PROVIDER=local` retains the existing local AES-256-GCM keyring for development. `WHATSAPP_KEY_PROVIDER=aws_kms` opts in to AWS KMS envelope encryption and requires `WHATSAPP_KMS_KEY_ARN` plus a matching `AWS_REGION`; invalid or missing KMS settings fail closed without falling back to local encryption. A random AES-256 data key is generated per secret, used for AES-GCM encryption, and wrapped with KMS `GenerateDataKey`. The envelope stores the wrapped key, KMS key identity, version, nonce, ciphertext and authentication tag. Business and connection IDs bind both KMS encryption context and AES-GCM associated data.

Grant the application workload role only `kms:GenerateDataKey` and `kms:Decrypt` on a dedicated symmetric encryption key. Use the AWS SDK default role credential chain rather than static credentials. See the [KMS GenerateDataKey API](https://docs.aws.amazon.com/kms/latest/APIReference/API_GenerateDataKey.html) and [encryption context guidance](https://docs.aws.amazon.com/kms/latest/developerguide/encrypt_context.html). Local envelopes remain readable during migration if their prior `WHATSAPP_CREDENTIAL_KEY_ID` and `WHATSAPP_CREDENTIAL_KEYS` are retained. Keep prior KMS keys enabled for decryption until a verified re-encryption migration is complete. The legacy plaintext business-token batch migration and dry-run command are not implemented in this milestone.

## Meta configuration gates (verified against official documentation 2026-11-25)

- Use the current Embedded Signup v4 flow and matching Facebook Login for Business configuration. Meta's current implementation page documents the v4 SDK code response and `WA_EMBEDDED_SIGNUP` completion message.
- Configure the approved app, allowed HTTPS domain, requested WhatsApp permissions, `account_update` and message webhooks, and required Advanced Access before Live-mode merchant onboarding.
- The current API registers a standard Cloud API phone through `/{phone-number-id}/register` with `messaging_product` and a two-step verification PIN. This PIN is not the SMS/voice verification code.
- Meta account/app approval, the business owner's selected assets, ownership/verification and phone eligibility are distinct from Kleva AI activation. WhatsApp connection does not enable live AI replies.

Sources: [Embedded Signup implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/), [Embedded Signup v4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4), [server-side Tech Provider onboarding](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider/), [token debug endpoint](https://developers.facebook.com/docs/graph-api/reference/debug_token/), [phone registration](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account-to-number-current-status/register/), [WABA webhook subscription](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/subscribed_apps/).

## Open production work

- AWS KMS envelope encryption is implemented but has only deterministic local SDK-fixture tests; a real KMS key, workload IAM policy, key rotation and operational recovery have not been verified in AWS. The legacy plaintext business-token batch migration and dry-run are not implemented.
- No automated migration or cutover of legacy plaintext business access tokens exists. Keep legacy values for rollback and do not claim an unverified legacy owner.
- Coexistence/flows that skip Cloud API registration are not supported by the current configured workflow. Do not add them without a documented Meta flow signal and provider tests.
- Retry after Meta accepts registration but its HTTP response is lost still needs staging validation and a provider-supported reconciliation policy. Never blindly reset a partial connection.
- Disconnect currently fences local routing/credentials; provider-side cleanup and shared-WABA-safe unsubscription need a separately verified cleanup operation.
