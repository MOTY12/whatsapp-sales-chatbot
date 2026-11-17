'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

type Result = { message?: string; nextPath?: string };

async function post(endpoint: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/auth/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => ({}))) as Result;
  if (!response.ok)
    throw new Error(
      payload.message ?? 'Authentication could not be completed.',
    );
  return payload;
}

function PasswordField({
  id,
  label,
  name,
  autoComplete,
  minLength,
}: {
  id: string;
  label: string;
  name: string;
  autoComplete: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="auth-field" htmlFor={id}>
      {label}
      <span className="auth-password-control">
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          maxLength={1024}
        />
        <button
          className="password-visibility"
          type="button"
          onClick={() => setVisible(!visible)}
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          aria-pressed={visible}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </span>
    </label>
  );
}

function Submit({ pending, children }: { pending: boolean; children: string }) {
  return (
    <button className="button button-primary button-wide" disabled={pending}>
      {pending ? 'Please wait…' : children}
    </button>
  );
}

export function SignupForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError('');
    setNotice('');
    const form = new FormData(formElement);
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirmPassword') ?? '')) {
      setError('Passwords do not match.');
      return;
    }
    setPending(true);
    try {
      const result = await post('register', {
        fullName: form.get('fullName'),
        email: form.get('email'),
        password,
      });
      setNotice(
        result.message ?? 'If registration can proceed, check your email.',
      );
      formElement.reset();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Registration could not be completed.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field" htmlFor="fullName">
          Full name
          <input
            id="fullName"
            name="fullName"
            type="text"
            autoComplete="name"
            required
            minLength={1}
            maxLength={160}
          />
        </label>
        <label className="auth-field" htmlFor="signupEmail">
          Email address
          <input
            id="signupEmail"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
          />
        </label>
        <PasswordField
          id="signupPassword"
          name="password"
          label="Password"
          autoComplete="new-password"
          minLength={12}
        />
        <PasswordField
          id="confirmPassword"
          name="confirmPassword"
          label="Confirm password"
          autoComplete="new-password"
          minLength={12}
        />
        <p className="auth-helper">
          Use 12 or more characters. Long passphrases, spaces, and symbols are
          welcome.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="form-success" role="status">
            {notice}
          </p>
        )}
        <Submit pending={pending}>Create account</Submit>
      </form>
      <div className="auth-divider">or</div>
      <a className="button button-secondary button-wide" href="/auth/signup">
        Continue with Google
      </a>
      <p className="auth-switch">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending(true);
    setError('');
    const form = new FormData(formElement);
    try {
      const result = await post('login/password', {
        email: form.get('email'),
        password: form.get('password'),
      });
      router.replace(result.nextPath ?? '/onboarding');
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Invalid email or password.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field" htmlFor="loginEmail">
          Email address
          <input
            id="loginEmail"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
          />
        </label>
        <PasswordField
          id="loginPassword"
          name="password"
          label="Password"
          autoComplete="current-password"
        />
        <div className="auth-inline-links">
          <span />
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Submit pending={pending}>Sign in</Submit>
      </form>
      <div className="auth-divider">or</div>
      <a className="button button-secondary button-wide" href="/auth/login">
        Continue with Google
      </a>
      <p className="auth-switch">
        New to Kleva? <Link href="/signup">Create an account</Link>
      </p>
    </>
  );
}

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending(true);
    setError('');
    try {
      const form = new FormData(formElement);
      const result = await post('forgot-password', {
        email: form.get('email'),
      });
      setNotice(
        result.message ??
          'If the account can reset its password, an email was sent.',
      );
      formElement.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Try again later.');
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="auth-field" htmlFor="resetEmail">
        Email address
        <input
          id="resetEmail"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-success" role="status">
          {notice}
        </p>
      )}
      <Submit pending={pending}>Send reset link</Submit>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirmPassword') ?? '')) {
      setError('Passwords do not match.');
      setPending(false);
      return;
    }
    try {
      const result = await post('reset-password', { token, password });
      setNotice(result.message ?? 'Password changed. Sign in again.');
      window.setTimeout(() => router.replace('/login'), 1200);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'This reset link is invalid or expired.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <PasswordField
        id="newPassword"
        name="password"
        label="New password"
        autoComplete="new-password"
        minLength={12}
      />
      <PasswordField
        id="newPasswordConfirm"
        name="confirmPassword"
        label="Confirm password"
        autoComplete="new-password"
        minLength={12}
      />
      <p className="auth-helper">
        Use 12 or more characters. Spaces and symbols are allowed.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-success" role="status">
          {notice}
        </p>
      )}
      <Submit pending={pending}>Reset password</Submit>
    </form>
  );
}

export function VerifyEmailPanel({ token }: { token?: string }) {
  const [pending, setPending] = useState(Boolean(token));
  const [message, setMessage] = useState(
    token ? '' : 'Open the verification link from your email to continue.',
  );
  const [error, setError] = useState('');
  useEffect(() => {
    if (!token) return;
    let active = true;
    void post('verify-email', { token })
      .then((result) => {
        if (active)
          setMessage(result.message ?? 'Email verification processed.');
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Verification could not be completed.',
          );
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [token]);
  return (
    <div>
      {pending && <p role="status">Verifying your email…</p>}
      {message && (
        <p className="form-success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <ResendVerificationForm />
      <p className="auth-switch">
        <Link href="/login">Return to sign in</Link>
      </p>
    </div>
  );
}

export function ResendVerificationForm() {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice('');
    setError('');
    try {
      const form = new FormData(event.currentTarget);
      const result = await post('resend-verification', {
        email: form.get('email'),
      });
      setNotice(
        result.message ??
          'If the account can be verified, an email has been sent.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Try again later.');
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="auth-field" htmlFor="resendEmail">
        Need another verification email?
        <input
          id="resendEmail"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-success" role="status">
          {notice}
        </p>
      )}
      <Submit pending={pending}>Resend verification email</Submit>
    </form>
  );
}
