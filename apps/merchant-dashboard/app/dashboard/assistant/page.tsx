import { redirect } from 'next/navigation';
import {
  ApiError,
  api,
  type AssistantConfiguration,
  type MerchantProduct,
  type KnowledgeFaq,
} from '@/lib/api';
import { BusinessPicker } from '@/components/business-picker';
import { AssistantExperience } from './assistant-experience';

const defaults: Omit<AssistantConfiguration, 'businessId' | 'updatedAt'> = {
  revision: 0,
  assistantName: 'Kleva Assistant',
  greeting: 'Hello! How can I help you today?',
  tone: 'FRIENDLY',
  language: 'ENGLISH',
  responseLength: 'BALANCED',
  handoffBehavior: 'OFFER_HUMAN',
  fallbackResponse:
    'I don’t have enough published information to answer confidently. A team member can help.',
};

export default async function AssistantPage({
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
        <h1>AI assistant access required</h1>
        <p>
          Your business owner can grant assistant configuration access to an
          owner or editor.
        </p>
      </section>
    );
  if (
    requested &&
    !memberships.some(({ businessId }) => businessId === requested)
  )
    redirect('/dashboard/assistant');
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
  let config: AssistantConfiguration = {
    ...defaults,
    businessId: selected.businessId,
    updatedAt: null,
  };
  let configError: string | null = null;
  let business = null as Awaited<ReturnType<typeof api.business>> | null;
  let faqs: KnowledgeFaq[] = [];
  let products: MerchantProduct[] = [];
  let whatsappConnected = false;
  try {
    config = await api.assistantConfiguration(selected.businessId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    configError =
      error instanceof ApiError
        ? error.message
        : 'Assistant settings could not be loaded.';
  }
  try {
    business = await api.business(selected.businessId);
  } catch {
    /* readiness shows incomplete */
  }
  try {
    faqs = await api.faqs(selected.businessId);
  } catch {
    /* readiness shows no published FAQs */
  }
  try {
    products = (await api.products(selected.businessId, 50)).items;
  } catch {
    /* readiness shows no published products */
  }
  try {
    whatsappConnected =
      (await api.whatsapp(selected.businessId)).connectionState === 'connected';
  } catch {
    /* connection is not verified */
  }
  const publishedKnowledgeCount =
    faqs.filter(
      (item) => item.status === 'PUBLISHED' && item.published_revision !== null,
    ).length +
    products.filter(
      (item) => item.status === 'PUBLISHED' && item.published_revision !== null,
    ).length;
  const profileConfigured =
    !!business?.name &&
    !!business.industry &&
    !!business.phone &&
    !!business.timezone;

  return (
    <div className="assistant-page">
      <div className="page-heading assistant-heading">
        <div>
          <div className="eyebrow">TEST BEFORE YOU GO LIVE</div>
          <h1>AI Assistant</h1>
          <p className="muted">
            Tune how your assistant speaks, then try customer questions against
            published business information.
          </p>
        </div>
        {choices.length > 1 && (
          <BusinessPicker
            action="/dashboard/assistant"
            current={selected.businessId}
            choices={choices}
          />
        )}
      </div>
      <AssistantExperience
        key={selected.businessId}
        businessId={selected.businessId}
        initialConfiguration={config}
        initialError={configError}
        readiness={{
          profileConfigured,
          publishedKnowledgeCount,
          settingsSaved: config.revision > 0,
          whatsappConnected,
        }}
      />
    </div>
  );
}
