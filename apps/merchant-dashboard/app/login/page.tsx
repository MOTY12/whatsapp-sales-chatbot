import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/app/auth/password-forms';

const errors: Record<string, string> = {
  credentials_in_url:
    'For your security, login details in a link are ignored. Enter them directly in the sign-in form.',
  credentials: 'Email or password is incorrect. Please try again.',
  session: 'Your session has expired. Sign in again to continue.',
  callback: 'We could not complete sign-in. Please try again.',
  unavailable: 'Sign-in is temporarily unavailable. Please try again shortly.',
  configuration:
    'Merchant sign-in is not configured yet. Contact your Kleva administrator.',
  not_registered: 'No merchant account found. Please create an account.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    email?: string | string[];
    password?: string | string[];
  }>;
}) {
  const params = await searchParams;
  if (params.email !== undefined || params.password !== undefined)
    redirect('/login?error=credentials_in_url');
  const { error } = params;
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <Link href="/" className="brand login-brand">
          <span className="brand-mark">k</span>
          <span>Kleva</span>
        </Link>
        <div className="eyebrow">MERCHANT WORKSPACE</div>
        <h1 id="login-title">Sign in</h1>
        <p className="muted">
          Sign in with your email and password or continue with Google.
        </p>
        {error && (
          <div className="alert" role="alert">
            {errors[error] ?? 'Something went wrong. Please try again.'}
          </div>
        )}
        <LoginForm />
        <p className="login-footnote">
          Both methods use Kleva’s secure HTTP-only merchant session.
        </p>
      </section>
    </main>
  );
}
