import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ApiError, api } from '@/lib/api';
import { BusinessPicker } from '@/components/business-picker';
import { AnalyticsExperience } from './analytics-experience';
import styles from './analytics.module.css';

type Search = {
  businessId?: string;
  from?: string;
  to?: string;
  preset?: string;
  channel?: string;
};

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const search = await searchParams;
  let identity;
  try {
    identity = await api.identity();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    redirect('/login?error=unavailable');
  }
  const memberships = identity.memberships.filter(
    (item) => item.role === 'owner' || item.role === 'editor',
  );
  if (!memberships.length)
    return (
      <section className="empty-card">
        <h1>Analytics access required</h1>
        <p>Ask a business owner to grant you owner or editor access.</p>
      </section>
    );
  if (
    search.businessId &&
    !memberships.some((item) => item.businessId === search.businessId)
  )
    redirect('/dashboard/analytics');
  const membership =
    memberships.find((item) => item.businessId === search.businessId) ??
    memberships[0];
  const business = await api.business(membership.businessId);
  const query = {
    ...(search.from ? { from: search.from } : {}),
    ...(search.to ? { to: search.to } : {}),
    ...(search.preset ? { preset: search.preset } : {}),
    ...(search.channel ? { channel: search.channel } : {}),
  };
  let report;
  let errorMessage: string | null = null;
  try {
    report = await api.analytics(membership.businessId, query);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    report = null;
    errorMessage =
      error instanceof ApiError
        ? error.message
        : 'Analytics could not be loaded. Try again.';
  }
  const choices =
    memberships.length > 1
      ? await Promise.all(
          memberships.map(async (item) => ({
            id: item.businessId,
            name:
              (await api.business(item.businessId).catch(() => null))?.name ??
              'Business workspace',
          })),
        )
      : [];
  const refreshParams = new URLSearchParams();
  for (const [key, value] of Object.entries(search))
    if (value) refreshParams.set(key, value);
  return (
    <div className={styles.page}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">BUSINESS PERFORMANCE</div>
          <h1>Analytics</h1>
          <p className="muted">
            Customer conversations, support performance and recorded sales for{' '}
            {business.name}.
          </p>
        </div>
        {choices.length > 1 && (
          <BusinessPicker current={business.id} choices={choices} />
        )}
      </div>
      <form
        className={styles.filters}
        action="/dashboard/analytics"
        method="get"
      >
        <input type="hidden" name="businessId" value={business.id} />
        <label>
          Quick range
          <select name="preset" defaultValue={search.preset ?? '30d'}>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
        </label>
        <label>
          Channel
          <select name="channel" defaultValue={search.channel ?? 'ALL'}>
            <option value="ALL">All channels</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="WEBSITE">Website chat</option>
          </select>
        </label>
        <button className="button button-primary" type="submit">
          Apply filters
        </button>
      </form>
      <form
        className={styles.filters}
        action="/dashboard/analytics"
        method="get"
      >
        <input type="hidden" name="businessId" value={business.id} />
        <label>
          From
          <input type="date" name="from" defaultValue={search.from} />
        </label>
        <label>
          To
          <input type="date" name="to" defaultValue={search.to} />
        </label>
        <label>
          Channel
          <select name="channel" defaultValue={search.channel ?? 'ALL'}>
            <option value="ALL">All channels</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="WEBSITE">Website chat</option>
          </select>
        </label>
        <button className="button button-secondary" type="submit">
          Apply custom dates
        </button>
        <span className={styles.filterHint}>
          Maximum range: 90 local business dates.
        </span>
      </form>
      <div className={styles.refresh}>
        <Link href={`/dashboard/analytics?${refreshParams.toString()}`}>
          Refresh analytics
        </Link>
      </div>
      {errorMessage ? (
        <section className="empty-card" role="alert">
          <h2>Analytics unavailable</h2>
          <p>{errorMessage}</p>
          <a
            className="button button-secondary"
            href={`/dashboard/analytics?businessId=${business.id}`}
          >
            Try again
          </a>
        </section>
      ) : report ? (
        <AnalyticsExperience report={report} businessName={business.name} />
      ) : null}
    </div>
  );
}
