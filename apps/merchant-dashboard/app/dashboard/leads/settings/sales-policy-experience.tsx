'use client';
import { useState } from 'react';
import type { SalesPolicy, SalesQualificationField } from '@/lib/api';
import styles from '../../knowledge/knowledge.module.css';

type Props = {
  businessId: string;
  initial: {
    policy: SalesPolicy;
    history: Array<Record<string, unknown>>;
    templates: {
      retail: SalesQualificationField[];
      service: SalesQualificationField[];
    };
  } | null;
  initialError: string | null;
};
function csrf() {
  const token = document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith('kleva_csrf='));
  return token ? decodeURIComponent(token.slice(token.indexOf('=') + 1)) : '';
}

export function SalesPolicyExperience({
  businessId,
  initial,
  initialError,
}: Props) {
  const [fields, setFields] = useState<SalesQualificationField[]>(
    initial?.policy.fields ?? [],
  );
  const [version, setVersion] = useState(initial?.policy.version ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  function update(index: number, patch: Partial<SalesQualificationField>) {
    setFields((current) =>
      current.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    );
  }
  function applyTemplate(kind: 'retail' | 'service') {
    if (!initial) return;
    setFields(
      initial.templates[kind].map((field) => ({
        ...field,
        validation: { ...field.validation },
      })),
    );
    setError(null);
    setNotice(
      `${kind === 'retail' ? 'Retail' : 'Service'} template loaded. Save to publish it for this business.`,
    );
  }
  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const response = await fetch(`/api/leads/${businessId}/sales-policy`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
      body: JSON.stringify({ expectedVersion: version, fields }),
    }).catch(() => null);
    if (!response) {
      setError(
        'Qualification settings could not be saved. Check your connection and try again.',
      );
      setBusy(false);
      return;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(
        payload?.error?.message ??
          'Qualification settings could not be saved. Refresh and try again.',
      );
      setBusy(false);
      return;
    }
    setVersion(payload.version);
    setNotice(
      `Policy version ${payload.version} saved. Existing lead records keep their original policy version.`,
    );
    setBusy(false);
  }
  const addField = () =>
    setFields((current) => [
      ...current,
      {
        id: `field_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
        label: '',
        type: 'TEXT',
        required: false,
        validation: { maxLength: 240 },
        order: (current.length + 1) * 10,
        purpose: '',
        consentRequired: false,
      },
    ]);
  return (
    <div className={styles.policyPanel}>
      <div className={styles.editorHeading}>
        <div>
          <h2>Qualification policy · v{version}</h2>
          <p>
            Policy changes create a new version. Existing qualification records
            remain unchanged.
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.editorForm}>
        <div>
          <button
            type="button"
            onClick={() => applyTemplate('retail')}
            disabled={!initial}
          >
            Use retail template
          </button>{' '}
          <button
            type="button"
            onClick={() => applyTemplate('service')}
            disabled={!initial}
          >
            Use service template
          </button>{' '}
          <button type="button" onClick={addField}>
            Add field
          </button>
        </div>
        <p className="muted">
          Templates use non-sensitive sales details. Optional consent evidence
          is an explicit merchant record; a WhatsApp message alone is not
          treated as consent.
        </p>
        {!fields.length && (
          <p>
            No qualification fields yet. Start with a template or add a field.
          </p>
        )}
        {fields.map((field, index) => (
          <fieldset
            key={field.id}
            style={{
              border: '1px solid var(--border, #ddd)',
              borderRadius: 12,
              padding: 16,
              marginBlock: 12,
            }}
          >
            <legend>{field.id}</legend>
            <label>
              Display label
              <input
                value={field.label}
                maxLength={80}
                onChange={(e) => update(index, { label: e.target.value })}
              />
            </label>
            <label>
              Field type
              <select
                value={field.type}
                onChange={(e) => {
                  const type = e.target
                    .value as SalesQualificationField['type'];
                  update(index, {
                    type,
                    validation:
                      type === 'SINGLE_SELECT' || type === 'MULTI_SELECT'
                        ? { options: ['Option 1', 'Option 2'] }
                        : type === 'NUMBER'
                          ? {}
                          : type === 'TEXT'
                            ? { maxLength: 240 }
                            : {},
                  });
                }}
              >
                <option value="TEXT">Text</option>
                <option value="NUMBER">Number</option>
                <option value="SINGLE_SELECT">Single select</option>
                <option value="MULTI_SELECT">Multi-select</option>
                <option value="BOOLEAN">Yes / no</option>
                <option value="DATE">Date</option>
              </select>
            </label>
            {(field.type === 'SINGLE_SELECT' ||
              field.type === 'MULTI_SELECT') && (
              <label>
                Options (one per line)
                <textarea
                  value={(field.validation.options as string[]).join('\n')}
                  onChange={(e) =>
                    update(index, {
                      validation: {
                        options: e.target.value
                          .split('\n')
                          .map((v) => v.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                />
              </label>
            )}
            {field.type === 'TEXT' && (
              <div>
                <label>
                  Minimum characters
                  <input
                    type="number"
                    min="0"
                    max="500"
                    value={String(field.validation.minLength ?? '')}
                    onChange={(e) =>
                      update(index, {
                        validation: {
                          ...field.validation,
                          minLength: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Maximum characters
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={String(field.validation.maxLength ?? '')}
                    onChange={(e) =>
                      update(index, {
                        validation: {
                          ...field.validation,
                          maxLength: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        },
                      })
                    }
                  />
                </label>
              </div>
            )}
            {field.type === 'NUMBER' && (
              <div>
                <label>
                  Minimum value
                  <input
                    type="number"
                    value={String(field.validation.min ?? '')}
                    onChange={(e) =>
                      update(index, {
                        validation: {
                          ...field.validation,
                          min: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Maximum value
                  <input
                    type="number"
                    value={String(field.validation.max ?? '')}
                    onChange={(e) =>
                      update(index, {
                        validation: {
                          ...field.validation,
                          max: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        },
                      })
                    }
                  />
                </label>
              </div>
            )}
            <label>
              Purpose
              <textarea
                value={field.purpose}
                maxLength={240}
                onChange={(e) => update(index, { purpose: e.target.value })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={field.required}
                onChange={(e) => update(index, { required: e.target.checked })}
              />{' '}
              Required to qualify
            </label>
            <label>
              <input
                type="checkbox"
                checked={field.consentRequired}
                onChange={(e) =>
                  update(index, { consentRequired: e.target.checked })
                }
              />{' '}
              Requires explicit customer consent evidence
            </label>
            <label>
              Display order
              <input
                type="number"
                min="0"
                max="1000"
                value={field.order}
                onChange={(e) =>
                  update(index, { order: Number(e.target.value) })
                }
              />
            </label>
            <button
              type="button"
              onClick={() =>
                setFields((current) => current.filter((_, i) => i !== index))
              }
            >
              Remove field
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !initial}
        >
          {busy ? 'Saving…' : 'Save qualification policy'}
        </button>
        {notice && (
          <p role="status" className={styles.success}>
            {notice}
          </p>
        )}
        {initial?.history.length ? (
          <section>
            <h3>Policy history</h3>
            <ul>
              {initial.history.map((item, index) => (
                <li key={String(item.version ?? index)}>
                  Version {String(item.version)} · {String(item.created_at)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <p>
          <a
            href={`/dashboard/leads?businessId=${encodeURIComponent(businessId)}`}
          >
            Back to leads
          </a>
        </p>
      </div>
    </div>
  );
}
