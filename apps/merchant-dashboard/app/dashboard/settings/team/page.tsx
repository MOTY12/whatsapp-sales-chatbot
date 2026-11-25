import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { TeamExperience } from './team-experience';

export default async function TeamSettings({
  searchParams,
}: {
  searchParams: Promise<{ businessId?: string }>;
}) {
  const { businessId: requested } = await searchParams;
  let identity;
  try {
    identity = await api.identity();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    throw error;
  }
  const selected =
    identity.memberships.find(
      (membership) => membership.businessId === requested,
    ) ?? identity.memberships[0];
  if (!selected) redirect('/dashboard');
  let business;
  try {
    business = await api.business(selected.businessId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    throw error;
  }
  const choices = await Promise.all(
    identity.memberships.map(async (membership) => {
      try {
        return {
          id: membership.businessId,
          name: (await api.business(membership.businessId)).name,
          role: membership.role,
        };
      } catch {
        return {
          id: membership.businessId,
          name: 'Business workspace',
          role: membership.role,
        };
      }
    }),
  );
  if (business.role !== 'owner')
    return (
      <>
        <div className="page-heading">
          <div>
            <div className="eyebrow">BUSINESS SETTINGS</div>
            <h1>Team</h1>
            <p className="muted">Manage who can work in {business.name}.</p>
          </div>
        </div>
        <section className="empty-card">
          <h2>Team administration is for owners</h2>
          <p>
            Your current role is {business.role}. Ask a business owner to manage
            invitations and membership access.
          </p>
        </section>
      </>
    );
  let members = { items: [], limit: 50, offset: 0, total: 0 } as Awaited<
    ReturnType<typeof api.team>
  >;
  let invitations = { items: [] } as Awaited<
    ReturnType<typeof api.teamInvitations>
  >;
  try {
    const [activeMembers, inactiveMembers, pending] = await Promise.all([
      api.team(business.id, 'active'),
      api.team(business.id, 'inactive'),
      api.teamInvitations(business.id),
    ]);
    members = {
      ...activeMembers,
      items: [...activeMembers.items, ...inactiveMembers.items],
      total: activeMembers.total + inactiveMembers.total,
    };
    invitations = pending;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
  }
  let audit: Awaited<ReturnType<typeof api.teamAudit>> = { items: [] };
  try {
    audit = await api.teamAudit(business.id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">BUSINESS SETTINGS</div>
          <h1>Team</h1>
          <p className="muted">
            Invite teammates and manage {business.name} access.
          </p>
        </div>
        <Link
          className="button button-secondary"
          href={`/dashboard/settings?businessId=${business.id}`}
        >
          Business settings
        </Link>
      </div>
      {choices.length > 1 && (
        <div className="team-business-select">
          <strong>Business workspaces</strong>
          <div>
            {choices.map((choice) => (
              <Link
                key={choice.id}
                className={
                  choice.id === business.id ? 'team-business-current' : ''
                }
                href={`/dashboard/settings/team?businessId=${choice.id}`}
              >
                {choice.name} · {choice.role}
              </Link>
            ))}
          </div>
        </div>
      )}
      <TeamExperience
        businessId={business.id}
        members={members.items}
        invitations={invitations.items}
        audit={audit.items}
      />
    </>
  );
}
