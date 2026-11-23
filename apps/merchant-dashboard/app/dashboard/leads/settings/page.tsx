import { redirect } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { BusinessPicker } from '@/components/business-picker';
import { SalesPolicyExperience } from './sales-policy-experience';

export default async function SalesPolicyPage({
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
    ({ role }) => role === 'owner' || role === 'editor',
  );
  if (!memberships.length)
    return (
      <section className="empty-card">
        <h1>Qualification settings unavailable</h1>
        <p>Ask a business owner or editor to configure lead qualification.</p>
      </section>
    );
  if (
    requested &&
    !memberships.some(({ businessId }) => businessId === requested)
  )
    redirect('/dashboard/leads/settings');
  const selected =
    memberships.find(({ businessId }) => businessId === requested) ??
    memberships[0];
  const choices = await Promise.all(
    memberships.map(async ({ businessId }) => {
      try {
        return { id: businessId, name: (await api.business(businessId)).name };
      } catch {
        return { id: businessId, name: 'Business workspace' };
      }
    }),
  );
  let initial = null;
  let loadError: string | null = null;
  try {
    initial = await api.salesPolicy(selected.businessId);
  } catch (error) {
    loadError =
      error instanceof ApiError
        ? error.message
        : 'Qualification settings could not be loaded.';
  }
  return (
    <div className="knowledge-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">SALES FOLLOW-UP</div>
          <h1>Qualification settings</h1>
          <p className="muted">
            Choose the information your team records before qualifying leads.
          </p>
        </div>
        {choices.length > 1 && (
          <BusinessPicker
            action="/dashboard/leads/settings"
            current={selected.businessId}
            choices={choices}
          />
        )}
      </div>
      <SalesPolicyExperience
        businessId={selected.businessId}
        initial={initial}
        initialError={loadError}
      />
    </div>
  );
}
