import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { StatusBadge } from '@/components/status-badge';

export default async function WhatsAppPage({ searchParams }: { searchParams: Promise<{ businessId?: string }> }) {
  const { businessId } = await searchParams;
  const identity = await api.identity();
  if (businessId && !identity.memberships.some((item) => item.businessId === businessId)) redirect('/dashboard');
  const membership = identity.memberships.find((item) => item.businessId === businessId) ?? identity.memberships[0];
  if (!membership) redirect('/dashboard');
  let business;
  try { business = await api.business(membership.businessId); }
  catch (error) { if (error instanceof ApiError && error.status === 401) redirect('/login?error=session'); throw error; }
  let connection;
  let unavailable = false;
  try { connection = await api.whatsapp(business.id); }
  catch (error) { if (error instanceof ApiError && error.status === 401) redirect('/login?error=session'); unavailable = true; }
  const status = unavailable ? 'pending' : (connection?.status ?? 'pending');
  return <>
    <div className="page-heading"><div><div className="eyebrow">CHANNELS</div><h1>WhatsApp connection</h1><p className="muted">The connection status for {business.name}.</p></div></div>
    <section className="connection-card"><div className="connection-head"><div className="whatsapp-icon">◉</div><div><h2>WhatsApp Business</h2><p>Business messaging channel</p></div><StatusBadge status={status}/></div>
      {unavailable ? <div className="connection-message"><h3>We couldn’t check the current connection</h3><p>Refresh this page in a moment. If this keeps happening, reach out to your Kleva support contact.</p></div>
        : status === 'active' ? <div className="connection-message"><h3>Your WhatsApp is connected</h3><p>{connection?.displayName ? `${connection.displayName} is verified and ready for messages.` : 'Your verified WhatsApp Business connection is ready for messages.'}</p><div className="verified-note"><span>✓</span> Verified connection</div></div>
        : status === 'inactive' ? <div className="connection-message"><h3>Action required</h3><p>Your WhatsApp connection is currently inactive. Contact your Kleva support representative so they can review and restore the verified connection.</p></div>
        : <div className="connection-message"><h3>Connect with help from our team</h3><p>WhatsApp setup is supervised by Kleva so we can verify your business account and keep your credentials secure. Our team will guide you through the connection.</p><div className="supervised-steps"><div><span>1</span><p>Talk with your Kleva contact</p></div><div><span>2</span><p>Verify your WhatsApp Business account</p></div><div><span>3</span><p>We’ll confirm when it’s ready</p></div></div></div>}
    </section>
    {status === 'active' && connection?.displayName && <section className="connection-detail"><div className="eyebrow">CONNECTED ACCOUNT</div><div className="detail-row"><span>WhatsApp Business display name</span><strong>{connection.displayName}</strong></div><p className="muted detail-footnote">The current connection API does not provide a displayable phone number.</p></section>}
    <Link className="back-link" href={`/dashboard?businessId=${business.id}`}>← Back to overview</Link>
  </>;
}
