'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { KnowledgeGap } from '@/lib/api';
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
      <p className={styles.privacy}>
        Customer question text is redacted before storage and removed after 90
        days. Kleva does not use these topics to train or automatically publish
        knowledge.
      </p>
    </section>
  );
}
