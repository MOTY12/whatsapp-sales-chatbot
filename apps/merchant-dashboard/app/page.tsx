import Link from 'next/link';

export default function Home() {
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="welcome-title">
        <Link href="/" className="brand login-brand">
          <span className="brand-mark">k</span>
          <span>Kleva</span>
        </Link>
        <div className="eyebrow">THE MERCHANT WORKSPACE</div>
        <h1 id="welcome-title">Turn conversations into customers.</h1>
        <p className="muted">
          Set up your business, connect WhatsApp, and manage customer questions
          in one place.
        </p>
        <div className="auth-actions">
          <Link className="button button-primary button-wide" href="/signup">
            Create account <span aria-hidden="true">→</span>
          </Link>
          <Link className="button button-secondary button-wide" href="/login">
            Sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
