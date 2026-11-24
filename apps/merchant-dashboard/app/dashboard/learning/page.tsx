import { redirect } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { BusinessPicker } from '@/components/business-picker';
import { LearningGapsExperience } from './learning-gaps-experience';

export default async function LearningPage({
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
        <h1>Learning insights require knowledge access</h1>
        <p>Your business owner can grant access to an owner or editor.</p>
      </section>
    );
  if (
    requested &&
    !memberships.some(({ businessId }) => businessId === requested)
  )
    redirect('/dashboard/learning');
  const membership =
    memberships.find(({ businessId }) => businessId === requested) ??
    memberships[0];
  let choices: { id: string; name: string }[];
  try {
    choices = await Promise.all(
      memberships.map(async ({ businessId }) => ({
        id: businessId,
        name: (await api.business(businessId)).name,
      })),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    choices = memberships.map(({ businessId }) => ({
      id: businessId,
      name: 'Business workspace',
    }));
  }
  let initialData;
  let initialError: string | null = null;
  try {
    initialData = await api.knowledgeGaps(membership.businessId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    initialError =
      error instanceof ApiError
        ? error.message
        : 'Learning insights could not be loaded. Try again.';
    initialData = { items: [], limit: 50 };
  }
  return (
    <div className="knowledge-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">AI IMPROVEMENT</div>
          <h1>Learning gaps</h1>
          <p className="muted">
            Review questions the assistant could not reliably answer. Add or
            update published information in your Knowledge Base; Kleva never
            publishes changes automatically.
          </p>
        </div>
        {choices.length > 1 && (
          <BusinessPicker
            action="/dashboard/learning"
            current={membership.businessId}
            choices={choices}
          />
        )}
      </div>
      <LearningGapsExperience
        key={membership.businessId}
        businessId={membership.businessId}
        initialGaps={initialData.items}
        initialError={initialError}
      />
    </div>
  );
}
