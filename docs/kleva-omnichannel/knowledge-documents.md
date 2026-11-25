# KNOWLEDGE-002: private PDF knowledge documents

Semantic indexing and retrieval for published FAQ, product, and document revisions are described in [KNOWLEDGE-003](semantic-knowledge-index.md). Semantic search is disabled by default and does not change merchant publication state.

Kleva accepts merchant-authorized, text-based PDF uploads up to 10 MiB. Upload URLs expire after 15 minutes. Each source is stored in a private, versioned S3-compatible bucket and is pinned to the exact version whose byte length and SHA-256 checksum were verified by the backend. Extracted pages retain page numbers and remain drafts until an owner or editor publishes them.

Published pages join the existing PostgreSQL full-text retrieval used by both WhatsApp and website chat. This milestone does not perform OCR, create embeddings, re-chunk pages, or publish extracted content automatically. Unsupported, scanned, encrypted, or over-limit PDFs fail closed. Extraction runs in a child Node process with a 256 MiB heap cap, a 20-second parent timeout, and bounded page and text output. The parser receives only the uploaded byte buffer and does not fetch remote resources.

## Object storage configuration

Set `KNOWLEDGE_S3_BUCKET` and `KNOWLEDGE_S3_REGION`. `KNOWLEDGE_S3_ENDPOINT` is optional for compatible private object stores. `KNOWLEDGE_S3_FORCE_PATH_STYLE` defaults to `false`. Provide `KNOWLEDGE_S3_ACCESS_KEY_ID` and `KNOWLEDGE_S3_SECRET_ACCESS_KEY` together only when the runtime identity cannot use the AWS default credential chain. Do not place credentials in source control.

Before enabling the upload endpoint:

1. Enable bucket versioning and block all public access. The backend rejects uploads if versioning is disabled.
2. Configure server-side encryption. Kleva requests S3-managed AES256 encryption on upload.
3. Limit runtime identity access to this bucket and prefix. It needs bucket versioning status, PUT/HEAD, read of exact object versions, list object versions, and delete object versions for abandoned upload cleanup. It does not need bucket-wide public access or ACL permissions.
4. Configure bucket CORS for the exact dashboard origin(s), `PUT`, and the `content-type`, `x-amz-checksum-sha256`, and `x-amz-server-side-encryption` request headers. Expose no read origin to the public widget.
5. Restrict network egress and access keys using the infrastructure's normal controls. Presigned URLs are bearer credentials and must not be logged.
6. Run the additive migration `KnowledgeDocumentUploads1760000000031` with the migration role. Merchant roles receive execute grants on tenant-checked functions only; the runtime role receives narrowly scoped worker and search function grants.

The API and worker can start without these values, but upload requests fail with a safe unavailable response until storage is configured. Required variables are never emitted in logs.

## Workflow and recovery

`POST /merchant/businesses/:businessId/knowledge-documents/uploads` creates an upload intent and returns a 15-minute presigned PUT. The dashboard sends the PDF directly to object storage, then calls `POST .../uploads/:revisionId/complete`. Completion checks object size, PDF media type, checksum and a nonempty version ID before atomically pinning that version and adding `knowledge.document.extract` to the PostgreSQL outbox. Redis carries only the outbox reference. Repeated completion is idempotent for the same object version.

The worker downloads the pinned version, verifies SHA-256 again, extracts bounded page text in an isolated child process, and saves the page records. A permanent extraction rejection gives the source a safe failure category; transient storage/database faults are retried by the existing outbox policy. Expired incomplete intents are atomically marked expired, then every version for that unique server-generated object key is removed. A cleanup failure is retried by the worker.

The merchant can list documents, see extraction status and a bounded first-page preview, publish a ready draft, or unpublish it. Publication state is checked again before generated answers are sent; a document unpublished or republished after generation cannot support a stale reply.

## Known boundary

Scanned image PDFs need OCR in a later milestone. KNOWLEDGE-003 owns semantic chunking, embeddings and reindexing. Bucket provisioning, service identity, exact dashboard CORS origin, TLS, backup policy and any organization-specific retention period are infrastructure decisions that must be completed outside the application.
