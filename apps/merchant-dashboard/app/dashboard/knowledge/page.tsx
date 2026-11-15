import { redirect } from 'next/navigation';
import { ApiError, api, type KnowledgeFaq } from '@/lib/api';
import { BusinessPicker } from '@/components/business-picker';
import { KnowledgeExperience } from './knowledge-experience';

export default async function KnowledgePage({
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
        <h1>Knowledge access required</h1>
        <p>
          Your business owner can grant knowledge editing to an owner or editor.
        </p>
      </section>
    );
  if (
    requested &&
    !memberships.some(({ businessId }) => businessId === requested)
  )
    redirect('/dashboard/knowledge');
  const membership =
    memberships.find(({ businessId }) => businessId === requested) ??
    memberships[0];
  let choices: { id: string; name: string }[];
  try {
    choices = await Promise.all(
      memberships.map(async ({ businessId }) => {
        const business = await api.business(businessId);
        return { id: businessId, name: business.name };
      }),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    choices = memberships.map(({ businessId }) => ({
      id: businessId,
      name: 'Business workspace',
    }));
  }
  let faqs: KnowledgeFaq[] = [];
  let initialError: string | null = null;
  try {
    faqs = await api.faqs(membership.businessId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    initialError =
      error instanceof ApiError
        ? error.message
        : 'The knowledge base could not be loaded. Try again.';
  }
  return (
    <div className="knowledge-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR BUSINESS INFORMATION</div>
          <h1>Knowledge Base</h1>
          <p className="muted">
            Write approved answers for Kleva to use when responding to
            customers.
          </p>
        </div>
        {choices.length > 1 && (
          <BusinessPicker
            action="/dashboard/knowledge"
            current={membership.businessId}
            choices={choices}
          />
        )}
      </div>
      <KnowledgeExperience
        key={membership.businessId}
        businessId={membership.businessId}
        initialFaqs={faqs}
        initialError={initialError}
      />
    </div>
  );
}
