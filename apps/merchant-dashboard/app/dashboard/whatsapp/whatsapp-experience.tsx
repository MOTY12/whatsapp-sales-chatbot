'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { WhatsAppStatus } from '@/lib/api';
import styles from './whatsapp.module.css';

type Props = {
  businessId: string;
  initialStatus: WhatsAppStatus;
  canManage: boolean;
};
type Settings = {
  attemptId: string;
  appId: string;
  configId: string;
  apiVersion: string;
};
type Asset = { wabaId: string; phoneNumberId: string };
type Failure = { error?: { message?: string } };
type MetaSdkResponse = { authResponse?: { code?: string } };

declare global {
  interface Window {
    FB?: {
      init(config: {
        appId: string;
        version: string;
        autoLogAppEvents: boolean;
        xfbml: boolean;
      }): void;
      login(
        callback: (response: MetaSdkResponse) => void,
        options: {
          config_id: string;
          response_type: 'code';
          override_default_response_type: boolean;
          extras: { setup: Record<string, never> };
        },
      ): void;
    };
  }
}

async function post<T>(
  path: string,
  body?: unknown,
  method = 'POST',
): Promise<T> {
  const csrfPair = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => /^(?:__Host-)?kleva_csrf=/i.test(part));
  const headers = new Headers({ Accept: 'application/json' });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (csrfPair)
    headers.set(
      'X-CSRF-Token',
      decodeURIComponent(csrfPair.slice(csrfPair.indexOf('=') + 1)),
    );
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
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as Failure | null;
    throw new Error(
      payload?.error?.message ??
        'WhatsApp could not be updated. Please try again.',
    );
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}

function safeMetaEvent(
  event: MessageEvent,
): { event?: string; data?: Record<string, unknown> } | null {
  let facebookOrigin = false;
  try {
    const origin = new URL(event.origin);
    facebookOrigin =
      origin.protocol === 'https:' &&
      (origin.hostname === 'facebook.com' ||
        origin.hostname.endsWith('.facebook.com'));
  } catch {
    facebookOrigin = false;
  }
  if (
    !facebookOrigin ||
    typeof event.data !== 'string' ||
    event.data.length > 8192
  )
    return null;
  try {
    const value: unknown = JSON.parse(event.data);
    if (
      !value ||
      typeof value !== 'object' ||
      (value as Record<string, unknown>).type !== 'WA_EMBEDDED_SIGNUP'
    )
      return null;
    const record = value as Record<string, unknown>;
    return {
      event: typeof record.event === 'string' ? record.event : undefined,
      data:
        record.data && typeof record.data === 'object'
          ? (record.data as Record<string, unknown>)
          : undefined,
    };
  } catch {
    return null;
  }
}

