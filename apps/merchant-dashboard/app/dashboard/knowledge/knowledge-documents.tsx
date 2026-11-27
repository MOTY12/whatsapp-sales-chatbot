'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './knowledge.module.css';

type DocumentItem = {
  id: string;
  title: string;
  status: string;
  revision_id: string | null;
  revision_status: string | null;
  page_count: number | null;
  size_bytes: number | null;
  preview: string | null;
  created_at: string;
  updated_at: string;
};
type UploadIntent = {
  documentId: string;
  revisionId: string;
  uploadUrl: string;
  headers: Record<string, string>;
};
type Props = { businessId: string };
type IndexStatus = {
  generation_id: string;
  status: string;
  chunk_count: number;
  expected_chunks: number;
  indexed_at: string | null;
  failure_category: string | null;
  semantic_ready: boolean;
  semantic_search_enabled?: boolean;
};

function csrfHeaders() {
  const headers = new Headers({ Accept: 'application/json' });
  const cookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('kleva_csrf='));
  if (cookie)
    headers.set(
      'X-CSRF-Token',
      decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)),
    );
  return headers;
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = csrfHeaders();
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  const response = await fetch(path, { ...init, headers, cache: 'no-store' });
  if (response.status === 401) {
    window.dispatchEvent(new Event('kleva-session-expired'));
    throw new Error('Your session expired. Sign in again.');
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(
      body?.error?.message ?? 'The document request could not be completed.',
    );
  }
  return response.json() as Promise<T>;
}

