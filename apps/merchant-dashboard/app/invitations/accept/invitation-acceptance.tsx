'use client';

import Link from 'next/link';
import { useState } from 'react';

type Result = {
  businessName?: string;
  role?: string;
  error?: { message?: string };
};

export function InvitationAcceptance() {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true);
    setResult(null);
    try {
      const csrf = document.cookie
        .split('; ')
        .find((part) => /kleva_csrf=/i.test(part))
        ?.split('=')
        .slice(1)
        .join('=');
      const response = await fetch('/api/invitations/accept', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf ?? '',
        },
        body: '{}',
        cache: 'no-store',
      });
      const payload = (await response.json()) as Result;
      if (!response.ok)
        throw new Error(
          payload.error?.message ?? 'Invitation could not be accepted.',
        );
      setResult(payload);
    } catch (error) {
      setResult({
        error: {
          message:
            error instanceof Error
              ? error.message
              : 'Invitation could not be accepted.',
        },
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-card">
      <div className="eyebrow">TEAM INVITATION</div>
      <h1>Join a business on Kleva</h1>
      <p className="muted">
        Sign in with the invited email address, then accept this one-time
        invitation.
      </p>
      {result?.businessName ? (
        <div role="status">
          <p>
            You joined <strong>{result.businessName}</strong> as an{' '}
            {result.role}.
          </p>
          <Link className="button button-primary" href="/dashboard">
            Open dashboard
          </Link>
        </div>
      ) : (
        <>
          {result?.error?.message && (
            <p role="alert" className="form-error">
              {result.error.message}
            </p>
          )}
          <button
            className="button button-primary"
            disabled={busy}
            onClick={accept}
          >
            {busy ? 'Accepting…' : 'Accept invitation'}
          </button>
          <p className="muted">
            If you are not signed in yet, <Link href="/login">sign in</Link>{' '}
            with the invited email and return here.
          </p>
        </>
      )}
    </section>
  );
}
