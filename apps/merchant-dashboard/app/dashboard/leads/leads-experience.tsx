'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MerchantLead } from '@/lib/api';
import styles from '../knowledge/knowledge.module.css';
type Props = {
  businessId: string;
  initialLeads: MerchantLead[];
  initialError: string | null;
};
const statuses: MerchantLead['status'][] = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'WON',
  'LOST',
];
function date(value: string) {
  const d = new Date(value);
  return Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(d)
    : 'Recently';
}
export function LeadsExperience({
  businessId,
  initialLeads,
  initialError,
}: Props) {
  const [leads, setLeads] = useState(initialLeads);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialLeads[0]?.id ?? null,
  );
  const [filter, setFilter] = useState('ALL');
  const [status, setStatus] = useState<MerchantLead['status']>(
    initialLeads[0]?.status ?? 'NEW',
  );
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const selected = leads.find((l) => l.id === selectedId) ?? null;
  useEffect(() => {
    const fn = () => router.push('/login?error=session');
    window.addEventListener('kleva-session-expired', fn);
    return () => window.removeEventListener('kleva-session-expired', fn);
  }, [router]);
  const visible = useMemo(
    () => leads.filter((l) => filter === 'ALL' || l.status === filter),
    [leads, filter],
  );
  function select(l: MerchantLead) {
    setSelectedId(l.id);
    setStatus(l.status);
    setError(null);
  }
  async function save() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const csrf = document.cookie
        .split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith('kleva_csrf='));
      const response = await fetch(
        `/api/leads/${businessId}/leads/${selected.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(csrf
              ? {
                  'X-CSRF-Token': decodeURIComponent(
                    csrf.slice(csrf.indexOf('=') + 1),
                  ),
                }
              : {}),
          },
          body: JSON.stringify({ status, expectedVersion: selected.version }),
        },
      );
      if (response.status === 401) {
        window.dispatchEvent(new Event('kleva-session-expired'));
        throw new Error('Your session expired. Sign in again.');
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.error?.message ??
            'Lead could not be updated. Refresh and try again.',
        );
      }
      const result = await response.json();
      setLeads((old) =>
        old.map((l) =>
          l.id === selected.id
            ? {
                ...selected,
                status: result.status,
                version: result.version,
                updated_at: result.updatedAt,
              }
            : l,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lead could not be updated.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.workspace}>
      <section
        className={`${styles.listPanel} ${selected ? styles.mobileHidden : ''}`}
      >
        <div className={styles.listHeading}>
          <div>
            <h2>Leads</h2>
            <p>{leads.length} recorded</p>
          </div>
          <select
            aria-label="Filter leads"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="ALL">All statuses</option>
            {statuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {initialError && !leads.length ? (
          <p>{initialError}</p>
        ) : visible.length === 0 ? (
          <p className="muted">
            {filter === 'ALL'
              ? 'No leads yet. New customer WhatsApp conversations will appear here.'
              : 'No leads match this status.'}
          </p>
        ) : (
          <div className={styles.faqList}>
            {visible.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => select(l)}
                className={`${styles.faqItem} ${selectedId === l.id ? styles.selected : ''}`}
                aria-current={selectedId === l.id ? 'true' : undefined}
              >
                <span className={styles.itemHeading}>
                  <strong>{l.customer_name}</strong>
                  <span className={styles.badge}>{l.status}</span>
                </span>
                <span className={styles.itemAnswer}>
                  {l.customer_whatsapp_id} · {date(l.last_activity_at)}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
      <section
        className={`${styles.editorPanel} ${selected ? styles.mobileEditorOpen : styles.mobileHidden}`}
      >
        {selected ? (
          <>
            <button
              type="button"
              className={styles.backButton}
              onClick={() => setSelectedId(null)}
            >
              ← All leads
            </button>
            <div className={styles.editorHeading}>
              <div>
                <p className="eyebrow">WHATSAPP LEAD</p>
                <h2>{selected.customer_name}</h2>
                <p>{selected.customer_whatsapp_id}</p>
              </div>
            </div>
            <dl>
              <dt>Source</dt>
              <dd>{selected.source}</dd>
              <dt>First contact</dt>
              <dd>{date(selected.first_contact_at)}</dd>
              <dt>Last activity</dt>
              <dd>{date(selected.last_activity_at)}</dd>
            </dl>
            <div className={styles.editorForm}>
              <label htmlFor="lead-status">Status</label>
              <select
                id="lead-status"
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as MerchantLead['status'])
                }
              >
                {statuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={save}
                disabled={busy || status === selected.status}
              >
                {busy ? 'Saving…' : 'Save status'}
              </button>
              {error && (
                <p role="alert" className={styles.error}>
                  {error}
                </p>
              )}
              <p>
                <a
                  href={`/dashboard/conversations?businessId=${encodeURIComponent(businessId)}&conversationId=${encodeURIComponent(selected.conversation_id)}`}
                >
                  Open conversation history
                </a>
              </p>
            </div>
          </>
        ) : (
          <div>
            <h2>Select a lead</h2>
            <p className="muted">
              Lead details and conversation history will appear here.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
