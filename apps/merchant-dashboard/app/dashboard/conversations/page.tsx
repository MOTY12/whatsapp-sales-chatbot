import { redirect } from 'next/navigation';
import {
  ApiError,
  api,
  type CursorPage,
  type Conversation,
  type InboxMember,
} from '@/lib/api';
import { BusinessPicker } from '@/components/business-picker';
import { InboxExperience } from './inbox-experience';

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    businessId?: string;
    conversationId?: string;
    status?: string;
    search?: string;
  }>;
}) {
  const {
    businessId: requested,
    conversationId,
    status: requestedStatus,
    search: requestedSearch,
  } = await searchParams;
  const status = ['all', 'open', 'closed'].includes(requestedStatus ?? '')
    ? (requestedStatus as 'all' | 'open' | 'closed')
    : 'all';
  const search = requestedSearch?.trim().slice(0, 100) ?? '';
  let identity;
  try {
    identity = await api.identity();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    redirect('/login?error=unavailable');
  }
  const memberships = identity.memberships.filter(
    (membership) => membership.role === 'owner' || membership.role === 'agent',
  );
  if (!memberships.length)
    return (
      <section className="empty-card">
        <h1>Inbox access required</h1>
        <p>
          Your business owner can grant inbox access to an authorized team
          member.
        </p>
      </section>
    );
  if (requested && !memberships.some((item) => item.businessId === requested))
    redirect('/dashboard/conversations');
  const membership =
    memberships.find((item) => item.businessId === requested) ?? memberships[0];
  let businesses: { id: string; name: string }[] = [];
  try {
    businesses = await Promise.all(
      memberships.map(async (item) => {
        const business = await api.business(item.businessId);
        return { id: item.businessId, name: business.name };
      }),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    if (memberships.length === 1)
      businesses = [{ id: membership.businessId, name: 'Business workspace' }];
    else
      businesses = memberships.map((item) => ({
        id: item.businessId,
        name: 'Business workspace',
      }));
  }
  let initialPage: CursorPage<Conversation> | null = null;
  let initialError: { code: string; message: string } | null = null;
  try {
    initialPage = await api.conversations(
      membership.businessId,
      30,
      undefined,
      status,
      search,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    initialError = {
      code: error instanceof ApiError ? error.code : 'unavailable',
      message:
        error instanceof ApiError
          ? error.message
          : 'The inbox could not be loaded. Try again.',
    };
  }
  let teammates: InboxMember[] = [];
  try {
    teammates = await api.inboxMembers(membership.businessId);
  } catch {
    // Conversation reading remains available if the optional assignment list is unavailable.
  }
  return (
    <div className="inbox-page">
      <div className="page-heading inbox-page-heading">
        <div>
          <div className="eyebrow">CUSTOMER SUPPORT</div>
          <h1>Conversations</h1>
          <p className="muted">
            Reply to customers and manage when automation is active.
          </p>
        </div>
        {businesses.length > 1 && (
          <BusinessPicker
            action="/dashboard/conversations"
            current={membership.businessId}
            choices={businesses}
          />
        )}
      </div>
      <InboxExperience
        key={`${membership.businessId}:${status}:${search}:${conversationId ?? ''}`}
        businessId={membership.businessId}
        accountId={identity.accountId}
        teammates={teammates}
        initialStatus={status}
        initialSearch={search}
        initialPage={initialPage}
        initialError={initialError}
        initialConversationId={conversationId}
      />
    </div>
  );
}
