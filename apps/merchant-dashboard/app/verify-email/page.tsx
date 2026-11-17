import Link from 'next/link';
import { VerifyEmailPanel } from '@/app/auth/password-forms';

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const safeToken =
    token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="verify-title">
        <Link href="/" className="brand login-brand">
          <span className="brand-mark">k</span>
          <span>Kleva</span>
        </Link>
        <div className="eyebrow">EMAIL VERIFICATION</div>
        <h1 id="verify-title">Verify your email</h1>
        <p className="muted">
          Email verification is required before password sign in is enabled.
        </p>
        <VerifyEmailPanel token={safeToken} />
      </section>
    </main>
  );
}
