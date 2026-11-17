import Link from 'next/link';
import { ForgotPasswordForm } from '@/app/auth/password-forms';

export default function ForgotPasswordPage() {
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="forgot-title">
        <Link href="/" className="brand login-brand">
          <span className="brand-mark">k</span>
          <span>Kleva</span>
        </Link>
        <div className="eyebrow">ACCOUNT RECOVERY</div>
        <h1 id="forgot-title">Reset your password</h1>
        <p className="muted">
          Enter your email address. If password recovery is available, we will
          send you a reset link.
        </p>
        <ForgotPasswordForm />
        <p className="auth-switch">
          <Link href="/login">Return to sign in</Link>
        </p>
      </section>
    </main>
  );
}
