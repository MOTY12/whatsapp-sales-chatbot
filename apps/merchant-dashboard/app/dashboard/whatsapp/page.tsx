import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { WhatsAppExperience } from './whatsapp-experience';

export default async function WhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ businessId?: string }>;
}) {
  const { businessId } = await searchParams;
  const identity = await api.identity();
  if (
    businessId &&
    !identity.memberships.some((item) => item.businessId === businessId)
  )
    redirect('/dashboard');
  const membership =
    identity.memberships.find((item) => item.businessId === businessId) ??
    identity.memberships[0];
  if (!membership) redirect('/dashboard');
  let business;
  try {
    business = await api.business(membership.businessId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    throw error;
  }
  let connection;
  let unavailable = false;
  try {
    connection = await api.whatsapp(business.id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    unavailable = true;
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CHANNELS</div>
          <h1>WhatsApp connection</h1>
          <p className="muted">
            Manage the WhatsApp Business connection for {business.name}.
          </p>
        </div>
      </div>
      {unavailable ? (
        <section className="connection-card">
          <div className="connection-message">
            <h2>We couldn’t check the current connection</h2>
            <p>
              Refresh this page in a moment. If this keeps happening, reach out
              to your Kleva support contact.
            </p>
          </div>
        </section>
      ) : (
        <WhatsAppExperience
          businessId={business.id}
          initialStatus={
            connection ?? {
              status: 'pending',
              connectionState: 'not_connected',
            }
          }
          canManage={membership.role === 'owner'}
        />
      )}
      <Link className="back-link" href={`/dashboard?businessId=${business.id}`}>
        ← Back to overview
      </Link>
    </>
  );
}
