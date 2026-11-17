import Link from 'next/link';
import { ResetPasswordForm } from '@/app/auth/password-forms';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const safeToken = token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="reset-title">
        <Link href="/" className="brand login-brand">
          <span className="brand-mark">k</span>
          <span>Kleva</span>
        </Link>
        <div className="eyebrow">ACCOUNT RECOVERY</div>
        <h1 id="reset-title">Choose a new password</h1>
        {safeToken ? (
          <ResetPasswordForm token={safeToken} />
        ) : (
          <p className="form-error" role="alert">
            This reset link is invalid or expired. Request a new one.
          </p>
        )}
        <p className="auth-switch">
          <Link href="/forgot-password">Request another reset link</Link>
        </p>
      </section>
    </main>
  );
}