export function WhatsAppExperience({
  businessId,
  initialStatus,
  canManage,
}: Props) {
  const router = useRouter();
  const [connection, setConnection] = useState(initialStatus);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [pin, setPin] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [reconnectOpen, setReconnectOpen] = useState(false);
  const codeRef = useRef<string | null>(null);
  const assetRef = useRef<Asset | null>(null);
  const attemptRef = useRef<string | null>(null);
  const completedRef = useRef(false);
  const pinRef = useRef('');
  const path = `/api/whatsapp/${encodeURIComponent(businessId)}`;
  const state =
    connection.connectionState ??
    (connection.status === 'active'
      ? 'connected'
      : connection.status === 'inactive'
        ? 'failed'
        : 'not_connected');

  useEffect(() => {
    const onSessionExpired = () => router.push('/login?error=session');
    window.addEventListener('kleva-session-expired', onSessionExpired);
    return () =>
      window.removeEventListener('kleva-session-expired', onSessionExpired);
  }, [router]);

  useEffect(() => {
    if (!settings || !sdkLoaded || !window.FB) return;
    window.FB.init({
      appId: settings.appId,
      version: settings.apiVersion,
      autoLogAppEvents: true,
      xfbml: false,
    });
  }, [settings, sdkLoaded]);

  useEffect(() => {
    async function onMessage(event: MessageEvent) {
      const message = safeMetaEvent(event);
      if (!message || !settings) return;
      const data = message.data ?? {};
      if (message.event === 'FINISH') {
        if (
          typeof data.waba_id === 'string' &&
          typeof data.phone_number_id === 'string'
        ) {
          assetRef.current = {
            wabaId: data.waba_id,
            phoneNumberId: data.phone_number_id,
          };
          await finishIfReady();
        } else {
          await report('action_required');
          setError(
            'Meta finished account setup without returning a phone number. Restart signup and select an eligible WhatsApp number.',
          );
        }
      } else if (message.event === 'FINISH_ONLY_WABA') {
        await report('action_required');
        setError(
          'The WhatsApp account was selected, but no phone number was connected. Restart setup and choose or add a number.',
        );
      } else if (message.event === 'CANCEL') {
        await report('cancelled');
        setNotice(
          'WhatsApp setup was cancelled. You can start again at any time.',
        );
      } else if (message.event === 'ERROR') {
        await report('failed');
        setError(
          'Meta could not complete WhatsApp setup. Review the selected account and try again.',
        );
      } else if (message.event?.startsWith('FINISH')) {
        await report('action_required');
        setError(
          'This Meta flow did not return a Cloud API phone number. Choose the Cloud API WhatsApp setup and select an eligible phone number.',
        );
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // finishIfReady and report intentionally access current refs for one signup attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  async function report(outcome: 'action_required' | 'failed' | 'cancelled') {
    if (!attemptRef.current) return;
    try {
      await post(`${path}/embedded-signup/report`, {
        attemptId: attemptRef.current,
        outcome,
      });
    } catch {
      /* state will expire and be recoverable server-side */
    }
    attemptRef.current = null;
    codeRef.current = null;
    assetRef.current = null;
    completedRef.current = false;
    setPending(false);
    setSettings(null);
    setPin('');
    pinRef.current = '';
    router.refresh();
  }

  async function finishIfReady() {
    if (
      !codeRef.current ||
      !assetRef.current ||
      !attemptRef.current ||
      completedRef.current
    )
      return;
    completedRef.current = true;
    setPending(true);
    setError(null);
    try {
      const updated = await post<WhatsAppStatus>(
        `${path}/embedded-signup/complete`,
        {
          attemptId: attemptRef.current,
          code: codeRef.current,
          wabaId: assetRef.current.wabaId,
          phoneNumberId: assetRef.current.phoneNumberId,
          registrationPin: pinRef.current,
        },
      );
      setConnection(updated);
      setReconnectOpen(false);
      setNotice(
        'Authorization received. Kleva is verifying and configuring your WhatsApp connection.',
      );
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'WhatsApp could not be connected. Try again.',
      );
      await report('failed');
    } finally {
      codeRef.current = null;
      assetRef.current = null;
      attemptRef.current = null;
      pinRef.current = '';
      setPin('');
      setSettings(null);
      setPending(false);
    }
  }

  useEffect(() => {
    if (state !== 'connecting') return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(path, { cache: 'no-store' });
        if (!response.ok) return;
        const updated = (await response.json()) as WhatsAppStatus;
        setConnection(updated);
        if (updated.connectionState === 'connected') {
          setNotice('WhatsApp Business is connected and verified.');
          window.clearInterval(timer);
          router.refresh();
        } else if (
          updated.connectionState === 'failed' ||
          updated.connectionState === 'action_required'
        ) {
          setError(
            updated.signupFailure
              ? `WhatsApp setup needs attention (${updated.signupFailure.toLowerCase().replaceAll('_', ' ')}). Start a new connection attempt to retry.`
              : 'WhatsApp setup needs attention. Review the provider requirements and try again.',
          );
          window.clearInterval(timer);
        }
      } catch {
        // Keep polling; transient dashboard requests do not alter provider state.
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [path, router, state]);

  async function connect() {
    setError(null);
    setNotice(null);
    if (!/^\d{6}$/.test(pin)) {
      setError(
        'Enter the six-digit WhatsApp two-step verification PIN for this phone number.',
      );
      return;
    }
    setPending(true);
    pinRef.current = pin;
    try {
      const signup = await post<Settings>(`${path}/embedded-signup/start`, {});
      setSettings(signup);
      attemptRef.current = signup.attemptId;
      codeRef.current = null;
      assetRef.current = null;
      completedRef.current = false;
      setPending(false);
    } catch (cause) {
      setPending(false);
      pinRef.current = '';
      setPin('');
      setError(
        cause instanceof Error
          ? cause.message
          : 'WhatsApp setup could not start. Try again.',
      );
      if (attemptRef.current) await report('failed');
    }
  }

  function launchSignup() {
    if (!settings || !sdkLoaded || !window.FB) {
      setError('Meta signup is still loading. Please try again in a moment.');
      return;
    }
    setPending(true);
    window.FB.init({
      appId: settings.appId,
      version: settings.apiVersion,
      autoLogAppEvents: true,
      xfbml: false,
    });
    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (typeof code !== 'string' || code.length > 4096) {
          void report('cancelled');
          setError(
            'Meta authorization did not finish. Start WhatsApp setup again.',
          );
          return;
        }
        codeRef.current = code;
        void finishIfReady();
      },
      {
        config_id: settings.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {} },
      },
    );
  }

  async function disconnect() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrfToken() },
        cache: 'no-store',
      });
      if (!response.ok)
        throw new Error(
          'WhatsApp could not be disconnected. Please try again.',
        );
      setConnection({ status: 'inactive', connectionState: 'not_connected' });
      setConfirmDisconnect(false);
      setNotice('WhatsApp has been disconnected.');
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'WhatsApp could not be disconnected.',
      );
    } finally {
      setPending(false);
    }
  }

  const buttonLabel =
    state === 'connected'
      ? 'Reconnect WhatsApp'
      : state === 'connecting'
        ? 'Resume WhatsApp setup'
        : 'Connect WhatsApp';
  return (
    <>
      <Script
        src="https://connect.facebook.net/en_US/sdk.js"
        strategy="afterInteractive"
        onReady={() => setSdkLoaded(true)}
      />
      <section className={styles.card} aria-labelledby="whatsapp-title">
        <header className={styles.header}>
          <div className={styles.icon} aria-hidden="true">
            ◉
          </div>
          <div className={styles.heading}>
            <h2 id="whatsapp-title">WhatsApp Business</h2>
            <p>
              Securely connect the number customers already use to reach your
              business.
            </p>
          </div>
          <span
            className={`${styles.badge} ${styles[state] ?? ''}`}
            role="status"
            aria-label={stateLabel(state)}
          >
            {stateLabel(state)}
          </span>
        </header>
        {state === 'connected' ? (
          <div className={styles.connected}>
            <h3>WhatsApp is connected</h3>
            <p>
              Your number has been verified with Meta and is ready for the
              existing message webhook.
            </p>
            <dl>
              <div>
                <dt>Phone number</dt>
                <dd>{connection.displayPhoneNumber ?? 'Verified by Meta'}</dd>
              </div>
              <div>
                <dt>Verified business name</dt>
                <dd>{connection.displayName ?? 'Connected account'}</dd>
              </div>
              <div>
                <dt>Phone number ID</dt>
                <dd>{connection.phoneNumberId}</dd>
              </div>
              <div>
                <dt>WABA ID</dt>
                <dd>{connection.wabaId}</dd>
              </div>
            </dl>
            {canManage && (
              <div className={styles.actions}>
                <button
                  className={styles.secondary}
                  type="button"
                  onClick={() => setReconnectOpen((open) => !open)}
                  disabled={pending}
                >
                  Reconnect WhatsApp
                </button>
                <button
                  className={styles.secondary}
                  type="button"
                  onClick={() => setConfirmDisconnect(true)}
                  disabled={pending}
                >
                  Disconnect
                </button>
              </div>
            )}
            {reconnectOpen && canManage && (
              <div className={styles.reconnect}>
                <label className={styles.field}>
                  Six-digit WhatsApp two-step PIN
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={pin}
                    onChange={(event) =>
                      setPin(event.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                    disabled={pending}
                  />
                </label>
                <small>
                  Reuse the PIN already assigned to this number. For a new Cloud
                  API number, choose a PIN you can keep securely. Kleva sends it
                  directly to Meta and does not store it.
                </small>
                <button
                  className={styles.primary}
                  type="button"
                  onClick={settings ? launchSignup : connect}
                  disabled={pending || !sdkLoaded}
                >
                  {pending
                    ? 'Opening Meta…'
                    : settings
                      ? 'Continue with Meta'
                      : 'Start secure reconnect'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.body}>
            {state === 'connecting' && (
              <p className={styles.info}>
                {connection.provisioningStage === 'CREDENTIAL_STAGED'
                  ? 'Authorization received. Verifying the selected account and phone number with Meta.'
                  : connection.provisioningStage === 'REGISTERING_PHONE'
                    ? 'Meta has accepted webhook subscription. Registering the business phone number.'
                    : connection.provisioningStage === 'VERIFYING_READINESS'
                      ? 'Checking that the connection is ready to receive messages.'
                      : 'WhatsApp setup is being verified and configured. This page will update when it finishes.'}
              </p>
            )}
            {state === 'action_required' && (
              <p className={styles.info}>
                Meta needs another setup step. Start again and complete the
                business and phone-number selection.
              </p>
            )}
            {state === 'failed' && (
              <p className={styles.info}>
                The last attempt was not verified. Start a new connection to
                retry securely.
              </p>
            )}
            <p>
              Meta will ask you to choose or create a WhatsApp Business Account
              and select an eligible business phone number. Kleva only activates
              the connection after Meta verification.
            </p>
            <label className={styles.field}>
              Six-digit WhatsApp two-step PIN
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={pin}
                onChange={(event) =>
                  setPin(event.target.value.replace(/\D/g, '').slice(0, 6))
                }
                aria-describedby="pin-help"
                disabled={!canManage || pending}
              />
            </label>
            <small id="pin-help">
              Meta uses this as the phone number&apos;s two-step verification
              PIN during Cloud API registration. Choose a PIN you can retain
              securely; Kleva sends it directly to Meta and does not store it.
            </small>
            <ol className={styles.steps}>
              <li>Choose your business portfolio and WhatsApp account.</li>
              <li>Select or add and verify your phone number with Meta.</li>
              <li>Kleva verifies the account and enables webhook delivery.</li>
            </ol>
            {canManage ? (
              <button
                className={styles.primary}
                type="button"
                onClick={settings ? launchSignup : connect}
                disabled={pending || !sdkLoaded}
              >
                {pending
                  ? 'Preparing…'
                  : settings
                    ? 'Continue with Meta'
                    : buttonLabel}
              </button>
            ) : (
              <p className={styles.info}>
                Ask a business owner to connect or manage this WhatsApp account.
              </p>
            )}
          </div>
        )}
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
      </section>
      {confirmDisconnect && (
        <div className={styles.backdrop} role="presentation">
          <section
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="disconnect-title"
          >
            <h2 id="disconnect-title">Disconnect WhatsApp?</h2>
            <p>
              New messages will stop reaching Kleva until the number is
              connected again. Existing conversations remain available.
            </p>
            <div>
              <button
                className={styles.secondary}
                type="button"
                onClick={() => setConfirmDisconnect(false)}
                disabled={pending}
              >
                Keep connected
              </button>
              <button
                className={styles.danger}
                type="button"
                onClick={disconnect}
                disabled={pending}
              >
                {pending ? 'Disconnecting…' : 'Disconnect WhatsApp'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function csrfToken() {
  const pair = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => /^(?:__Host-)?kleva_csrf=/i.test(part));
  return pair ? decodeURIComponent(pair.slice(pair.indexOf('=') + 1)) : '';
}

function stateLabel(state: string) {
  if (state === 'connected') return 'Connected';
  if (state === 'connecting') return 'Connecting';
  if (state === 'action_required') return 'Action required';
  if (state === 'failed') return 'Failed';
  return 'Not connected';
}
