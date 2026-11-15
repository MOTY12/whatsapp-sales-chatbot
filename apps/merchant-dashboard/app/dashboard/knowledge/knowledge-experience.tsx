'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { KnowledgeFaq } from '@/lib/api';
import styles from './knowledge.module.css';

type Props = {
  businessId: string;
  initialFaqs: KnowledgeFaq[];
  initialError: string | null;
};
type ApiFailure = { error?: { code?: string; message?: string } };

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.method && init.method !== 'GET') {
    const csrf = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('kleva_csrf='));
    if (csrf)
      headers.set(
        'X-CSRF-Token',
        decodeURIComponent(csrf.slice(csrf.indexOf('=') + 1)),
      );
  }
  const response = await fetch(path, { ...init, headers, cache: 'no-store' });
  if (response.status === 401) {
    window.dispatchEvent(new Event('kleva-session-expired'));
    throw new Error('Your session expired. Sign in again.');
  }
  if (!response.ok) {
    const failure = (await response
      .json()
      .catch(() => null)) as ApiFailure | null;
    throw new Error(
      failure?.error?.message ??
        'The knowledge base could not be updated. Try again.',
    );
  }
  return response.json() as Promise<T>;
}

function timestamp(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
    : 'Recently';
}

function upsert(current: KnowledgeFaq[], faq: KnowledgeFaq) {
  return [faq, ...current.filter((item) => item.id !== faq.id)].sort(
    (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
  );
}

export function KnowledgeExperience({
  businessId,
  initialFaqs,
  initialError,
}: Props) {
  const router = useRouter();
  const [faqs, setFaqs] = useState(initialFaqs);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialFaqs[0]?.id ?? null,
  );
  const [question, setQuestion] = useState(initialFaqs[0]?.question ?? '');
  const [answer, setAnswer] = useState(initialFaqs[0]?.answer ?? '');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'DRAFT' | 'PUBLISHED'>('ALL');
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [mobileEditorOpen, setMobileEditorOpen] = useState(
    Boolean(initialFaqs[0]),
  );
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  useEffect(() => {
    const onSessionExpired = () => router.push('/login?error=session');
    window.addEventListener('kleva-session-expired', onSessionExpired);
    return () =>
      window.removeEventListener('kleva-session-expired', onSessionExpired);
  }, [router]);
  const createKey = useRef<{ text: string; key: string } | null>(null);
  const selected = faqs.find(({ id }) => id === selectedId) ?? null;
  const visible = useMemo(
    () =>
      faqs.filter((faq) => {
        if (filter !== 'ALL' && faq.status !== filter) return false;
        const value = search.trim().toLocaleLowerCase();
        return (
          !value ||
          `${faq.question} ${faq.answer}`.toLocaleLowerCase().includes(value)
        );
      }),
    [faqs, filter, search],
  );

  function select(faq: KnowledgeFaq) {
    setSelectedId(faq.id);
    setQuestion(faq.question);
    setAnswer(faq.answer);
    setError(null);
    setNotice(null);
    setConfirmUnpublish(false);
    setMobileEditorOpen(true);
  }

  function createNew() {
    setSelectedId(null);
    setQuestion('');
    setAnswer('');
    setError(null);
    setNotice(null);
    setConfirmUnpublish(false);
    setMobileEditorOpen(true);
    createKey.current = null;
  }

  function validate() {
    if (!question.trim()) return 'Add a question before saving.';
    if (question.trim().length > 500)
      return 'Keep the question under 500 characters.';
    if (!answer.trim()) return 'Add an answer before saving.';
    if (answer.trim().length > 5000)
      return 'Keep the answer under 5,000 characters.';
    return null;
  }

  async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      let saved: KnowledgeFaq;
      if (!selected) {
        const text = `${question.trim()}\u0000${answer.trim()}`;
        const key =
          createKey.current?.text === text
            ? createKey.current.key
            : window.crypto.randomUUID();
        createKey.current = { text, key };
        saved = await requestJson<KnowledgeFaq>(
          `/api/knowledge/${businessId}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': key,
            },
            body: JSON.stringify({ question, answer }),
          },
        );
        createKey.current = null;
        setNotice(
          'Draft saved. It is not visible to customer replies until you publish it.',
        );
      } else {
        saved = await requestJson<KnowledgeFaq>(
          `/api/knowledge/${businessId}/${selected.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question,
              answer,
              expectedRevision: selected.revision,
            }),
          },
        );
        setNotice(
          saved.has_unpublished_changes
            ? 'Draft saved. The currently published answer remains live until you publish this revision.'
            : 'Draft saved.',
        );
      }
      setFaqs((current) => upsert(current, saved));
      setSelectedId(saved.id);
      setQuestion(saved.question);
      setAnswer(saved.answer);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not save this draft.',
      );
    } finally {
      setPending(false);
    }
  }

  async function changePublication(publish: boolean) {
    if (!selected || pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    setConfirmUnpublish(false);
    try {
      const result = await requestJson<KnowledgeFaq>(
        `/api/knowledge/${businessId}/${selected.id}/${publish ? 'publish' : 'unpublish'}`,
        { method: 'POST' },
      );
      setFaqs((current) => upsert(current, result));
      setQuestion(result.question);
      setAnswer(result.answer);
      setNotice(
        publish
          ? 'This FAQ revision is published and available to the knowledge retrieval service.'
          : 'This FAQ is unpublished and no longer available to customer retrieval.',
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not update publication.',
      );
    } finally {
      setPending(false);
    }
  }

  const isDirty = selected
    ? selected.question !== question || selected.answer !== answer
    : !!question || !!answer;
  return (
    <section className={styles.workspace} aria-label="FAQ knowledge management">
      <aside
        className={`${styles.listPanel} ${mobileEditorOpen ? styles.mobileHidden : ''}`}
      >
        <div className={styles.listHeading}>
          <div>
            <h2>FAQs</h2>
            <p>Approved answers for your customers</p>
          </div>
          <span className={styles.total}>{faqs.length}</span>
        </div>
        <button
          type="button"
          className="button button-primary"
          onClick={createNew}
        >
          + New FAQ
        </button>
        <label className={styles.searchLabel} htmlFor="faq-search">
          Search knowledge
        </label>
        <input
          id="faq-search"
          className={styles.search}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search questions and answers"
        />
        <div className={styles.filters} role="group" aria-label="Filter FAQs">
          {(['ALL', 'DRAFT', 'PUBLISHED'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === 'ALL'
                ? 'All'
                : value === 'DRAFT'
                  ? 'Drafts'
                  : 'Published'}
            </button>
          ))}
        </div>
        {error && !faqs.length ? (
          <div className={styles.listState} role="alert">
            <p>{error}</p>
            <button
              className="button button-secondary"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className={styles.listState}>
            <strong>{faqs.length ? 'No matching FAQs' : 'No FAQs yet'}</strong>
            <p>
              {faqs.length
                ? 'Try another search or status filter.'
                : 'Add your first answer. New content stays a draft until you publish it.'}
            </p>
          </div>
        ) : (
          <div className={styles.faqList} aria-label="FAQ entries">
            {visible.map((faq) => (
              <button
                key={faq.id}
                type="button"
                className={`${styles.faqItem} ${faq.id === selectedId ? styles.selected : ''}`}
                aria-pressed={faq.id === selectedId}
                onClick={() => select(faq)}
              >
                <span className={styles.itemHeading}>
                  <strong>{faq.question}</strong>
                  <span
                    className={`${styles.badge} ${faq.status === 'PUBLISHED' ? styles.published : ''}`}
                  >
                    {faq.status === 'PUBLISHED' ? 'Published' : 'Draft'}
                  </span>
                </span>
                {faq.has_unpublished_changes && (
                  <span className={styles.unpublishedHint}>
                    Unpublished changes awaiting review
                  </span>
                )}
                <span className={styles.itemAnswer}>{faq.answer}</span>
                <time dateTime={faq.updated_at}>
                  Updated {timestamp(faq.updated_at)}
                </time>
              </button>
            ))}
          </div>
        )}
        {initialError && faqs.length > 0 && (
          <p className={styles.inlineError} role="status">
            {initialError}
          </p>
        )}
      </aside>

      <div
        className={`${styles.editorPanel} ${mobileEditorOpen ? styles.mobileEditorOpen : ''}`}
      >
        <div className={styles.editorHeading}>
          <button
            type="button"
            className={styles.backButton}
            onClick={() => setMobileEditorOpen(false)}
            aria-label="Back to FAQ list"
          >
            ← <span>FAQs</span>
          </button>
          <div>
            <span className="eyebrow">PLAIN-TEXT BUSINESS KNOWLEDGE</span>
            <h2>{selected ? 'Edit FAQ' : 'Create FAQ'}</h2>
            <p>
              {selected
                ? `Revision ${selected.revision}${selected.published_revision ? ` · Published revision ${selected.published_revision}` : ''}`
                : 'Start with a customer question and a clear, approved answer.'}
            </p>
          </div>
          {selected && (
            <span
              className={`${styles.badge} ${selected.status === 'PUBLISHED' ? styles.published : ''}`}
            >
              {selected.status}
            </span>
          )}
        </div>
        {selected?.has_unpublished_changes && (
          <div className={styles.reviewNotice} role="status">
            <strong>Unpublished changes awaiting review.</strong> Customer
            retrieval still uses published revision{' '}
            {selected.published_revision}.
          </div>
        )}
        {selected &&
          selected.status === 'PUBLISHED' &&
          !selected.has_unpublished_changes && (
            <div className={styles.liveNotice} role="status">
              <strong>Published and live.</strong> Customer retrieval uses
              revision {selected.published_revision}. Updated{' '}
              {selected.published_at
                ? timestamp(selected.published_at)
                : timestamp(selected.updated_at)}
              .
            </div>
          )}
        {notice && (
          <p className={styles.success} role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <form className={styles.editorForm} onSubmit={saveDraft}>
          <label htmlFor="faq-question">
            Customer question <span>Required</span>
          </label>
          <input
            id="faq-question"
            value={question}
            onChange={(event) => {
              setQuestion(event.target.value);
              setError(null);
            }}
            maxLength={500}
            placeholder="For example: What are your opening hours?"
          />
          <small>{question.length} / 500 characters</small>
          <label htmlFor="faq-answer">
            Approved answer <span>Required</span>
          </label>
          <textarea
            id="faq-answer"
            value={answer}
            onChange={(event) => {
              setAnswer(event.target.value);
              setError(null);
            }}
            maxLength={5000}
            rows={9}
            placeholder="Write the business-approved answer in plain text…"
          />
          <small>
            {answer.length.toLocaleString()} / 5,000 characters · Plain text
            only
          </small>
          <div className={styles.safetyNote}>
            <span aria-hidden="true">ⓘ</span>
            <p>
              Only published answers can be returned to customers. Text is
              displayed literally; HTML and scripts are never run.
            </p>
          </div>
          <div className={styles.actions}>
            <div>
              {selected && (
                <p>
                  {selected.status === 'PUBLISHED'
                    ? 'Changes are saved as a draft and will not replace the live answer until published.'
                    : 'This FAQ is a draft and is not visible to customer retrieval.'}
                </p>
              )}
            </div>
            <div className={styles.actionButtons}>
              <button
                type="submit"
                className="button button-secondary"
                disabled={pending || !isDirty}
              >
                {pending ? 'Saving…' : 'Save draft'}
              </button>
              {selected &&
                (selected.status === 'DRAFT' ||
                  selected.has_unpublished_changes) && (
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={pending || isDirty}
                    onClick={() => void changePublication(true)}
                  >
                    {pending ? 'Publishing…' : 'Publish FAQ'}
                  </button>
                )}
              {selected?.status === 'PUBLISHED' && (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={pending}
                  onClick={() => setConfirmUnpublish(true)}
                >
                  Unpublish
                </button>
              )}
            </div>
          </div>
          {confirmUnpublish && (
            <div
              className={styles.confirmation}
              role="group"
              aria-label="Confirm unpublishing FAQ"
            >
              <p>
                Unpublishing removes this answer from future customer retrieval.
                Existing message history is unchanged.
              </p>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setConfirmUnpublish(false)}
              >
                Keep published
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={pending}
                onClick={() => void changePublication(false)}
              >
                Confirm unpublish
              </button>
            </div>
          )}
        </form>
      </div>
    </section>
  );
}
