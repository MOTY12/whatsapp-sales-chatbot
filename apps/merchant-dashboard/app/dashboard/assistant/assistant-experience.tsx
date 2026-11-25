'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  AssistantConfiguration,
  PlaygroundResult,
  PlaygroundTurn,
} from '@/lib/api';
import styles from './assistant.module.css';

type Readiness = {
  profileConfigured: boolean;
  publishedKnowledgeCount: number;
  settingsSaved: boolean;
  whatsappConnected: boolean;
};
type ChatEntry = {
  id: number;
  role: 'customer' | 'assistant';
  content: string;
  result?: PlaygroundResult;
};
type Props = {
  businessId: string;
  initialConfiguration: AssistantConfiguration;
  initialError: string | null;
  readiness: Readiness;
};
type Failure = { error?: { message?: string } };

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
    const failure = (await response.json().catch(() => null)) as Failure | null;
    throw new Error(
      failure?.error?.message ??
        'Kleva could not complete that request. Please try again.',
    );
  }
  return response.json() as Promise<T>;
}

const outcomeLabel: Record<PlaygroundResult['outcome'], string> = {
  ANSWERED: 'Grounded answer',
  CLARIFICATION: 'Clarification requested',
  HANDOFF: 'Human handoff recommended',
  INSUFFICIENT_EVIDENCE: 'Not enough published evidence',
  PROVIDER_FAILURE: 'Test could not be completed',
};

function csrfEvent(router: ReturnType<typeof useRouter>) {
  const onExpired = () => router.push('/login?error=session');
  window.addEventListener('kleva-session-expired', onExpired);
  return () => window.removeEventListener('kleva-session-expired', onExpired);
}

