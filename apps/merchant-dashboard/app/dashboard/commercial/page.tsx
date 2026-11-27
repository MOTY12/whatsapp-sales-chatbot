import { redirect } from 'next/navigation';
import { BusinessPicker } from '@/components/business-picker';
import { ApiError, api } from '@/lib/api';
import { acceptCommercialOffer } from '../actions';
import styles from './commercial.module.css';

function date(value: string | null | undefined) {
  return value ? value.slice(0, 10) : 'Not set';
}

export default async function CommercialPage({
  searchParams,
}: {
  searchParams: Promise<{ businessId?: string; result?: string }>;
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
    ({ role }) => role === 'owner' || role === 'editor',
  );
  if (!memberships.length)
    return (
      <section className="empty-card">
        <h1>Plan &amp; Billing access required</h1>
        <p>Ask a business owner to review commercial account information.</p>
      </section>
    );
  if (
    search.businessId &&
    !memberships.some(({ businessId }) => businessId === search.businessId)
  )
    redirect('/dashboard/commercial');
  const member =
    memberships.find(({ businessId }) => businessId === search.businessId) ??
    memberships[0];
  const business = await api.business(member.businessId);
  let account;
  let readiness;
  let error: string | null = null;
  try {
    [account, readiness] = await Promise.all([
      api.commercial(member.businessId),
      api.commercialReadiness(member.businessId),
    ]);
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401)
      redirect('/login?error=session');
    error =
      cause instanceof ApiError
        ? cause.message
        : 'Commercial account details are temporarily unavailable.';
  }
  const enrollment = account?.enrollment;
  const ownerCanAccept = member.role === 'owner';
  return (
    <main>
      <header className="page-heading">
        <div>
          <div className="eyebrow">COMMERCIAL ACCOUNT</div>
          <h1>Plan &amp; Billing</h1>
          <p className="muted">
            Pilot terms, allowances, invoices and payment history for{' '}
            {business.name}.
          </p>
        </div>
        {memberships.length > 1 && (
          <BusinessPicker
            action="/dashboard/commercial"
            current={member.businessId}
            choices={await Promise.all(
              memberships.map(async (item) => ({
                id: item.businessId,
                name:
                  (await api.business(item.businessId).catch(() => null))
                    ?.name ?? 'Business workspace',
              })),
            )}
          />
        )}
      </header>
      {search.result === 'accepted' && (
        <p className="success-banner" role="status">
          Offer acceptance recorded. Kleva will follow up with the next
          commercial setup steps.
        </p>
      )}
      {search.result === 'error' && (
        <p className="error-banner" role="alert">
          The offer could not be accepted. Refresh and confirm it is still
          available.
        </p>
      )}
      {error ? (
        <section className="empty-card" role="alert">
          <h2>Billing details unavailable</h2>
          <p>{error}</p>
        </section>
      ) : !enrollment ? (
        <section className="empty-card">
          <h2>No commercial offer yet</h2>
          <p>
            A Kleva pilot operator will share an offer with the business owner
            when the package and terms are approved.
          </p>
        </section>
      ) : (
        <>
          <section className="welcome-panel">
            <div className="welcome-copy">
              <span className="panel-kicker">CURRENT PILOT OFFER</span>
              <h2>{enrollment.package_name}</h2>
              <p>
                Version {enrollment.package_version} · Agreement{' '}
                {enrollment.agreement_version}
              </p>
              <p>
                <strong>
                  {enrollment.currency} {enrollment.agreed_price}
                </strong>{' '}
                · {enrollment.pilot_days} days ·{' '}
                {enrollment.channels.join(' + ')}
              </p>
              <p>
                Status: <strong>{enrollment.status}</strong>
              </p>
              <p>
                Pilot dates: {date(enrollment.pilot_start_at)} –{' '}
                {date(enrollment.pilot_end_at)}
              </p>
            </div>
          </section>
          {enrollment.status === 'OFFERED' && (
            <section className="setup-card">
              <h2>Review and accept this offer</h2>
              <p>
                Acceptance records the package version, price, allowances,
                channels, support terms and agreement version shown here. This
                is separate from creating your Kleva account. Ask Kleva for the
                approved agreement terms before accepting.
              </p>
              <div>
                <strong>Included allowances</strong>
                <ul>
                  <li>
                    AI input tokens/month:{' '}
                    {enrollment.allowances.aiInputTokens ?? 0}
                  </li>
                  <li>
                    AI output tokens/month:{' '}
                    {enrollment.allowances.aiOutputTokens ?? 0}
                  </li>
                  <li>
                    Embedding tokens/month:{' '}
                    {enrollment.allowances.embeddingTokens ?? 0}
                  </li>
                  {enrollment.channels.includes('WHATSAPP') && (
                    <li>
                      WhatsApp outbound/month:{' '}
                      {enrollment.allowances.whatsappOutbound ?? 0}
                    </li>
                  )}
                  <li>AI tokens/request: {enrollment.per_request_ai_tokens}</li>
                </ul>
              </div>
              <p>
                Payment collection: manual external collection; Kleva does not
                charge automatically.
              </p>
              {ownerCanAccept ? (
                <form action={acceptCommercialOffer}>
                  <input
                    type="hidden"
                    name="businessId"
                    value={member.businessId}
                  />
                  <input type="hidden" name="offerId" value={enrollment.id} />
                  <button className="button button-primary" type="submit">
                    Accept commercial offer
                  </button>
                </form>
              ) : (
                <p>Only a business owner can accept this offer.</p>
              )}
            </section>
          )}
          {readiness && (
            <section className="setup-card">
              <h2>Commercial readiness</h2>
              <p>
                Current agreement status:{' '}
                {readiness.enrollmentStatus ?? 'No offer'}. Commercial readiness
                never activates AI or bypasses channel-specific approval.
              </p>
              <ul>
                {Object.entries(readiness.checklist).map(([key, complete]) => (
                  <li key={key}>
                    {key
                      .replace(/([A-Z])/g, ' $1')
                      .replace(/^./, (c) => c.toUpperCase())}
                    :{' '}
                    <strong>
                      {complete
                        ? 'Complete'
                        : key === 'widgetInstallationVerified' ||
                            key === 'releaseGatesSatisfied'
                          ? 'Not verified'
                          : 'Incomplete'}
                    </strong>
                  </li>
                ))}
              </ul>
              {readiness.blockers.length ? (
                <p role="status">
                  Outstanding blockers:{' '}
                  {readiness.blockers
                    .map((blocker) =>
                      blocker.replaceAll('_', ' ').toLowerCase(),
                    )
                    .join('; ')}
                  .
                </p>
              ) : (
                <p role="status">
                  Commercial and configured onboarding checks are complete.
                </p>
              )}
              {!readiness.websiteWidgetInstallationVerificationAvailable && (
                <p>
                  Website widget installation verification is not currently
                  available as a backend signal, so it is not marked complete.
                </p>
              )}
            </section>
          )}
          <section className="setup-card">
            <h2>Invoices</h2>
            {!account?.invoices.length ? (
              <p>No invoices have been issued.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Amount</th>
                      <th>Paid</th>
                      <th>Due</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td>{invoice.invoice_reference}</td>
                        <td>
                          {invoice.currency} {invoice.amount}
                        </td>
                        <td>
                          {invoice.currency} {invoice.paid_amount}
                        </td>
                        <td>{date(invoice.due_at)}</td>
                        <td>{invoice.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p>
              These are operational records for manually managed pilot billing,
              not tax invoices.
            </p>
          </section>
          <section className="setup-card">
            <h2>Confirmed payments</h2>
            {!account?.payments.length ? (
              <p>No confirmed payments are recorded.</p>
            ) : (
              <ul>
                {account.payments.map((payment) => (
                  <li key={payment.id}>
                    {payment.currency} {payment.amount} ·{' '}
                    {payment.method.replaceAll('_', ' ').toLowerCase()} ·{' '}
                    {date(payment.received_at)}
                  </li>
                ))}
              </ul>
            )}
            <p>
              For payment confirmation or support, contact the assigned Kleva
              support owner through the channel listed in your offer.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
