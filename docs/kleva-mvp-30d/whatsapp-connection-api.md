# Supervised WhatsApp connection

Base path is `/merchant/businesses/:businessId/whatsapp`. All routes require the merchant session. Writes require an active owner, the configured merchant Origin and the CSRF header. Responses carry `Cache-Control: no-store`.

| Method | Request | Result |
| --- | --- | --- |
| GET | None | Status, or `{"status":"pending"}` before secure activation |
| POST | JSON `wabaId`, `phoneNumberId` and `accessToken` | 201 after verifying and activating the specified asset, or reconnecting the same inactive asset |
| PATCH /credential | JSON `accessToken` | 200 after re-verifying the already bound asset and replacing the credential |
| DELETE | None | 200 with inactive status and the encrypted credential cleared |

Status responses contain ID, WABA and phone IDs, display name, status and revision. Active owners, editors and agents can read status. Validation and Meta rejection return 400. Concurrent changes and reserved assets return 409. The server holds no database transaction open during Graph verification, and rechecks the owner on commit. A failed rotation leaves the prior credential unchanged. A connection survives disconnect as an ownership record. Connect never transfers it to another business.

The verifier uses the configured Graph API version. It checks the app and token with Meta's debug endpoint, verifies WhatsApp management and messaging scopes and targeted grants when returned, then checks WABA phone membership and app subscription. The supervisor must complete the subscription and use an approved asset before submission. The verifier checks the first page of each edge, up to 100 entries. It refuses activation without positive evidence. The fixture covers response shape and failure handling. Live provider verification is pending. [Token debug reference](https://developers.facebook.com/docs/graph-api/reference/debug_token/) · [WABA reference](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/)

## Deployment

Configure `WHATSAPP_CREDENTIAL_KEY_ID` and `WHATSAPP_CREDENTIAL_KEYS` in the runtime secret store. Supply a JSON object keyed by ID, with each value a randomly generated 32-byte base64url string. Deploy the same keyring to every API instance. AES-256-GCM uses a fresh 12-byte nonce and authenticates tenant ID, connection ID and key ID. Add a new key before selecting it for writes, then rotate each credential and retain previous keys until older ciphertext and backup retention are accounted for.

Apply `SecureWhatsAppCredentials1760000000007`, grant the runtime role SELECT and UPDATE of only expiry and revision for revocation fencing, and rerun `npm run auth:grant` as migration owner. The merchant login receives access to scoped functions. It has no credential table grants. With separate runtime and migration credentials, use the migration owner to run the following, replacing the role name.

```sql
GRANT SELECT ON public.whatsapp_credentials TO kleva_runtime_app;
GRANT UPDATE (expires_at, revision) ON public.whatsapp_credentials TO kleva_runtime_app;
```

Existing complete legacy connections can continue until an owner explicitly submits an authorized credential for supervised migration. The migration leaves legacy values in place for recovery. After cutover, secure lifecycle state suppresses legacy routing and sending for that business, and a trigger rejects legacy credential writes. The old Embedded Signup callback returns 410 for valid legacy state and exchanges no authorization code. WhatsApp users can continue onboarding with the current number or request supervised setup. Keep the platform onboarding asset separate from tenant assets.

Known expiration and Meta send error 190 fence further use of the affected credential revision. Disconnect blocks subsequent sends. A send already in flight may finish. Expect staging verification before pilot rollout. Once secure bindings exist, the migration refuses rollback that would drop the fence. Use a compatible application build or pause WhatsApp traffic during recovery.