export function AssistantExperience({
  businessId,
  initialConfiguration,
  initialError,
  readiness,
}: Props) {
  const router = useRouter();
  const [configuration, setConfiguration] = useState(initialConfiguration);
  const [settings, setSettings] = useState(initialConfiguration);
  const [settingsError, setSettingsError] = useState(initialError);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [sending, setSending] = useState(false);
  const [playgroundError, setPlaygroundError] = useState('');
  const [tested, setTested] = useState(false);
  useEffect(() => csrfEvent(router), [router]);

  const published = readiness.publishedKnowledgeCount;
  const checks = [
    {
      label: 'Business profile configured',
      ready: readiness.profileConfigured,
    },
    {
      label: 'Published FAQs or products available',
      ready: published > 0,
      detail: published
        ? `${published} published sources`
        : 'Publish a FAQ or product first',
    },
    { label: 'Assistant settings saved', ready: configuration.revision > 0 },
    {
      label: 'WhatsApp connected and verified',
      ready: readiness.whatsappConnected,
    },
    { label: 'Playground tested', ready: tested },
  ];

  function change<K extends keyof AssistantConfiguration>(
    key: K,
    value: AssistantConfiguration[K],
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
    setNotice('');
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSettingsError('');
    setNotice('');
    try {
      const updated = await requestJson<AssistantConfiguration>(
        `/api/assistant/${businessId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            revision: settings.revision,
            assistantName: settings.assistantName,
            greeting: settings.greeting,
            tone: settings.tone,
            language: settings.language,
            responseLength: settings.responseLength,
            handoffBehavior: settings.handoffBehavior,
            fallbackResponse: settings.fallbackResponse,
          }),
        },
      );
      setConfiguration(updated);
      setSettings(updated);
      setNotice(
        'Assistant settings saved. Live automation remains off until separately approved.',
      );
    } catch (error) {
      setSettingsError(
        error instanceof Error
          ? error.message
          : 'Could not save assistant settings.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function sendTest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const customerMessage = message.trim();
    if (!customerMessage || sending) return;
    setSending(true);
    setPlaygroundError('');
    setMessage('');
    try {
      const history: PlaygroundTurn[] = entries
        .slice(-6)
        .map(({ role, content }) => ({ role, content }));
      const result = await requestJson<PlaygroundResult>(
        `/api/assistant/${businessId}/playground`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: customerMessage, history }),
        },
      );
      const customerEntry: ChatEntry = {
        id: Date.now(),
        role: 'customer',
        content: customerMessage,
      };
      const assistantEntry: ChatEntry = {
        id: Date.now() + 1,
        role: 'assistant',
        content: result.reply,
        result,
      };
      setEntries((current) =>
        [...current, customerEntry, assistantEntry].slice(-14),
      );
      setTested(true);
    } catch (error) {
      setPlaygroundError(
        error instanceof Error
          ? error.message
          : 'The test reply could not be generated.',
      );
      setMessage(customerMessage);
    } finally {
      setSending(false);
    }
  }

  function reset() {
    setEntries([]);
    setMessage('');
    setPlaygroundError('');
    setTested(false);
  }

  return (
    <div className={styles.layout}>
      <section
        className={styles.settingsCard}
        aria-labelledby="assistant-settings-heading"
      >
        <div className={styles.sectionHeading}>
          <div>
            <div className="eyebrow">YOUR ASSISTANT</div>
            <h2 id="assistant-settings-heading">Response settings</h2>
            <p>
              These choices tune wording only. Kleva’s grounding and safety
              rules stay in place.
            </p>
          </div>
          <span className={styles.revision}>
            Revision {configuration.revision}
          </span>
        </div>
        <form onSubmit={saveSettings} className={styles.settingsForm}>
          <label>
            Assistant display name
            <input
              maxLength={80}
              value={settings.assistantName}
              onChange={(event) => change('assistantName', event.target.value)}
              required
            />
          </label>
          <label>
            Business greeting
            <textarea
              maxLength={300}
              rows={2}
              value={settings.greeting}
              onChange={(event) => change('greeting', event.target.value)}
              required
            />
          </label>
          <div className={styles.formGrid}>
            <label>
              Response tone
              <select
                value={settings.tone}
                onChange={(event) =>
                  change(
                    'tone',
                    event.target.value as AssistantConfiguration['tone'],
                  )
                }
              >
                <option value="PROFESSIONAL">Professional</option>
                <option value="FRIENDLY">Friendly</option>
                <option value="CASUAL">Casual</option>
              </select>
            </label>
            <label>
              Preferred language
              <select
                value={settings.language}
                onChange={(event) =>
                  change(
                    'language',
                    event.target.value as AssistantConfiguration['language'],
                  )
                }
              >
                <option value="ENGLISH">English</option>
                <option value="NIGERIAN_PIDGIN">Nigerian Pidgin</option>
              </select>
            </label>
            <label>
              Response length
              <select
                value={settings.responseLength}
                onChange={(event) =>
                  change(
                    'responseLength',
                    event.target
                      .value as AssistantConfiguration['responseLength'],
                  )
                }
              >
                <option value="SHORT">Short</option>
                <option value="BALANCED">Balanced</option>
                <option value="DETAILED">Detailed</option>
              </select>
            </label>
            <label>
              Human handoff
              <select
                value={settings.handoffBehavior}
                onChange={(event) =>
                  change(
                    'handoffBehavior',
                    event.target
                      .value as AssistantConfiguration['handoffBehavior'],
                  )
                }
              >
                <option value="OFFER_HUMAN">Offer a person when needed</option>
                <option value="PRIORITIZE_HUMAN">
                  Prioritize a person for uncertain cases
                </option>
              </select>
            </label>
          </div>
          <label>
            Fallback when information is missing
            <textarea
              maxLength={500}
              rows={3}
              value={settings.fallbackResponse}
              onChange={(event) =>
                change('fallbackResponse', event.target.value)
              }
              required
            />
            <small>
              Used when published information cannot safely answer a customer.
            </small>
          </label>
          {settingsError && (
            <p className={styles.error} role="alert">
              {settingsError}
            </p>
          )}
          {notice && (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          )}
          <button className="button button-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save assistant settings'}
          </button>
        </form>
      </section>

      <section
        className={styles.playgroundCard}
        aria-labelledby="playground-heading"
      >
        <div className={styles.sectionHeading}>
          <div>
            <div className="eyebrow">PRIVATE SIMULATION</div>
            <h2 id="playground-heading">Test a conversation</h2>
            <p>
              Test messages use published business knowledge and are never sent
              on WhatsApp or saved as customer activity.
            </p>
          </div>
          <button
            className="button button-secondary"
            type="button"
            onClick={reset}
            disabled={sending && entries.length === 0}
          >
            Reset test
          </button>
        </div>
        <div
          className={styles.chat}
          aria-live="polite"
          aria-label="AI playground conversation"
        >
          {!entries.length && (
            <div className={styles.welcome}>
              <strong>{settings.assistantName}</strong>
              <p>{settings.greeting}</p>
              <small>
                Only published FAQs and products can support an answer.
              </small>
            </div>
          )}
          {entries.map((entry) => (
            <article
              key={entry.id}
              className={`${styles.bubble} ${entry.role === 'customer' ? styles.customer : styles.assistant}`}
            >
              <div className={styles.speaker}>
                {entry.role === 'customer'
                  ? 'Test customer'
                  : settings.assistantName}
              </div>
              <p>{entry.content}</p>
              {entry.result && (
                <div className={styles.diagnostics}>
                  <span
                    className={
                      entry.result.outcome === 'ANSWERED'
                        ? styles.outcomeGood
                        : styles.outcomeNotice
                    }
                  >
                    {outcomeLabel[entry.result.outcome]}
                  </span>
                  <span>
                    {entry.result.tokenUsage.kind === 'ACTUAL'
                      ? 'Actual'
                      : 'Estimated'}{' '}
                    tokens: {entry.result.tokenUsage.input} in ·{' '}
                    {entry.result.tokenUsage.output} out
                  </span>
                  <span>Reply time: {entry.result.durationMs} ms</span>
                  <span>
                    {entry.result.handoffRecommended
                      ? 'A human handoff would be recommended'
                      : 'No human handoff recommended'}
                  </span>
                  {entry.result.sources.length > 0 && (
                    <div className={styles.sources}>
                      <strong>Published sources used</strong>
                      {entry.result.sources.map((source) => (
                        <div
                          key={`${source.id}:${source.revisionId}`}
                          className={styles.source}
                        >
                          <span>
                            {source.type === 'FAQ'
                              ? 'FAQ'
                              : source.type === 'PRODUCT'
                                ? 'Product'
                                : 'PDF'}{' '}
                            · {source.title}
                            {' · '}{(source.retrievalMethod ?? 'LEXICAL').toLocaleLowerCase().replace('_', ' ')}
                            {' · Revision '}{source.revisionId}
                            {source.pageNumber
                              ? ` · Page ${source.pageNumber}`
                              : ''}
                          </span>
                          <small>{source.excerpt}</small>
                        </div>
                      ))}
                    </div>
                  )}
                  {entry.result.toolExecutions.length > 0 && (
                    <div className={styles.sources}>
                      <strong>Tool simulation (no live changes)</strong>
                      {entry.result.toolExecutions.map((tool, index) => (
                        <div
                          key={`${tool.requestedTool}:${index}`}
                          className={styles.source}
                        >
                          <span>
                            {tool.requestedTool} · {tool.validation}
                          </span>
                          <small>
                            Simulated: {tool.simulatedOutcome}
                            {tool.reason ? ` · ${tool.reason}` : ''}
                            {tool.sideEffects === false
                              ? ' · no side effects'
                              : ''}
                          </small>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </article>
          ))}
          {sending && (
            <div className={styles.loading} role="status">
              Checking published information…
            </div>
          )}
        </div>
        {playgroundError && (
          <p className={styles.error} role="alert">
            {playgroundError}
          </p>
        )}
        <form onSubmit={sendTest} className={styles.composer}>
          <label className="sr-only" htmlFor="playground-message">
            Test customer message
          </label>
          <input
            id="playground-message"
            maxLength={1000}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ask about a product, delivery, or business policy…"
            disabled={sending}
          />
          <button
            className="button button-primary"
            disabled={sending || !message.trim()}
          >
            {sending ? 'Testing…' : 'Send test'}
          </button>
        </form>
      </section>

      <aside className={styles.readiness} aria-labelledby="readiness-heading">
        <div>
          <div className="eyebrow">BEFORE LIVE AUTOMATION</div>
          <h2 id="readiness-heading">Readiness checklist</h2>
          <p>
            This is informational. The playground never activates WhatsApp
            automation.
          </p>
        </div>
        <ul>
          {checks.map((check) => (
            <li key={check.label}>
              <span
                className={
                  check.ready ? styles.checkReady : styles.checkPending
                }
                aria-hidden="true"
              >
                {check.ready ? '✓' : '○'}
              </span>
              <span>
                <strong>{check.label}</strong>
                {check.detail && <small>{check.detail}</small>}
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
