'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { KnowledgeGap, LearningSuggestion } from '@/lib/api';
import styles from './learning.module.css';

type Props = {
  businessId: string;
  initialGaps: KnowledgeGap[];
  initialError: string | null;
};
type Failure = { error?: { message?: string } };
type Filter = 'ALL' | KnowledgeGap['status'];

function csrfToken() {
  const part = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => /^(?:__Host-)?kleva_csrf=/i.test(entry));
  return part ? decodeURIComponent(part.slice(part.indexOf('=') + 1)) : '';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.method && init.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
    headers.set('X-CSRF-Token', csrfToken());
  }
  const response = await fetch(path, { ...init, headers, cache: 'no-store' });
  if (response.status === 401) {
    window.dispatchEvent(new Event('kleva-session-expired'));
    throw new Error('Your session expired. Sign in again.');
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as Failure | null;
    throw new Error(
      payload?.error?.message ?? 'Learning insights could not be updated.',
    );
  }
  return response.json() as Promise<T>;
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
    : 'Recently';
}

const categoryLabels: Record<KnowledgeGap['category'], string> = {
  MISSING_KNOWLEDGE: 'Missing business information',
  UNSUPPORTED_REQUEST: 'Unsupported request',
  CLARIFICATION_FAILURE: 'Could not resolve the question',
  STALE_KNOWLEDGE: 'Published information changed',
};

