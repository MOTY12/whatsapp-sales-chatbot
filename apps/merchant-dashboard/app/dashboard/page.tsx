import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, api, type Business } from '@/lib/api';
import { StatusBadge } from '@/components/status-badge';
import { BusinessPicker } from '@/components/business-picker';

async function safeWhatsApp(id: string) {
  try {
    return await api.whatsapp(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    return null;
  }
}

export default async function Overview({
  searchParams,
}: {
  searchParams: Promise<{ businessId?: string; welcome?: string }>;
}) {
  const { businessId: requested, welcome } = await searchParams;
  const identity = await api.identity();
  if (!identity.memberships.length) redirect('/onboarding');
  if (
    requested &&
    !identity.memberships.some((item) => item.businessId === requested)
  )
    redirect('/dashboard');
  const membership =
    identity.memberships.find((item) => item.businessId === requested) ??
    identity.memberships[0];
  let business: Business;
  try {
    business = await api.business(membership.businessId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    throw error;
  }
  const whatsapp = await safeWhatsApp(business.id);
  const isConnected = whatsapp?.status === 'active';
  const status = whatsapp?.status ?? 'unknown';
  return (
    <>
      <div className="page-heading overview-heading">
        <div>
          <div className="eyebrow">YOUR WORKSPACE</div>
          <h1>Good to see you</h1>
          <p className="muted">
            Here’s where things stand with {business.name}.
          </p>
        </div>
        <Link
          className="button button-secondary"
          href={`/dashboard/settings?businessId=${business.id}`}
        >
          Edit business <span aria-hidden="true">↗</span>
        </Link>
      </div>
      {welcome && (
        <div className="success-banner" role="status">
          <span>✓</span>
          <div>
            <strong>Your business is ready.</strong>
            <span>Next, connect WhatsApp to start setting up Kleva.</span>
          </div>
        </div>
      )}
      {identity.memberships.length > 1 && (
        <BusinessPicker
          current={business.id}
          choices={await Promise.all(
            identity.memberships.map(async (item) => {
              try {
                const candidate = await api.business(item.businessId);
                return { id: item.businessId, name: candidate.name };
              } catch {
                return { id: item.businessId, name: 'Business workspace' };
              }
            }),
          )}
        />
      )}
      <section className="welcome-panel">
        <div className="welcome-copy">
          <span className="panel-kicker">YOUR BUSINESS</span>
          <h2>{business.name}</h2>
          <p>
            {business.industry} <span className="dot-separator">·</span>{' '}
            {business.timezone}
          </p>
          <div className="panel-status">
            <StatusBadge status={status} />
            <span>
              {isConnected
                ? 'WhatsApp is ready to use'
                : status === 'unknown'
                  ? 'Connection status could not be checked'
                  : 'WhatsApp setup is the next step'}
            </span>
          </div>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="chat-bubble">
            k<span>✦</span>
          </div>
          <div className="sparkle sparkle-a">✦</div>
          <div className="sparkle sparkle-b">✧</div>
        </div>
      </section>
      <div className="section-title">
        <div>
          <div className="eyebrow">GET READY</div>
          <h2>Your setup</h2>
        </div>
        <span className="progress-label">
          {isConnected
            ? 'Complete'
            : status === 'unknown'
              ? 'Status unavailable'
              : '1 of 2 steps'}
        </span>
      </div>
      <section className="setup-card">
        <div className="setup-step done">
          <span className="step-number">✓</span>
          <div className="step-content">
            <h3>Business profile</h3>
            <p>Your business details are saved and ready.</p>
          </div>
          <span className="step-state">Complete</span>
        </div>
        <div className="step-rule" />
        <div className="setup-step">
          <span className={`step-number ${isConnected ? 'step-complete' : ''}`}>
            {isConnected ? '✓' : '2'}
          </span>
          <div className="step-content">
            <h3>Connect WhatsApp</h3>
            <p>
              {isConnected
                ? 'Your verified connection is active.'
                : status === 'unknown'
                  ? 'Refresh to check your WhatsApp connection.'
                  : 'Our team will help verify and connect your WhatsApp Business account.'}
            </p>
          </div>
          <Link
            className="text-link"
            href={`/dashboard/whatsapp?businessId=${business.id}`}
          >
            {isConnected ? 'View status' : 'View setup'}{' '}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
      <section className="next-action">
        <div className="next-icon">✦</div>
        <div>
          <span className="panel-kicker">YOUR NEXT STEP</span>
          <h3>
            {isConnected
              ? 'Your WhatsApp is connected'
              : 'Let’s get your WhatsApp connected'}
          </h3>
          <p>
            {isConnected
              ? 'Your setup is complete. You can start reviewing your workspace.'
              : 'WhatsApp connection is handled with our team to keep your account secure and verified.'}
          </p>
        </div>
        <Link
          className="button button-primary"
          href={`/dashboard/whatsapp?businessId=${business.id}`}
        >
          {isConnected ? 'Connection details' : 'See how it works'}{' '}
          <span aria-hidden="true">→</span>
        </Link>
      </section>
      <section className="conversation-teaser">
        <div>
          <span className="panel-kicker">COMING UP</span>
          <h3>Conversations, all in one place</h3>
          <p>
            Once your WhatsApp is connected, your customer conversations will
            appear here.
          </p>
        </div>
        <Link
          href="/dashboard/conversations"
          className="button button-secondary"
        >
          Explore conversations <span aria-hidden="true">→</span>
        </Link>
      </section>
    </>
  );
}