export function KnowledgeDocuments({ businessId }: Props) {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [indexes, setIndexes] = useState<
    Record<string, IndexStatus | undefined>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await apiJson<DocumentItem[]>(
      `/api/knowledge/${businessId}/documents`,
    );
    setDocuments(result);
    const statuses = await Promise.all(
      result.map(async (document) => {
        if (document.status !== 'PUBLISHED')
          return [document.id, undefined] as const;
        try {
          const rows = await apiJson<IndexStatus[]>(
            `/api/knowledge/${businessId}/documents/${document.id}/index-status`,
          );
          return [document.id, rows[0]] as const;
        } catch {
          return [document.id, undefined] as const;
        }
      }),
    );
    setIndexes(Object.fromEntries(statuses));
  }, [businessId]);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const result = await apiJson<DocumentItem[]>(
          `/api/knowledge/${businessId}/documents`,
        );
        if (active) {
          setDocuments(result);
          const statuses = await Promise.all(
            result.map(async (document) => {
              if (document.status !== 'PUBLISHED')
                return [document.id, undefined] as const;
              try {
                const rows = await apiJson<IndexStatus[]>(
                  `/api/knowledge/${businessId}/documents/${document.id}/index-status`,
                );
                return [document.id, rows[0]] as const;
              } catch {
                return [document.id, undefined] as const;
              }
            }),
          );
          if (active) setIndexes(Object.fromEntries(statuses));
        }
      } catch (reason) {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Could not load documents.',
          );
      }
    };
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [businessId]);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get('file');
    const title = String(form.get('title') ?? '').trim();
    if (
      !(file instanceof File) ||
      file.size < 1 ||
      file.size > 10 * 1024 * 1024 ||
      file.type !== 'application/pdf' ||
      !file.name.toLowerCase().endsWith('.pdf')
    ) {
      setError('Choose a non-empty PDF file up to 10 MB.');
      return;
    }
    if (!title || title.length > 160) {
      setError('Document title must be 1–160 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const bytes = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const checksum = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      const intent = await apiJson<UploadIntent>(
        `/api/knowledge/${businessId}/documents/uploads`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({
            title,
            fileName: file.name,
            contentType: 'application/pdf',
            sizeBytes: file.size,
            sha256: checksum,
          }),
        },
      );
      const stored = await fetch(intent.uploadUrl, {
        method: 'PUT',
        headers: intent.headers,
        body: bytes,
        credentials: 'omit',
      });
      if (!stored.ok)
        throw new Error(
          'Private storage rejected the upload. Check the bucket CORS settings and try again.',
        );
      await apiJson(
        `/api/knowledge/${businessId}/documents/${intent.revisionId}/complete`,
        { method: 'POST' },
      );
      setNotice(
        'PDF uploaded and queued for text extraction. It will remain a draft until you publish it.',
      );
      formElement.reset();
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'The PDF could not be uploaded.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function publication(document: DocumentItem, publish: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiJson(
        `/api/knowledge/${businessId}/documents/${document.id}/${publish ? 'publish' : 'unpublish'}`,
        { method: 'POST' },
      );
      setNotice(
        publish
          ? 'Document published and available to WhatsApp and website chat retrieval.'
          : 'Document unpublished and no longer used by customer retrieval.',
      );
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not update document publication.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function reindex(document: DocumentItem) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiJson(
        `/api/knowledge/${businessId}/documents/${document.id}/reindex`,
        { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } },
      );
      setNotice(
        'Semantic indexing queued. Keyword search remains available while it builds.',
      );
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not queue semantic indexing.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={styles.documentPanel}
      aria-labelledby="documents-heading"
    >
      <div className={styles.documentHeading}>
        <div>
          <span className="eyebrow">PRIVATE DOCUMENT SOURCES</span>
          <h2 id="documents-heading">Business documents</h2>
          <p>
            Upload text-based PDF price lists, policies, manuals or brochures.
            Documents stay private and unpublished until you approve them.
          </p>
        </div>
      </div>
      <form className={styles.documentUploadForm} onSubmit={upload}>
        <label>
          Document title
          <input
            name="title"
            required
            maxLength={160}
            placeholder="e.g. Delivery and returns policy"
          />
        </label>
        <label>
          PDF file
          <input
            name="file"
            type="file"
            accept="application/pdf,.pdf"
            required
          />
        </label>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? 'Uploading…' : 'Upload PDF'}
        </button>
        <p className={styles.documentHelp}>
          PDF only · Maximum 10 MB · Text-based PDFs only; scanned image OCR is
          not included in this milestone.
        </p>
      </form>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.success} role="status">
          {notice}
        </p>
      )}
      <div className={styles.documentList} aria-live="polite">
        {documents.length === 0 ? (
          <p className={styles.documentHelp}>No documents uploaded yet.</p>
        ) : (
          documents.map((document) => (
            <article
              id={`document-${document.id}`}
              className={styles.documentCard}
              key={document.id}
            >
              <div className={styles.documentCardTop}>
                <div>
                  <h3>{document.title}</h3>
                  <p>
                    {document.page_count
                      ? `${document.page_count} pages`
                      : document.status === 'PROCESSING'
                        ? 'Extracting text…'
                        : 'PDF source'}
                  </p>
                </div>
                <span
                  className={`${styles.badge} ${document.status === 'PUBLISHED' ? styles.published : ''}`}
                >
                  {document.status}
                </span>
              </div>
              {document.preview && (
                <p className={styles.documentPreview}>
                  <strong>Page 1 preview:</strong> {document.preview}
                </p>
              )}
              {document.status === 'PUBLISHED' && (
                <div className={styles.documentIndexStatus} aria-live="polite">
                  <strong>Semantic index:</strong>{' '}
                  {indexes[document.id]?.semantic_ready &&
                  indexes[document.id]?.semantic_search_enabled
                    ? `Available · ${indexes[document.id]?.chunk_count ?? 0} chunks`
                    : indexes[document.id]?.semantic_ready
                      ? `Indexed · semantic search disabled · keyword fallback active`
                      : indexes[document.id]?.status === 'PENDING' ||
                          indexes[document.id]?.status === 'INDEXING'
                        ? `Indexing · ${indexes[document.id]?.chunk_count ?? 0}/${indexes[document.id]?.expected_chunks ?? 0} chunks`
                        : indexes[document.id]?.status === 'FAILED'
                          ? `Failed (${indexes[document.id]?.failure_category ?? 'INDEXING_FAILED'}) · keyword fallback active`
                          : 'Not indexed · keyword fallback active'}
                  {indexes[document.id]?.indexed_at &&
                    indexes[document.id]?.semantic_ready && (
                      <span>
                        {' '}
                        · Updated{' '}
                        {new Date(
                          indexes[document.id]!.indexed_at!,
                        ).toLocaleString()}
                      </span>
                    )}
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => void reindex(document)}
                    disabled={busy}
                  >
                    {indexes[document.id]?.status === 'FAILED'
                      ? 'Retry indexing'
                      : indexes[document.id]?.semantic_ready
                        ? 'Reindex'
                        : 'Build semantic index'}
                  </button>
                </div>
              )}
              {document.status === 'FAILED' && (
                <p className={styles.inlineError}>
                  This PDF could not be processed. Confirm that it is an
                  unlocked PDF with selectable text, then upload a clean copy.
                </p>
              )}
              <div className={styles.documentActions}>
                {document.status === 'DRAFT' && (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => void publication(document, true)}
                    disabled={busy}
                  >
                    Publish
                  </button>
                )}
                {document.status === 'PUBLISHED' && (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => void publication(document, false)}
                    disabled={busy}
                  >
                    Unpublish
                  </button>
                )}
                {document.status === 'DRAFT' && (
                  <span>
                    Ready for your review. Publish to enable retrieval.
                  </span>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
