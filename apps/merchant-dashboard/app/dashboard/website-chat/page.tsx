import { redirect } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { BusinessPicker } from '@/components/business-picker';
import { WebsiteChatExperience } from './website-chat-experience';

export default async function WebsiteChatPage({
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
    redirect('/login?error=unavailable');
  }
  const memberships = identity.memberships.filter(
    ({ role }) => role === 'owner',
  );
  if (!memberships.length)
    return (
      <section className="empty-card">
        <h1>Website chat setup requires an owner</h1>
        <p>Ask a business owner to configure the website widget.</p>
      </section>
    );
  if (
    requested &&
    !memberships.some(({ businessId }) => businessId === requested)
  )
    redirect('/dashboard/website-chat');
  const selected =
    memberships.find(({ businessId }) => businessId === requested) ??
    memberships[0];
  const businesses = await Promise.all(
    memberships.map(async ({ businessId }) => ({
      id: businessId,
      profile: await api.business(businessId).catch(() => null),
    })),
  );
  const choices = businesses.map(({ id, profile }) => ({
    id,
    name: profile?.name ?? 'Business workspace',
  }));
  let widgets = [] as Awaited<ReturnType<typeof api.websiteWidgets>>;
  let loadError: string | null = null;
  try {
    widgets = await api.websiteWidgets(selected.businessId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    loadError =
      error instanceof ApiError
        ? error.message
        : 'Website chat could not be loaded.';
  }
  return (
    <div className="knowledge-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">CHANNELS</div>
          <h1>Website Chat</h1>
          <p className="muted">
            Add an accessible AI sales assistant to your website. Visitors stay
            in a separate website conversation channel.
          </p>
        </div>
        {choices.length > 1 && (
          <BusinessPicker
            action="/dashboard/website-chat"
            current={selected.businessId}
            choices={choices}
          />
        )}
      </div>
      <WebsiteChatExperience
        key={selected.businessId}
        businessId={selected.businessId}
        businessTimezone={
          businesses.find(({ id }) => id === selected.businessId)?.profile
            ?.timezone ?? null
        }
        initialWidgets={widgets}
        loadError={loadError}
      />
    </div>
  );
}
