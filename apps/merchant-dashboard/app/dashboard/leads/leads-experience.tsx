'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CursorPage, MerchantLead } from '@/lib/api';
import type { LeadQualification, SalesPolicy } from '@/lib/api';
import styles from '../knowledge/knowledge.module.css';
type Props = {
  businessId: string;
  initialPage: CursorPage<MerchantLead>;
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
  initialPage,
  initialError,
}: Props) {
  const [leads, setLeads] = useState(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialPage.items[0]?.id ?? null,
  );
  const [filter, setFilter] = useState('ALL');
  const [status, setStatus] = useState<MerchantLead['status']>(
    initialPage.items[0]?.status ?? 'NEW',
  );
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [policy, setPolicy] = useState<SalesPolicy | null>(null);
  const [qualification, setQualification] = useState<LeadQualification | null>(
    null,
  );
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [consentChecked, setConsentChecked] = useState<Record<string, boolean>>(
    {},
  );
  const [conversion, setConversion] = useState<'WON' | 'LOST' | null>(null);
  const [conversionValue, setConversionValue] = useState('');
  const [conversionCurrency, setConversionCurrency] = useState('NGN');
  const [conversionReference, setConversionReference] = useState('');
  const [lossReason, setLossReason] = useState('');
  const router = useRouter();
  const selected = leads.find((l) => l.id === selectedId) ?? null;
  useEffect(() => {
    const fn = () => router.push('/login?error=session');
    window.addEventListener('kleva-session-expired', fn);
    return () => window.removeEventListener('kleva-session-expired', fn);
  }, [router]);
  useEffect(() => {
    void fetch(`/api/leads/${businessId}/sales-policy`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Qualification settings could not be loaded.');
        const body = await response.json();
        setPolicy(body.policy);
      })
      .catch((e: unknown) =>
        setError(
          e instanceof Error
            ? e.message
            : 'Qualification settings could not be loaded.',
        ),
      );
  }, [businessId]);
  useEffect(() => {
    const active = selected;
    if (!active) return;
    let cancelled = false;
    void fetch(`/api/leads/${businessId}/leads/${active.id}/qualification`, {
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Qualification details could not be loaded.');
        return (await response.json()) as LeadQualification;
      })
      .then((body) => {
        if (cancelled) return;
        setQualification(body);
        if (body.record) {
          setFieldValues(body.record.field_values ?? {});
          const checks: Record<string, boolean> = {};
          for (const [id, evidence] of Object.entries(
            body.record.consent_evidence ?? {},
          ))
            checks[id] =
              !!evidence &&
              typeof evidence === 'object' &&
              (evidence as { consented?: boolean }).consented === true;
          setConsentChecked(checks);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(
            e instanceof Error
              ? e.message
              : 'Qualification details could not be loaded.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, selected]);
  const visible = useMemo(
    () => leads.filter((l) => filter === 'ALL' || l.status === filter),
    [leads, filter],
  );
  async function fetchPage(
    nextFilter: string,
    cursor?: string,
    append = false,
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const query = new URLSearchParams({ limit: '50' });
      if (nextFilter !== 'ALL') query.set('status', nextFilter);
      if (cursor) query.set('cursor', cursor);
      const response = await fetch(
        `/api/leads/${businessId}/leads?${query.toString()}`,
        { cache: 'no-store' },
      );
      if (response.status === 401) {
        window.dispatchEvent(new Event('kleva-session-expired'));
        throw new Error('Your session expired. Sign in again.');
      }
      if (!response.ok)
        throw new Error('Leads could not be loaded. Try again.');
      const page = (await response.json()) as CursorPage<MerchantLead>;
      setLeads((current) =>
        append ? [...current, ...page.items] : page.items,
      );
      setNextCursor(page.nextCursor);
      if (!append) {
        setQualification(null);
        setFieldValues({});
        setConsentChecked({});
        setSelectedId(page.items[0]?.id ?? null);
        setStatus(page.items[0]?.status ?? 'NEW');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Leads could not be loaded.');
    } finally {
      setBusy(false);
    }
  }
  function select(l: MerchantLead) {
    setQualification(null);
    setFieldValues({});
    setConsentChecked({});
    setSelectedId(l.id);
    setStatus(l.status);
    setError(null);
  }
  async function csrfFetch(
    path: string,
    method: 'PATCH' | 'POST',
    body: unknown,
    idempotencyKey?: string,
  ) {
    const csrf = document.cookie
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('kleva_csrf='));
    const response = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(csrf
          ? {
              'X-CSRF-Token': decodeURIComponent(
                csrf.slice(csrf.indexOf('=') + 1),
              ),
            }
          : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(
        payload?.error?.message ??
          'Kleva could not save this change. Refresh and try again.',
      );
    }
    return response.json();
  }
  async function saveQualification(markQualified: boolean) {
    if (!selected || !policy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const evidence = Object.fromEntries(
      policy.fields
        .filter((f) => f.consentRequired && consentChecked[f.id])
        .map((f) => [
          f.id,
          {
            consented: true,
            recordedAt: new Date().toISOString(),
            source: 'MERCHANT_RECORDED',
          },
        ]),
    );
    try {
      const result = await csrfFetch(
        `/api/leads/${businessId}/leads/${selected.id}/qualification`,
        'PATCH',
        {
          expectedLeadVersion: selected.version,
          policyVersion: policy.version,
          fieldValues,
          consentEvidence: evidence,
          markQualified,
        },
      );
      setLeads((current) =>
        current.map((l) =>
          l.id === selected.id
            ? {
                ...l,
                status: result.lead_status as MerchantLead['status'],
                version: Number(result.lead_version),
                updated_at: String(result.created_at),
              }
            : l,
        ),
      );
      setStatus(result.lead_status as MerchantLead['status']);
      setNotice(
        markQualified
          ? 'Lead qualified. Qualification history was saved.'
          : 'Qualification details saved.',
      );
      setQualification(
        await (
          await fetch(
            `/api/leads/${businessId}/leads/${selected.id}/qualification`,
            { cache: 'no-store' },
          )
        ).json(),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Qualification could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function submitConversion() {
    if (!selected || !conversion) return;
    setBusy(true);
    setError(null);
    try {
      const details =
        conversion === 'WON'
          ? {
              reference: conversionReference || undefined,
              value: conversionValue ? Number(conversionValue) : undefined,
              currency: conversionValue ? conversionCurrency : undefined,
            }
          : { lossReason: lossReason || undefined };
      const idempotencyKey = crypto.randomUUID();
      const result = await csrfFetch(
        `/api/leads/${businessId}/leads/${selected.id}/convert`,
        'POST',
        { expectedLeadVersion: selected.version, outcome: conversion, details },
        idempotencyKey,
      );
      setLeads((current) =>
        current.map((l) =>
          l.id === selected.id
            ? {
                ...l,
                status: conversion,
                version: Number(result.lead_version),
                updated_at: String(result.created_at),
              }
            : l,
        ),
      );
      setStatus(conversion);
      setNotice(
        `Lead recorded as ${conversion}. This records the merchant's outcome; it does not confirm payment.`,
      );
      setConversion(null);
      setQualification(
        await (
          await fetch(
            `/api/leads/${businessId}/leads/${selected.id}/qualification`,
            { cache: 'no-store' },
          )
        ).json(),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Conversion could not be recorded.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
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
      if (result.changed) setNotice('Lead status updated.');
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
            <a
              href={`/dashboard/leads/settings?businessId=${encodeURIComponent(businessId)}`}
            >
              Qualification settings
            </a>
          </div>
          <select
            aria-label="Filter leads"
            value={filter}
            onChange={(e) => {
              const value = e.target.value;
              setFilter(value);
              void fetchPage(value);
            }}
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
        {nextCursor && (
          <button
            type="button"
            onClick={() => void fetchPage(filter, nextCursor, true)}
            disabled={busy}
          >
            {busy ? 'Loading…' : 'Load more leads'}
          </button>
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
              <h3>Qualification details</h3>
              {policy?.fields.length ? (
                policy.fields.map((field) => (
                  <div key={field.id}>
                    <label htmlFor={`qualification-${field.id}`}>
                      {field.label}
                      {field.required ? ' *' : ''}
                    </label>
                    {field.type === 'SINGLE_SELECT' ? (
                      <select
                        id={`qualification-${field.id}`}
                        value={String(fieldValues[field.id] ?? '')}
                        onChange={(e) =>
                          setFieldValues((v) => ({
                            ...v,
                            [field.id]: e.target.value || null,
                          }))
                        }
                      >
                        <option value="">Select…</option>
                        {((field.validation.options as string[]) ?? []).map(
                          (option) => (
                            <option key={option}>{option}</option>
                          ),
                        )}
                      </select>
                    ) : field.type === 'BOOLEAN' ? (
                      <input
                        id={`qualification-${field.id}`}
                        type="checkbox"
                        checked={fieldValues[field.id] === true}
                        onChange={(e) =>
                          setFieldValues((v) => ({
                            ...v,
                            [field.id]: e.target.checked,
                          }))
                        }
                      />
                    ) : field.type === 'MULTI_SELECT' ? (
                      <select
                        id={`qualification-${field.id}`}
                        multiple
                        value={
                          Array.isArray(fieldValues[field.id])
                            ? (fieldValues[field.id] as string[])
                            : []
                        }
                        onChange={(e) =>
                          setFieldValues((v) => ({
                            ...v,
                            [field.id]: Array.from(
                              e.target.selectedOptions,
                              (o) => o.value,
                            ),
                          }))
                        }
                      >
                        {((field.validation.options as string[]) ?? []).map(
                          (option) => (
                            <option key={option}>{option}</option>
                          ),
                        )}
                      </select>
                    ) : (
                      <input
                        id={`qualification-${field.id}`}
                        type={
                          field.type === 'NUMBER'
                            ? 'number'
                            : field.type === 'DATE'
                              ? 'date'
                              : 'text'
                        }
                        value={
                          fieldValues[field.id] == null
                            ? ''
                            : String(fieldValues[field.id])
                        }
                        min={
                          field.type === 'NUMBER'
                            ? String(field.validation.min ?? '')
                            : undefined
                        }
                        max={
                          field.type === 'NUMBER'
                            ? String(field.validation.max ?? '')
                            : undefined
                        }
                        onChange={(e) =>
                          setFieldValues((v) => ({
                            ...v,
                            [field.id]:
                              field.type === 'NUMBER'
                                ? e.target.value === ''
                                  ? null
                                  : Number(e.target.value)
                                : e.target.value || null,
                          }))
                        }
                      />
                    )}
                    {field.purpose && <p className="muted">{field.purpose}</p>}
                    {field.consentRequired && (
                      <label>
                        <input
                          type="checkbox"
                          checked={consentChecked[field.id] ?? false}
                          onChange={(e) =>
                            setConsentChecked((c) => ({
                              ...c,
                              [field.id]: e.target.checked,
                            }))
                          }
                        />{' '}
                        I verified the customer agreed to provide this
                        information.
                      </label>
                    )}
                  </div>
                ))
              ) : (
                <p className="muted">
                  No qualification fields are configured. An owner or editor can
                  add them in Qualification settings.
                </p>
              )}
              <button
                type="button"
                disabled={busy || !policy?.version}
                onClick={() => void saveQualification(false)}
              >
                {busy ? 'Saving…' : 'Save qualification'}
              </button>
              <button
                type="button"
                disabled={
                  busy ||
                  !policy?.version ||
                  selected.status === 'WON' ||
                  selected.status === 'LOST'
                }
                onClick={() => void saveQualification(true)}
              >
                Mark as qualified
              </button>
              <h3>Record outcome</h3>
              <button
                type="button"
                disabled={
                  busy ||
                  selected.status === 'WON' ||
                  selected.status === 'LOST' ||
                  selected.status !== 'QUALIFIED'
                }
                onClick={() => setConversion('WON')}
              >
                Mark as Won
              </button>
              <button
                type="button"
                disabled={
                  busy ||
                  selected.status === 'WON' ||
                  selected.status === 'LOST'
                }
                onClick={() => setConversion('LOST')}
              >
                Mark as Lost
              </button>
              {qualification?.history.map((item, index) => (
                <p key={String(item.id ?? index)}>
                  Qualification revision {String(item.revision)} · policy v
                  {String(item.policy_version)} ·{' '}
                  {String(item.qualification_status)}
                </p>
              ))}
              {qualification?.conversions.map((item) => (
                <p key={item.id}>
                  Outcome {item.outcome} ·{' '}
                  {item.conversion_date ?? date(item.created_at)}
                  {item.loss_reason ? ` · ${item.loss_reason}` : ''}
                  {item.conversion_value
                    ? ` · ${item.currency} ${item.conversion_value}`
                    : ''}
                </p>
              ))}
              {conversion && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="conversion-title"
                >
                  <h3 id="conversion-title">
                    Confirm {conversion.toLowerCase()} outcome
                  </h3>
                  <p>
                    This is a manual sales outcome record. It does not create an
                    order, confirm payment, or reserve an appointment.
                  </p>
                  {conversion === 'WON' ? (
                    <>
                      <label>
                        Reference (optional)
                        <input
                          value={conversionReference}
                          maxLength={120}
                          onChange={(e) =>
                            setConversionReference(e.target.value)
                          }
                        />
                      </label>
                      <label>
                        Conversion value (optional)
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={conversionValue}
                          onChange={(e) => setConversionValue(e.target.value)}
                        />
                      </label>
                      <label>
                        Currency
                        <select
                          value={conversionCurrency}
                          onChange={(e) =>
                            setConversionCurrency(e.target.value)
                          }
                        >
                          <option>NGN</option>
                          <option>USD</option>
                          <option>EUR</option>
                          <option>GBP</option>
                        </select>
                      </label>
                    </>
                  ) : (
                    <label>
                      Loss reason (optional)
                      <textarea
                        value={lossReason}
                        maxLength={500}
                        onChange={(e) => setLossReason(e.target.value)}
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => void submitConversion()}
                    disabled={busy}
                  >
                    {busy ? 'Recording…' : 'Confirm outcome'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConversion(null)}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                </div>
              )}
              <label htmlFor="lead-status">Status</label>
              <select
                id="lead-status"
                aria-label="Lead status"
                disabled={
                  selected.status === 'QUALIFIED' ||
                  selected.status === 'WON' ||
                  selected.status === 'LOST'
                }
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as MerchantLead['status'])
                }
              >
                {(['NEW', 'CONTACTED'] as MerchantLead['status'][]).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              {selected.status !== 'NEW' && selected.status !== 'CONTACTED' && (
                <p className="muted">
                  Qualification and conversion actions control the remaining
                  lifecycle states.
                </p>
              )}
              <button
                type="button"
                onClick={save}
                disabled={busy || status === selected.status}
              >
                {busy ? 'Saving…' : 'Save status'}
              </button>
              {notice && <p className={styles.success}>{notice}</p>}
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
