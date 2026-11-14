import Link from 'next/link';

const errors: Record<string, string> = {
  session: 'Your session has expired. Sign in again to continue.',
  callback: 'We could not complete sign-in. Please try again.',
  unavailable: 'Sign-in is temporarily unavailable. Please try again shortly.',
  configuration: 'Merchant sign-in is not configured yet. Contact your Kleva administrator.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <main className="login-page"><div className="login-card"><Link href="/" className="brand login-brand"><span className="brand-mark">k</span><span>Kleva</span></Link><div className="eyebrow">MERCHANT WORKSPACE</div><h1>Welcome back</h1><p className="muted">Sign in to manage your business on Kleva.</p>{error && <div className="alert" role="alert">{errors[error] ?? 'Something went wrong. Please try again.'}</div>}<a className="button button-primary button-wide" href="/auth/login">Continue with secure sign-in <span aria-hidden="true">→</span></a><p className="login-footnote">Your sign-in is protected by your organization’s identity provider.</p></div></main>;
}
