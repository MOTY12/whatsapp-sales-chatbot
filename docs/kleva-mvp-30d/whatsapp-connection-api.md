# Self-service WhatsApp connection

Base path is `/merchant/businesses/:businessId/whatsapp`. All routes require the merchant session. Writes require an active owner, the configured merchant Origin and the CSRF header. Responses carry `Cache-Control: no-store`. The dashboard loads the Meta JavaScript SDK on the WhatsApp page and starts Embedded Signup v4 from the owner's click. The App ID, configuration ID and Graph API version are returned by the authenticated start endpoint; the App Secret and exchanged business token remain server-side.

| Method                           | Request                                                                                             | Result                                                                                                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET                              | None                                                                                                | Connection state and account display details, without credentials                                                                                                                          |
| POST `/embedded-signup/start`    | Empty JSON object                                                                                   | Creates or resumes a short-lived attempt and returns public SDK settings                                                                                                                   |
| POST `/embedded-signup/complete` | `attemptId`, one-time authorization `code`, WABA ID, phone-number ID and six-digit registration PIN | Claims the attempt once, exchanges the short-lived code server-to-server, then atomically stages an encrypted credential and a `whatsapp.connection.provision` PostgreSQL outbox operation |
| POST `/embedded-signup/report`   | `attemptId`, outcome `action_required`, `failed` or `cancelled`                                     | Saves a safe recovery state without logging Meta payloads                                                                                                                                  |
| PATCH `/credential`              | JSON `accessToken`                                                                                  | Retained for authorized credential rotation of the already-bound asset                                                                                                                     |
| DELETE                           | None                                                                                                | Clears the encrypted credential and disconnects the channel while preserving the ownership record                                                                                          |

Connection states are `not_connected`, `connecting`, `action_required`, `failed` and `connected`. Status responses contain IDs, display name, display phone number, state, provisioning stage and safe failure class; they never contain access tokens, authorization codes, PINs or ciphertext. Active owners, editors and agents can read status; only owners can connect, reconnect and disconnect. New attempts are bound to business, owner account and session digest. A database unique index permits only one open attempt per business, and an atomic claim prevents callback replay and concurrent token exchanges. Expired attempts can be retried. Tenant scoped SECURITY DEFINER functions persist attempts and credentials while the restricted dashboard role receives only function EXECUTE grants.

The backend does not trust WABA or phone IDs reported by the browser on their own. It exchanges the short-lived code synchronously under a bounded HTTP timeout, immediately encrypts the token and temporary PIN, then commits the pending record and outbox intent in the same PostgreSQL transaction. BullMQ carries only the attempt UUID. A lease-fenced worker revalidates the active owner, business, token, app identity, permissions, exact WABA and phone relationship before any provider mutation. It records provisioning checkpoints, subscribes webhooks, registers the standard Cloud API number, verifies the app subscription and asset, and only then atomically activates the ChannelConnection. A failed reconnect keeps the current active credential until final activation. Credentials and temporary PIN use the existing tenant-and-connection bound AES-256-GCM envelope; the PIN envelope is deleted after finalization. Any failure leaves a safe attempt classification and never marks a pending connection active. A connection survives disconnect as an ownership record; an asset cannot be transferred to another business. The existing signed WhatsApp webhook and processing path remain unchanged.

The Web Embedded Signup v4 flow must be configured in Meta Login for Business. Meta requires a Tech Provider or Solution Partner, an HTTPS deployment host, allowed domains and valid OAuth redirect URI entries, a v4 Embedded Signup configuration, and the `account_update` webhook subscription. Configure Cloud API only and request Advanced Access for `whatsapp_business_management` and `whatsapp_business_messaging`. The app webhook must also subscribe to WhatsApp `messages` so inbound messages reach Kleva's existing endpoint. Local HTTP development may not be accepted as an allowed Meta domain; verify this in the Meta App Dashboard before testing. See [Meta Embedded Signup implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation), [v4 configuration and permissions](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4) and [server-side customer onboarding steps](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider).

Set these values in the backend runtime secret store (never in `NEXT_PUBLIC_*` variables):

```dotenv
META_APP_ID=<Meta app ID>
META_APP_SECRET=<Meta app secret>
WHATSAPP_BUSINESS_CONFIG_ID=<Facebook Login for Business configuration ID>
WHATSAPP_API_VERSION=v27.0
META_GRAPH_BASE_URL=https://graph.facebook.com
WHATSAPP_VERIFY_TOKEN=<random webhook verification value>
WHATSAPP_CREDENTIAL_KEY_ID=<active key ID>
WHATSAPP_CREDENTIAL_KEYS=<JSON key ID to 32-byte base64url key map>
```

