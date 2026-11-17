import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { ProfileForm } from './profile-form';
import { logout } from '../actions';
import { AuthMethods } from './auth-methods';

export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ businessId?: string; error?: string }>;
}) {
  const { businessId, error } = await searchParams;
  const identity = await api.identity();
  if (
    businessId &&
    !identity.memberships.some((item) => item.businessId === businessId)
  )
    redirect('/dashboard');
  const membership =
    identity.memberships.find((item) => item.businessId === businessId) ??
    identity.memberships[0];
  if (!membership)
    return (
      <div className="empty-card">
        <h1>No business yet</h1>
        <p>Create your business profile to manage settings.</p>
        <Link className="button button-primary" href="/dashboard">
          Set up business
        </Link>
      </div>
    );
  let business;
  try {
    business = await api.business(membership.businessId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    throw error;
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKSPACE</div>
          <h1>Settings</h1>
          <p className="muted">Manage your business profile and account.</p>
        </div>
      </div>
      <section className="settings-section">
        <div className="section-title">
          <div>
            <h2>Business profile</h2>
            <p className="muted">Keep your business information up to date.</p>
          </div>
          <span className={`role-tag role-${business.role}`}>
            {business.role}
          </span>
        </div>
        {business.role === 'owner' ? (
          <ProfileForm business={business} />
        ) : (
          <div className="empty-card">
            <h3>Profile editing is for business owners</h3>
            <p>
              You can view this business as a {business.role}. Ask an owner to
              update its details.
            </p>
            <dl className="profile-readonly">
              <div>
                <dt>Name</dt>
                <dd>{business.name}</dd>
              </div>
              <div>
                <dt>Industry</dt>
                <dd>{business.industry}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{business.phone}</dd>
              </div>
            </dl>
          </div>
        )}
      </section>
      <AuthMethods error={error} />
      <section className="settings-section">
        <div className="section-title">
          <div>
            <h2>WhatsApp connection</h2>
            <p className="muted">Connection status and setup information.</p>
          </div>
        </div>
        <Link
          className="settings-link-card"
          href={`/dashboard/whatsapp?businessId=${business.id}`}
        >
          <span className="settings-icon">◉</span>
          <span>
            <strong>WhatsApp Business</strong>
            <small>View connection status and next steps</small>
          </span>
          <span className="chevron">→</span>
        </Link>
      </section>
      <section className="settings-section account-section">
        <div>
          <h2>Sign out</h2>
          <p className="muted">Sign out of your Kleva merchant workspace.</p>
        </div>
        <form action={logout}>
          <button className="button button-secondary">Sign out</button>
        </form>
      </section>
    </>
  );
}
