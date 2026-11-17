'use client';

import { FormEvent, useState } from 'react';

export function AuthMethods({ error }: { error?: string }) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  async function setPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get('password') ?? '');
    setNotice('');
    setFailure('');
    if (password !== String(data.get('confirmPassword') ?? '')) {
      setFailure('Passwords do not match.');
      return;
    }
    setPending(true);
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        cache: 'no-store',
      });
      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!response.ok)
        throw new Error(result.message ?? 'Could not save password.');
      setNotice(result.message ?? 'Password authentication is enabled.');
      form.reset();
    } catch (cause) {
      setFailure(
        cause instanceof Error ? cause.message : 'Could not save password.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="settings-section">
      <div className="section-title">
        <div>
          <h2>Sign-in methods</h2>
          <p className="muted">
            Add a password while signed in, or link a Google identity after
            authenticating with Google. Accounts are never merged by email
            address alone.
          </p>
        </div>
      </div>
      {error === 'google_linked' && (
        <p className="form-error" role="alert">
          That Google identity is already linked to another merchant account.
        </p>
      )}
      {notice && (
        <p className="form-success" role="status">
          {notice}
        </p>
      )}
      {failure && (
        <p className="form-error" role="alert">
          {failure}
        </p>
      )}
      <a className="button button-secondary" href="/auth/google/link">
        Link Google account
      </a>
      <form className="auth-form auth-method-form" onSubmit={setPassword}>
        <label className="auth-field" htmlFor="accountPassword">
          Set or change password
          <input
            id="accountPassword"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={1024}
            required
          />
        </label>
        <label className="auth-field" htmlFor="accountPasswordConfirm">
          Confirm password
          <input
            id="accountPasswordConfirm"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={1024}
            required
          />
        </label>
        <button className="button button-primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </section>
  );
}