Also set `DASHBOARD_PUBLIC_ORIGIN` to the exact dashboard origin for same-origin and CSRF checks. The `META_REDIRECT_URI` environment value is retained for the legacy supervised callback and is not sent for the Embedded Signup code exchange. Apply `MerchantEmbeddedWhatsApp1760000000022` and `DurableWhatsAppProvisioning1760000000035`, then rerun `npm run auth:grant` as migration owner so the restricted merchant role can execute only scoped signup/status/staging functions. Provisioning worker-only functions are granted to the backend database runtime identity, not the merchant role. The new migration refuses rollback while provisioning history exists.

The backend completes the WABA app subscription and phone-number registration asynchronously after signup. This flow currently targets standard Cloud API registration; the two-step verification PIN is requested before Meta signup and retained only as a short-lived encrypted envelope during provisioning. Meta phone verification and WhatsApp two-step PIN are distinct. Coexistence and onboarding modes that skip registration are not enabled by this configuration. The verifier uses the configured Graph API version. It checks the app and token with Meta's debug endpoint, verifies WhatsApp management and messaging scopes and targeted grants when returned, then checks WABA phone membership and app subscription. It checks the first page of each edge, up to 100 entries, and refuses activation without positive evidence. Automated fixtures cover response shape and failure handling; live provider verification remains pending until the Meta app and an eligible business asset are configured.

## Remaining hardening gates

- AWS KMS envelope encryption is now available with `WHATSAPP_KEY_PROVIDER=aws_kms`. It has a deterministic SDK fixture test but has not been validated against a provisioned AWS key or production workload IAM role.
- Existing local AES-256-GCM envelope format is retained for compatibility. No automatic legacy plaintext-token backfill or cutover is performed; use a dry-run migration and explicit verified ownership process before legacy conversion.
- The standard flow's registration PIN remains required. Determine an officially supported onboarding mode before enabling any flow that skips registration.
- Live-mode Advanced Access, Tech Provider/Solution Partner eligibility, webhook delivery and real merchant approval must be confirmed in Meta staging before external pilot use.

## Deployment

For development, set `WHATSAPP_KEY_PROVIDER=local` and configure `WHATSAPP_CREDENTIAL_KEY_ID` plus `WHATSAPP_CREDENTIAL_KEYS` in the runtime secret store. Each value is a randomly generated 32-byte base64url string. Deploy the same keyring to every API instance. AES-256-GCM uses a fresh 12-byte nonce and authenticates tenant ID, connection ID and key ID. Add a new key before selecting it for writes and retain prior keys while old envelopes or backups remain.

For AWS, explicitly set `WHATSAPP_KEY_PROVIDER=aws_kms`, `WHATSAPP_KMS_KEY_ARN` and matching `AWS_REGION`. Provision a dedicated symmetric KMS key and grant the API and worker workload role only `kms:GenerateDataKey` and `kms:Decrypt` on that key. The SDK uses workload credentials from the standard AWS identity chain. No KMS failure falls back to local encryption. If migrating from local envelopes, retain the old local key ID/keyring alongside KMS settings so old records remain decryptable until a separately reviewed re-encryption/cutover is complete.

Apply `SecureWhatsAppCredentials1760000000007`, grant the runtime role SELECT and UPDATE of only expiry and revision for revocation fencing, and rerun `npm run auth:grant` as migration owner. The merchant login receives access to scoped functions. It has no credential table grants. With separate runtime and migration credentials, use the migration owner to run the following, replacing the role name.

```sql
GRANT SELECT ON public.whatsapp_credentials TO kleva_runtime_app;
GRANT UPDATE (expires_at, revision) ON public.whatsapp_credentials TO kleva_runtime_app;
```

Existing complete legacy connections can continue until an owner explicitly submits an authorized credential for migration. The migration leaves legacy values in place for recovery. After cutover, secure lifecycle state suppresses legacy routing and sending for that business, and a trigger rejects legacy credential writes. The old Embedded Signup callback returns 410 for valid legacy state and exchanges no authorization code. New merchant connections use the self-service wizard; keep the platform onboarding asset separate from tenant assets.

Known expiration and Meta send error 190 fence further use of the affected credential revision. Disconnect blocks subsequent sends. A send already in flight may finish. Expect staging verification before pilot rollout. Once secure bindings exist, the migration refuses rollback that would drop the fence. Use a compatible application build or pause WhatsApp traffic during recovery.