export function LearningGapsExperience({
  businessId,
  initialGaps,
  initialError,
}: Props) {
  const router = useRouter();
  const [gaps, setGaps] = useState(initialGaps);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<LearningSuggestion[]>([]);
  const [editingGap, setEditingGap] = useState<KnowledgeGap | null>(null);
  const [draftQuestion, setDraftQuestion] = useState('');
  const [draftAnswer, setDraftAnswer] = useState('');
  const [evaluationStatus, setEvaluationStatus] = useState<string | null>(null);
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});
  const [draftQuestions, setDraftQuestions] = useState<Record<string, string>>(
    {},
  );
  useEffect(() => {
    const onSessionExpired = () => router.push('/login?error=session');
    window.addEventListener('kleva-session-expired', onSessionExpired);
    return () =>
      window.removeEventListener('kleva-session-expired', onSessionExpired);
  }, [router]);

  const visible = useMemo(
    () => gaps.filter((gap) => filter === 'ALL' || gap.status === filter),
    [filter, gaps],
  );

  useEffect(() => {
    void request<{ items: LearningSuggestion[] }>(
      `/api/learning/${businessId}/suggestions`,
    )
      .then((result) => setSuggestions(result.items ?? []))
      .catch(() => undefined);
  }, [businessId]);

  async function createSuggestion() {
    if (!editingGap) return;
    setPendingId(editingGap.id);
    setError(null);
    try {
      const created = await request<{ id: string; version: number }>(
        `/api/learning/${businessId}/gaps/${editingGap.id}/suggestions`,
        {
          method: 'POST',
          body: JSON.stringify({
            question: draftQuestion,
            answer: draftAnswer,
          }),
        },
      );
      await request(
        `/api/learning/${businessId}/suggestions/${created.id}/submit`,
        {
          method: 'POST',
          body: JSON.stringify({ expectedVersion: created.version }),
        },
      );
      const result = await request<{ items: LearningSuggestion[] }>(
        `/api/learning/${businessId}/suggestions`,
      );
      setSuggestions(result.items ?? []);
      setEditingGap(null);
      setDraftAnswer('');
      setNotice(
        'Suggestion submitted for review. It is not live until you approve it and indexing succeeds.',
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Suggestion could not be saved.',
      );
    } finally {
      setPendingId(null);
    }
  }

  async function approveSuggestion(suggestion: LearningSuggestion) {
    setPendingId(suggestion.id);
    setError(null);
    try {
      await request(
        `/api/learning/${businessId}/suggestions/${suggestion.id}/approve`,
        {
          method: 'POST',
          body: JSON.stringify({
            expectedVersion: suggestion.version,
            idempotencyKey: crypto.randomUUID(),
          }),
        },
      );
      const result = await request<{ items: LearningSuggestion[] }>(
        `/api/learning/${businessId}/suggestions`,
      );
      setSuggestions(result.items ?? []);
      setNotice(
        'Approved. The FAQ will become live only after indexing and publication complete.',
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Approval could not be completed.',
      );
    } finally {
      setPendingId(null);
    }
  }

  async function createAiDraft(gap: KnowledgeGap) {
    setPendingId(gap.id);
    setError(null);
    try {
      const draft = await request<LearningSuggestion>(
        `/api/learning/${businessId}/gaps/${gap.id}/suggestions/ai-draft`,
        { method: 'POST', body: '{}' },
      );
      const list = await request<{ items: LearningSuggestion[] }>(
        `/api/learning/${businessId}/suggestions`,
      );
      setSuggestions(list.items ?? []);
      setDraftAnswers((current) => ({
        ...current,
        [draft.id]: draft.proposed_answer,
      }));
      setDraftQuestions((current) => ({
        ...current,
        [draft.id]: draft.proposed_question,
      }));
      setNotice(
        'AI created a draft from published knowledge. Review and edit it before submitting for approval.',
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'AI could not prepare a safe draft.',
      );
    } finally {
      setPendingId(null);
    }
  }

  async function submitAiDraft(suggestion: LearningSuggestion) {
    setPendingId(suggestion.id);
    setError(null);
    try {
      const edited = await request<{ version: number }>(
        `/api/learning/${businessId}/suggestions/${suggestion.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            expectedVersion: suggestion.version,
            question:
              draftQuestions[suggestion.id] ?? suggestion.proposed_question,
            answer: draftAnswers[suggestion.id] ?? suggestion.proposed_answer,
          }),
        },
      );
      await request(
        `/api/learning/${businessId}/suggestions/${suggestion.id}/submit`,
        {
          method: 'POST',
          body: JSON.stringify({ expectedVersion: edited.version }),
        },
      );
      const list = await request<{ items: LearningSuggestion[] }>(
        `/api/learning/${businessId}/suggestions`,
      );
      setSuggestions(list.items ?? []);
      setNotice(
        'Reviewed suggestion submitted. It remains a draft for live knowledge until you approve it and indexing succeeds.',
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Draft could not be submitted.',
      );
    } finally {
      setPendingId(null);
    }
  }

  async function reload(nextFilter: Filter) {
    setFilter(nextFilter);
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const query = nextFilter === 'ALL' ? '' : `?status=${nextFilter}`;
      const result = await request<{ items: KnowledgeGap[] }>(
        `/api/learning/${businessId}/gaps${query}`,
      );
      setGaps(result.items);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Learning insights could not be loaded. Try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(
    gap: KnowledgeGap,
    status: KnowledgeGap['status'],
  ) {
    setPendingId(gap.id);
    setError(null);
    setNotice(null);
    try {
      await request(`/api/learning/${businessId}/gaps/${gap.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setGaps((current) =>
        current.map((item) =>
          item.id === gap.id ? { ...item, status } : item,
        ),
      );
      setNotice(
        status === 'REVIEWED'
          ? 'Marked as reviewed. Add or update the answer in your Knowledge Base when ready.'
          : status === 'DISMISSED'
            ? 'This topic is dismissed. New occurrences will reopen it.'
            : 'This topic is open for review.',
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'The review status could not be saved. Try again.',
      );
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="gaps-heading">
      <div className={styles.toolbar}>
        <div>
          <h2 id="gaps-heading">Recurring customer questions</h2>
          <p>
            Topics are grouped from redacted WhatsApp questions and confirmed AI
            outcomes.
          </p>
        </div>
        <label className={styles.filter}>
          <span>Show</span>
          <select
            aria-label="Filter learning gaps"
            value={filter}
            onChange={(event) => void reload(event.target.value as Filter)}
            disabled={loading}
          >
            <option value="ALL">All topics</option>
            <option value="OPEN">Open</option>
            <option value="REVIEWED">Reviewed</option>
            <option value="DISMISSED">Dismissed</option>
          </select>
        </label>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      <section aria-label="Learning suggestions">
        <h2>Knowledge improvement suggestions</h2>
        {suggestions.length === 0 ? (
          <p>No suggestions yet. Create one from a reviewed question.</p>
        ) : (
          suggestions.map((suggestion) => (
            <article className={styles.gap} key={suggestion.id}>
              <span className={styles.status}>
                {suggestion.status.replaceAll('_', ' ').toLowerCase()}
              </span>
              <h3>{suggestion.proposed_question}</h3>
              <p>{suggestion.proposed_answer}</p>
              {suggestion.status === 'PENDING_REVIEW' && (
                <button
                  type="button"
                  disabled={pendingId === suggestion.id}
                  onClick={() => void approveSuggestion(suggestion)}
                >
                  {pendingId === suggestion.id
                    ? 'Approving…'
                    : 'Approve and index'}
                </button>
              )}
              {suggestion.status === 'INDEXING' && (
                <p role="status">
                  Approved; indexing in progress. This answer is not live yet.
                </p>
              )}
              {suggestion.status === 'PUBLISHED' && (
                <>
                  <p role="status">Published and available to the assistant.</p>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() =>
                      void request<{ items: Array<{ status: string }> }>(
                        `/api/learning/${businessId}/suggestions/${suggestion.id}/evaluations`,
                      )
                        .then((result) =>
                          setEvaluationStatus(
                            result.items[0]?.status ?? 'PENDING',
                          ),
                        )
                        .catch((failure) =>
                          setError(
                            failure instanceof Error
                              ? failure.message
                              : 'Evaluation could not be loaded.',
                          ),
                        )
                    }
                  >
                    View retrieval evaluation
                  </button>
                </>
              )}
              {evaluationStatus && (
                <p role="status">
                  Retrieval replay status: {evaluationStatus}. This replay does
                  not generate an answer or validate grounding/citations.
                </p>
              )}
              {suggestion.status === 'INDEXING_FAILED' && (
                <p role="alert">
                  Indexing failed. Existing published knowledge remains active.
                </p>
              )}
              {suggestion.status === 'DRAFT' &&
                suggestion.origin === 'AI_ASSISTED' && (
                  <div className={styles.suggestionDraft}>
                    <label>
                      Review question
                      <input
                        value={
                          draftQuestions[suggestion.id] ??
                          suggestion.proposed_question
                        }
                        onChange={(event) =>
                          setDraftQuestions((current) => ({
                            ...current,
                            [suggestion.id]: event.target.value,
                          }))
                        }
                        maxLength={500}
                      />
                    </label>
                    <label>
                      Review answer
                      <textarea
                        value={
                          draftAnswers[suggestion.id] ??
                          suggestion.proposed_answer
                        }
                        onChange={(event) =>
                          setDraftAnswers((current) => ({
                            ...current,
                            [suggestion.id]: event.target.value,
                          }))
                        }
                        maxLength={5000}
                        rows={4}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={pendingId === suggestion.id}
                      onClick={() => void submitAiDraft(suggestion)}
                    >
                      {pendingId === suggestion.id
                        ? 'Submitting…'
                        : 'Submit reviewed draft'}
                    </button>
                  </div>
                )}
            </article>
          ))
        )}
      </section>

      {loading ? (
        <p className={styles.empty} role="status">
          Loading learning gaps…
        </p>
      ) : visible.length === 0 ? (
        <div className={styles.empty} role="status">
          <strong>
            {filter === 'ALL'
              ? 'No knowledge gaps yet'
              : `No ${filter.toLowerCase()} topics`}
          </strong>
          <p>
            When the assistant has a verified information gap, its redacted
            topic will appear here.
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {visible.map((gap) => (
            <article className={styles.gap} key={gap.id}>
              <div className={styles.gapHeader}>
                <div>
                  <span className={styles.category}>
                    {categoryLabels[gap.category]}
                  </span>
                  <h3>{gap.topic_label}</h3>
                </div>
                <span
                  className={`${styles.status} ${styles[gap.status.toLowerCase()]}`}
                >
                  {gap.status.toLowerCase()}
                </span>
              </div>
              <p className={styles.count}>
                {gap.occurrence_count}{' '}
                {gap.occurrence_count === 1 ? 'occurrence' : 'occurrences'}
                {' · '}Last seen {dateLabel(gap.last_seen_at)}
              </p>
              {gap.sample_question ? (
                <blockquote>{gap.sample_question}</blockquote>
              ) : (
                <p className={styles.redacted}>
                  Question text was omitted to protect customer information.
                </p>
              )}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => {
                    setEditingGap(gap);
                    setDraftQuestion(gap.sample_question ?? gap.topic_label);
                    setDraftAnswer('');
                  }}
                >
                  Add answer suggestion
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={pendingId === gap.id}
                  onClick={() => void createAiDraft(gap)}
                >
                  {pendingId === gap.id
                    ? 'Drafting…'
                    : 'Draft with published knowledge'}
                </button>
                <Link
                  className={styles.knowledgeLink}
                  href={`/dashboard/knowledge?businessId=${businessId}`}
                >
                  Review Knowledge Base
                </Link>
                {gap.status !== 'REVIEWED' && (
                  <button
                    type="button"
                    onClick={() => void updateStatus(gap, 'REVIEWED')}
                    disabled={pendingId === gap.id}
                  >
                    {pendingId === gap.id ? 'Saving…' : 'Mark reviewed'}
                  </button>
                )}
                {gap.status !== 'DISMISSED' && (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => void updateStatus(gap, 'DISMISSED')}
                    disabled={pendingId === gap.id}
                  >
                    Dismiss
                  </button>
                )}
                {gap.status === 'DISMISSED' && (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => void updateStatus(gap, 'OPEN')}
                    disabled={pendingId === gap.id}
                  >
                    Reopen
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {editingGap && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="suggestion-title"
          className={styles.suggestionDialog}
        >
          <h2 id="suggestion-title">Suggest a business answer</h2>
          <p>
            Use confirmed business information only. This stays a draft until
            you approve it.
          </p>
          <label>
            Customer question
            <input
              value={draftQuestion}
              maxLength={500}
              onChange={(event) => setDraftQuestion(event.target.value)}
            />
          </label>
          <label>
            Approved answer
            <textarea
              value={draftAnswer}
              maxLength={5000}
              rows={5}
              onChange={(event) => setDraftAnswer(event.target.value)}
            />
          </label>
          <div className={styles.actions}>
            <button
              type="button"
              disabled={
                pendingId === editingGap.id ||
                !draftQuestion.trim() ||
                !draftAnswer.trim()
              }
              onClick={() => void createSuggestion()}
            >
              {pendingId === editingGap.id ? 'Saving…' : 'Submit for approval'}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setEditingGap(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <p className={styles.privacy}>
        Customer question text is redacted before storage and removed after 90
        days. Kleva does not use these topics to train or automatically publish
        knowledge.
      </p>
    </section>
  );
}
