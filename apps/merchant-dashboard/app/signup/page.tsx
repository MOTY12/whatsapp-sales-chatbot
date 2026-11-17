import Link from 'next/link';
import { SignupForm } from '@/app/auth/password-forms';

const errors: Record<string, string> = {
  callback: 'We could not complete registration. Please try again.',
  unavailable:
    'Registration is temporarily unavailable. Please try again shortly.',
  configuration:
    'Merchant registration is not configured yet. Contact your Kleva administrator.',
  account_exists: 'An account already exists. Please sign in.',
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="signup-title">
        <Link href="/" className="brand login-brand">
          <span className="brand-mark">k</span>
          <span>Kleva</span>
        </Link>
        <div className="eyebrow">START YOUR MERCHANT WORKSPACE</div>
        <h1 id="signup-title">Create your account</h1>
        <p className="muted">
          Create your merchant account with email and password, or continue
          securely with Google.
        </p>
        {error && (
          <div className="alert" role="alert">
            {errors[error] ?? 'Something went wrong. Please try again.'}
          </div>
        )}
        <SignupForm />
        <p className="login-footnote">
          We will email a one-time verification link before enabling sign in.
        </p>
      </section>
    </main>
  );
}
