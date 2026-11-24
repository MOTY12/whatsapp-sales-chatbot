'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import type { WebsiteWidget } from '@/lib/api';
import styles from './website-chat.module.css';

type Props = {
  businessId: string;
  businessTimezone: string | null;
  initialWidgets: WebsiteWidget[];
  loadError: string | null;
};
function csrfToken() {
  const value = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => /^(?:__Host-)?kleva_csrf=/i.test(part));
  return value ? decodeURIComponent(value.slice(value.indexOf('=') + 1)) : '';
}
async function apiCall<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (method !== 'GET') {
    headers.set('Content-Type', 'application/json');
    headers.set('X-CSRF-Token', csrfToken());
  }
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  if (response.status === 401) {
    window.dispatchEvent(new Event('kleva-session-expired'));
    throw new Error('Your session expired. Sign in again.');
  }
  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  if (!response.ok)
    throw new Error(
      payload?.error?.message ?? 'Website chat could not be updated.',
    );
  return payload as T;
}

export function WebsiteChatExperience({
  businessId,
  businessTimezone,
  initialWidgets,
  loadError,
}: Props) {
  const router = useRouter();
  const [widgets, setWidgets] = useState(initialWidgets);
  const [widget, setWidget] = useState(initialWidgets[0] ?? null);
  const [name, setName] = useState(initialWidgets[0]?.name ?? '');
  const [origins, setOrigins] = useState(
    initialWidgets[0]?.domains.join('\n') ?? '',
  );
  const [assistantName, setAssistantName] = useState(
    initialWidgets[0]?.configuration.assistantName ?? 'Kleva Assistant',
  );
  const [welcome, setWelcome] = useState(
    initialWidgets[0]?.configuration.welcomeMessage ??
      'Hi! How can we help you today?',
  );
  const [color, setColor] = useState(
    initialWidgets[0]?.configuration.primaryColor ?? '#2563eb',
  );
  const [enabled, setEnabled] = useState(initialWidgets[0]?.enabled ?? false);
  const [aiEnabled, setAiEnabled] = useState(
    initialWidgets[0]?.aiEnabled ?? false,
  );
  const [collectContact, setCollectContact] = useState(
    initialWidgets[0]?.configuration.collectContact ?? false,
  );
  const [requireContact, setRequireContact] = useState(
    initialWidgets[0]?.configuration.requireContact ?? false,
  );
  const [position, setPosition] = useState(
    initialWidgets[0]?.configuration.position ?? 'bottom-right',
  );
  const [theme, setTheme] = useState(
    initialWidgets[0]?.configuration.theme ?? 'light',
  );
  const [logoUrl, setLogoUrl] = useState(
    initialWidgets[0]?.configuration.logoUrl ?? '',
  );
  const [privacyNotice, setPrivacyNotice] = useState(
    initialWidgets[0]?.configuration.privacyNotice ??
      'Your messages may be processed by an AI assistant.',
  );
  const [offlineMessage, setOfflineMessage] = useState(
    initialWidgets[0]?.configuration.offlineMessage ??
      'We are currently away. Leave us a message and we will follow up.',
  );
  const [suggestedQuestions, setSuggestedQuestions] = useState(
    initialWidgets[0]?.configuration.suggestedQuestions.join('\n') ?? '',
  );
  const [businessHours, setBusinessHours] = useState(
    initialWidgets[0]?.configuration.businessHours ?? {
      enabled: false,
      daysOfWeek: [1, 2, 3, 4, 5],
      opensAt: '09:00',
      closesAt: '17:00',
    },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(loadError);
  const [notice, setNotice] = useState('');
  function selectWidget(next: WebsiteWidget) {
    setWidget(next);
    setName(next.name);
    setOrigins(next.domains.join('\n'));
    setAssistantName(next.configuration.assistantName);
    setWelcome(next.configuration.welcomeMessage);
    setColor(next.configuration.primaryColor);
    setEnabled(next.enabled);
    setAiEnabled(next.aiEnabled);
    setCollectContact(next.configuration.collectContact);
    setRequireContact(next.configuration.requireContact);
    setPosition(next.configuration.position);
    setTheme(next.configuration.theme);
    setLogoUrl(next.configuration.logoUrl ?? '');
    setPrivacyNotice(next.configuration.privacyNotice);
    setOfflineMessage(next.configuration.offlineMessage);
    setSuggestedQuestions(next.configuration.suggestedQuestions.join('\n'));
    setBusinessHours(next.configuration.businessHours);
  }
  function saveWidgetLocally(next: WebsiteWidget) {
    setWidget(next);
    setWidgets((current) =>
      current.map((item) => (item.id === next.id ? next : item)),
    );
  }
  async function run<T>(
    fn: () => Promise<T>,
    done: (result: T) => void,
    message: string,
  ) {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const result = await fn();
      done(result);
      setNotice(message);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }
  if (!widget)
    return (
      <section className={styles.card}>
        <h2>Create your website widget</h2>
        <p>Register your website origin before enabling the chat launcher.</p>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <label>
          Widget name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Main website chat"
          />
        </label>
        <button
          disabled={busy || !name.trim()}
          onClick={() =>
            void run(
              async () => {
                await apiCall<{ id: string; publicId: string }>(
                  `/api/website-widget/${businessId}`,
                  'POST',
                  { name },
                );
                return apiCall<WebsiteWidget[]>(
                  `/api/website-widget/${businessId}`,
                );
              },
              (rows) => {
                setWidgets(rows);
                const next = rows[0] ?? null;
                if (next) selectWidget(next);
              },
              'Widget created.',
            )
          }
        >
          {busy ? 'Creating…' : 'Create widget'}
        </button>
      </section>
    );
  const domains = origins
    .split(/\r?\n|,/)
    .map((origin) => origin.trim())
    .filter(Boolean);
  const save = () =>
    void run(
      async () => {
        await apiCall(
          `/api/website-widget/${businessId}/${widget.id}/domains`,
          'PATCH',
          { origins: domains },
        );
        return apiCall(
          `/api/website-widget/${businessId}/${widget.id}`,
          'PATCH',
          {
            name,
            enabled,
            aiEnabled,
            configuration: {
              ...widget.configuration,
              assistantName,
              welcomeMessage: welcome,
              primaryColor: color,
              collectContact,
              requireContact,
              position,
              theme,
              logoUrl: logoUrl.trim() || null,
              privacyNotice,
              offlineMessage,
              suggestedQuestions: suggestedQuestions
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter(Boolean),
              businessHours,
            },
          },
        );
      },
      () =>
        saveWidgetLocally({
          ...widget,
          name,
          enabled,
          aiEnabled,
          domains,
          configuration: {
            ...widget.configuration,
            assistantName,
            welcomeMessage: welcome,
            primaryColor: color,
            collectContact,
            requireContact,
            position,
            theme,
            logoUrl: logoUrl.trim() || null,
            privacyNotice,
            offlineMessage,
            suggestedQuestions: suggestedQuestions
              .split(/\r?\n/)
              .map((item) => item.trim())
              .filter(Boolean),
            businessHours,
          },
        }),
      'Widget settings saved.',
    );
  return (
    <div className={styles.layout}>
      <section className={styles.card}>
        <div className={styles.header}>
          <div>
            <h2>{widget.name}</h2>
            <span className={styles.status}>
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <button
            className={styles.secondary}
            disabled={busy}
            onClick={() =>
              void run(
                async () => {
                  const rows = await apiCall<WebsiteWidget[]>(
                    `/api/website-widget/${businessId}`,
                  );
                  setWidgets(rows);
                  return rows.find(({ id }) => id === widget.id) ?? widget;
                },
                selectWidget,
                'Status refreshed.',
              )
            }
          >
            Refresh
          </button>
        </div>
        {widgets.length > 1 && (
          <label>
            Select a widget
            <select
              value={widget.id}
              onChange={(event) => {
                const next = widgets.find(
                  ({ id }) => id === event.target.value,
                );
                if (next) selectWidget(next);
              }}
            >
              {widgets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className={styles.secondary}
          disabled={busy}
          onClick={() =>
            void run(
              async () => {
                const created = await apiCall<{ id: string; publicId: string }>(
                  `/api/website-widget/${businessId}`,
                  'POST',
                  { name: 'New website widget' },
                );
                const rows = await apiCall<WebsiteWidget[]>(
                  `/api/website-widget/${businessId}`,
                );
                return {
                  rows,
                  selected: rows.find(({ id }) => id === created.id),
                };
              },
              ({ rows, selected }) => {
                setWidgets(rows);
                if (selected) selectWidget(selected);
              },
              'A new widget was created.',
            )
          }
        >
          Create another widget
        </button>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className={styles.success}>
            {notice}
          </p>
        )}
        <label>
          Widget name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
        </label>
        <label>
          Authorized website origins
          <textarea
            rows={4}
            value={origins}
            onChange={(e) => setOrigins(e.target.value)}
            placeholder={'https://example.com\nhttps://www.example.com'}
            aria-describedby="origin-help"
          />
          <small id="origin-help">
            Enter origins only, one per line (scheme and host; no paths). Local
            HTTP is allowed in development.
          </small>
        </label>
        <label>
          Assistant name
          <input
            value={assistantName}
            maxLength={60}
            onChange={(e) => setAssistantName(e.target.value)}
          />
        </label>
        <label>
          Welcome message
          <textarea
            rows={3}
            value={welcome}
            maxLength={500}
            onChange={(e) => setWelcome(e.target.value)}
          />
        </label>
        <label>
          Business logo URL
          <input
            type="url"
            inputMode="url"
            value={logoUrl}
            maxLength={500}
            onChange={(event) => setLogoUrl(event.target.value)}
            placeholder="https://example.com/logo.png"
          />
          <small>
            Use a public HTTPS image URL. Script and HTML values are rejected.
          </small>
        </label>
        <label>
          Brand color
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <label>
          Launcher position
          <select
            value={position}
            onChange={(event) =>
              setPosition(event.target.value as 'bottom-left' | 'bottom-right')
            }
          >
            <option value="bottom-right">Bottom right</option>
            <option value="bottom-left">Bottom left</option>
          </select>
        </label>
        <label>
          Appearance
          <select
            value={theme}
            onChange={(event) =>
              setTheme(event.target.value as 'light' | 'dark')
            }
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label>
          Suggested opening questions (one per line, up to four)
          <textarea
            rows={4}
            value={suggestedQuestions}
            onChange={(event) => setSuggestedQuestions(event.target.value)}
          />
        </label>
        <label>
          Privacy notice
          <textarea
            rows={3}
            value={privacyNotice}
            maxLength={300}
            onChange={(event) => setPrivacyNotice(event.target.value)}
          />
        </label>
        <label>
          Offline message
          <textarea
            rows={3}
            value={offlineMessage}
            maxLength={300}
            onChange={(event) => setOfflineMessage(event.target.value)}
          />
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={businessHours.enabled}
            onChange={(event) =>
              setBusinessHours({
                ...businessHours,
                enabled: event.target.checked,
              })
            }
          />
          Show availability using business hours
        </label>
        {businessHours.enabled && (
          <>
            <fieldset className={styles.dayPicker}>
              <legend>Open days</legend>
              <div className={styles.daysGrid}>
                {[
                  'Sunday',
                  'Monday',
                  'Tuesday',
                  'Wednesday',
                  'Thursday',
                  'Friday',
                  'Saturday',
                ].map((day, index) => (
                  <label className={styles.dayOption} key={day}>
                    <input
                      type="checkbox"
                      checked={businessHours.daysOfWeek.includes(index)}
                      onChange={(event) =>
                        setBusinessHours({
                          ...businessHours,
                          daysOfWeek: event.target.checked
                            ? [...businessHours.daysOfWeek, index].sort()
                            : businessHours.daysOfWeek.filter(
                                (value) => value !== index,
                              ),
                        })
                      }
                    />
                    {day.slice(0, 3)}
                  </label>
                ))}
              </div>
              <small>
                Timezone: {businessTimezone ?? 'set in your business profile'}.
              </small>
            </fieldset>
            <div className={styles.timeFields}>
              <label>
                Opens
                <input
                  type="time"
                  value={businessHours.opensAt}
                  onChange={(event) =>
                    setBusinessHours({
                      ...businessHours,
                      opensAt: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Closes
                <input
                  type="time"
                  value={businessHours.closesAt}
                  onChange={(event) =>
                    setBusinessHours({
                      ...businessHours,
                      closesAt: event.target.value,
                    })
                  }
                />
              </label>
            </div>
          </>
        )}
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={collectContact}
            onChange={(event) => {
              setCollectContact(event.target.checked);
              if (!event.target.checked) setRequireContact(false);
            }}
          />
          Allow visitors to share contact details
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={requireContact}
            disabled={!collectContact}
            onChange={(event) => setRequireContact(event.target.checked)}
          />
          Require contact consent before chatting
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />{' '}
          Enable website chat
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={aiEnabled}
            disabled={!widget.aiAvailable}
            onChange={(e) => setAiEnabled(e.target.checked)}
          />{' '}
          Enable AI responses
        </label>
        {!widget.aiAvailable && (
          <p className={styles.muted}>
            Live AI is unavailable until the global AI service is configured and
            enabled. Published knowledge, assistant settings, and an active
            business are also required.
          </p>
        )}
        <button disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </section>
      <aside className={styles.card}>
        <h2>Live appearance preview</h2>
        <div
          className={`${styles.preview} ${theme === 'dark' ? styles.previewDark : ''}`}
        >
          <div className={styles.previewHeader} style={{ background: color }}>
            {logoUrl.startsWith('https://') && (
              <Image
                src={logoUrl}
                alt=""
                width={32}
                height={32}
                unoptimized
                className={styles.previewLogo}
              />
            )}
            <strong>{assistantName || 'Kleva Assistant'}</strong>
            <span>{widget.name}</span>
          </div>
          <div className={styles.previewMessages}>
            <span className={styles.previewBubble}>
              {welcome || 'Your welcome message appears here.'}
            </span>
            <span
              className={styles.previewVisitor}
              style={{ backgroundColor: color }}
            >
              Hello, I have a question.
            </span>
          </div>
          <div className={styles.previewComposer}>Type a message…</div>
        </div>
        <p className={styles.muted}>
          Sample only. The embedded widget loads published business knowledge
          when installed on an authorized website.
        </p>
        <h2>Install on your website</h2>
        <p>
          Add this script before the closing <code>&lt;/body&gt;</code> tag. The
          widget loads Kleva from its configured public origin.
        </p>
        <pre className={styles.code}>
          <code>{widget.installScript}</code>
        </pre>
        <button
          className={styles.secondary}
          onClick={() =>
            void navigator.clipboard
              ?.writeText(widget.installScript)
              .then(() => setNotice('Install code copied.'))
          }
        >
          Copy install code
        </button>
        <p>
          Connection:{' '}
          <strong>
            {widget.connectionStatus === 'active' && enabled
              ? 'Enabled for authorized origins'
              : enabled
                ? 'Action required'
                : 'Not connected'}
          </strong>
        </p>
        <button
          className={styles.danger}
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                'Rotate the public widget ID? Existing embed snippets will stop working.',
              )
            )
              void run(
                () =>
                  apiCall<{ publicId: string }>(
                    `/api/website-widget/${businessId}/${widget.id}/rotate`,
                    'POST',
                    {},
                  ),
                (result) => {
                  saveWidgetLocally({
                    ...widget,
                    publicId: result.publicId,
                    installScript: widget.installScript.replace(
                      widget.publicId,
                      result.publicId,
                    ),
                  });
                },
                'Widget ID rotated.',
              );
          }}
        >
          Rotate widget ID
        </button>
      </aside>
    </div>
  );
}
