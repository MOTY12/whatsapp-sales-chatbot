# Channel adapter design

Keep adapters in `src/channels/adapters/<provider>`. Wrap the current WhatsApp parser and sender behind the first adapter. Provider-specific headers, media payloads, tokens and statuses terminate there. The agent sees internal identifiers, message parts, and an allowed action set.

```ts
interface ChannelAdapter {
  readonly provider: ChannelProvider
  capabilities(connection: ChannelConnectionView): ChannelCapabilities
  verify(input: RawWebhook): Promise<VerifiedEnvelope>
  normalize(event: VerifiedEnvelope): NormalizedEvent[]
  send(connection: ChannelConnectionView, intent: AuthorizedSend): Promise<SendOutcome>
  resolveMedia(connection: ChannelConnectionView, media: MediaReference): Promise<MediaStream>
  probe(connection: ChannelConnectionView): Promise<ConnectionHealth>
  refresh?(connection: ChannelConnectionView): Promise<CredentialUpdate>
  revoke?(connection: ChannelConnectionView): Promise<void>
}
```

The webhook controller passes immutable raw bytes, a validated header map and receiving endpoint identity. Provider challenges have a dedicated verified response. Verified envelopes normalize to inbound message, delivery status, or connection event with provider event ID, external receiving asset, external sender/thread, occurrence timestamp and typed parts. For providers without stable event IDs, define and test a provider-specific canonical deduplication key. Unsupported or unroutable authenticated events produce bounded diagnostics. Signed accepted events are acknowledged after durable receipt and outbox commit. Transient persistence failure returns a retriable status. Resolve the business only from the provider asset mapping. Never accept business ID or routing overrides from a webhook body.

The capability registry evaluates provider, connection permissions, jurisdiction where needed, message type, recipient consent, window and feature flags. It distinguishes inbound, freeform, approved template, status, attachments, refresh and human response permissions. Default unknown capabilities to disabled. Store a capability snapshot with provider version and verification date for each connection. Refresh it after grant changes, revoke or disconnect on permanent permission failure and park queued sends until reviewed.

A send intent contains business, connection, conversation, internal message, recipient reference, content/template revision, expected control and connection versions, and stable logical operation ID. Outbound writes are audited and persisted before dispatch. Recheck membership for manual actions, active connection, automation flag, latest inbound timestamp, window and opt-out at dispatch. Apply provider and recipient rate buckets and provider retry guidance. Persist provider ID on acceptance. A timeout after dispatch is uncertain and must not blindly resend. Use official reconciliation where available or present uncertainty to the operator. Track accepted, delivered, read and failed only when the provider supports them. Deduplicate and reconcile early/out-of-order statuses without regressing the displayed state.

Authorize connection creation to the owner. Bind signup attempt to owner/business, state nonce and expiry. Validate returned account/asset and subscription before activating. Encrypt credentials with tenant-bound authenticated encryption and a versioned KMS envelope. Store current and previous version IDs for safe reconciliation, never credentials in queues or logs. Disconnect bumps the connection version, clears use of secrets and fences sends. Keep historical records tied to the original connection. Operator handles ambiguous transfer across businesses.

Normalize attachments to typed references with size, MIME, checksum and provider asset ID. Fetch via provider-authenticated allowlisted URLs, cap downloads and scan before use. Store in private tenant paths. Customer-supplied content is untrusted and outside the authoritative knowledge index. Start with text and supported attachment metadata. Each adapter must pass shared contract fixtures and its own sandbox acceptance. See the [platform matrix](platform-capability-matrix.md).
