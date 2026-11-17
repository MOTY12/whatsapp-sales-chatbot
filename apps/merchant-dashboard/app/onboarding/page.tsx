import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { ApiError, api, type OnboardingStep } from '@/lib/api';
import { BusinessForm } from '@/app/dashboard/business-form';
import {
  requestAiPilotReview,
  saveOnboardingStep,
} from '@/app/dashboard/actions';

const steps: { id: OnboardingStep | 'account'; title: string }[] = [
  { id: 'account', title: 'Merchant account' },
  { id: 'business_profile', title: 'Business profile' },
  { id: 'whatsapp', title: 'WhatsApp connection' },
  { id: 'products_faq', title: 'Products and FAQs' },
  { id: 'ai_assistant', title: 'AI assistant' },
  { id: 'dashboard', title: 'Dashboard' },
];

async function safeStatus<T>(load: () => Promise<T>) {
  try {
    return { value: await load(), available: true };
  } catch {
    return { value: undefined, available: false };
  }
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; businessId?: string }>;
}) {
  const params = await searchParams;
  let identity;
  let progress;
  try {
    [identity, progress] = await Promise.all([
      api.identity(),
      api.onboarding(),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect('/login?error=session');
    redirect('/login?error=unavailable');
  }

  const requestedBusiness = params.businessId;
  if (
    requestedBusiness &&
    !identity.memberships.some(
      (membership) => membership.businessId === requestedBusiness,
    )
  ) {
    redirect('/onboarding');
  }
  const membership =
    identity.memberships.find(
      (item) => item.businessId === requestedBusiness,
    ) ?? identity.memberships[0];
  const business = membership
    ? await safeStatus(() => api.business(membership.businessId))
    : { value: undefined, available: true };
  const whatsapp = membership
    ? await safeStatus(() => api.whatsapp(membership.businessId))
    : { value: undefined, available: false };
  const [products, faqs, pilot] = membership
    ? await Promise.all([
        safeStatus(() => api.products(membership.businessId)),
        safeStatus(() => api.faqs(membership.businessId)),
        safeStatus(() => api.pilot(membership.businessId)),
      ])
    : [
        { value: undefined, available: false },
        { value: undefined, available: false },
        { value: undefined, available: false },
      ];

  const whatsappVerified =
    whatsapp.available && whatsapp.value?.status === 'active';
  const catalogReady =
    products.available &&
    products.value?.items.some((item) => item.status === 'PUBLISHED') ===
      true &&
    faqs.available &&
    faqs.value?.some((item) => item.status === 'PUBLISHED') === true;
  const pilotActive =
    pilot.available &&
    pilot.value?.status === 'ACTIVE' &&
    pilot.value.assistant_ready === true;
  const activeStep = progress.current_step;

  return (
    <div className="onboarding-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">KLEVA SETUP</div>
          <h1>Set up your merchant workspace</h1>
          <p className="muted">
            Your progress is saved. You can pause setup and return at any time.
          </p>
        </div>
        <Link className="button button-secondary" href="/dashboard">
          Open dashboard
        </Link>
      </div>

      {params.error && (
        <div className="alert" role="alert">
          We could not save your setup progress. Please try again.
        </div>
      )}

      <nav className="onboarding-stepper" aria-label="Onboarding steps">
        {steps.map((step, index) => {
          const complete =
            step.id === 'account'
              ? progress.completed_steps.includes('account')
              : step.id === 'business_profile'
                ? Boolean(membership)
                : step.id === 'whatsapp'
                  ? whatsappVerified
                  : step.id === 'products_faq'
                    ? catalogReady
                    : step.id === 'ai_assistant'
                      ? pilotActive
                      : false;
          return (
            <div
              className={`onboarding-step${complete ? ' onboarding-step-done' : ''}${step.id === activeStep ? ' onboarding-step-current' : ''}`}
              key={step.id}
              aria-current={step.id === activeStep ? 'step' : undefined}
            >
              <span>{complete ? '✓' : index + 1}</span>
              <strong>{step.title}</strong>
            </div>
          );
        })}
      </nav>

      <section className="onboarding-current">
        {activeStep === 'business_profile' && !membership ? (
          <>
            <div className="onboarding-copy">
              <div className="eyebrow">STEP 2 OF 6</div>
              <h2>Add your business profile</h2>
              <p>
                These details create your business workspace and assign you as
                its owner.
              </p>
            </div>
            <BusinessForm idempotencyKey={randomUUID()} />
          </>
        ) : activeStep === 'whatsapp' ? (
          <>
            <div className="eyebrow">STEP 3 OF 6</div>
            <h2>Connect WhatsApp Business</h2>
            <p>
              WhatsApp is marked connected only after Kleva verifies the
              connection with Meta.
            </p>
            <StatusLine
              complete={whatsappVerified}
              unknown={!whatsapp.available}
              completeText="Verified connection is active."
              waitingText="WhatsApp is not verified yet. Your setup progress does not change its connection status."
              unknownText="We could not check the connection status."
            />
            {membership && (
              <Link
                className="button button-secondary"
                href={`/dashboard/whatsapp?businessId=${membership.businessId}`}
              >
                View WhatsApp setup
              </Link>
            )}
          </>
        ) : activeStep === 'products_faq' ? (
          <>
            <div className="eyebrow">STEP 4 OF 6</div>
            <h2>Add products and FAQs</h2>
            <p>
              Add approved products and answers so Kleva can use accurate
              business information.
            </p>
            <StatusLine
              complete={catalogReady}
              unknown={!products.available || !faqs.available}
              completeText="A published product and FAQ are available."
              waitingText="Publish at least one product and one FAQ to complete this setup step."
              unknownText="We could not verify product and FAQ setup."
            />
            {membership && (
              <div className="onboarding-actions">
                <Link
                  className="button button-secondary"
                  href={`/dashboard/products?businessId=${membership.businessId}`}
                >
                  Set up products
                </Link>
                <Link
                  className="button button-secondary"
                  href={`/dashboard/knowledge?businessId=${membership.businessId}`}
                >
                  Set up FAQs
                </Link>
              </div>
            )}
          </>
        ) : activeStep === 'ai_assistant' ? (
          <>
            <div className="eyebrow">STEP 5 OF 6</div>
            <h2>Review AI assistant readiness</h2>
            <p>
              AI replies stay unavailable until the backend confirms an approved
              pilot. Do not treat this step as ready based on setup progress
              alone.
            </p>
            <StatusLine
              complete={pilotActive}
              unknown={!pilot.available}
              completeText="The backend confirms pilot approval, verified WhatsApp, and enabled AI responses."
              waitingText="Pilot approval, a verified active connection, and enabled AI responses are all required. Automation remains off until the backend confirms them."
              unknownText="We could not verify pilot approval."
            />
            {membership?.role === 'owner' &&
              whatsappVerified &&
              whatsapp.value?.id &&
              pilot.value?.status === 'NOT_ENROLLED' && (
                <form
                  action={requestAiPilotReview}
                  className="pilot-consent-form"
                >
                  <input
                    type="hidden"
                    name="businessId"
                    value={membership.businessId}
                  />
                  <input
                    type="hidden"
                    name="connectionId"
                    value={whatsapp.value.id}
                  />
                  <label>
                    <input
                      type="checkbox"
                      name="aiProviderDisclosureAccepted"
                      required
                    />
                    I understand customer conversations may be processed by
                    Kleva’s AI provider.
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      name="humanEscalationAccepted"
                      required
                    />
                    I will provide a human escalation contact and review
                    customer conversations when required.
                  </label>
                  <button className="button button-secondary" type="submit">
                    Submit pilot approval request
                  </button>
                </form>
              )}
            {pilot.available && pilot.value?.status === 'PENDING_REVIEW' && (
              <p className="muted" role="status">
                Your pilot request is awaiting Kleva review. AI responses are
                not marked ready while approval is pending.
              </p>
            )}
            {pilotActive && (
              <Link
                className="button button-secondary"
                href="/dashboard/conversations"
              >
                Open conversations to test the assistant
              </Link>
            )}
          </>
        ) : activeStep === 'dashboard' ? (
          <>
            <div className="eyebrow">STEP 6 OF 6</div>
            <h2>Your dashboard is ready</h2>
            <p>
              Optional setup can continue later. WhatsApp and AI status above
              reflects verified backend state.
            </p>
            <Link className="button button-primary" href="/dashboard">
              Continue to dashboard
            </Link>
          </>
        ) : (
          <>
            <div className="eyebrow">STEP 1 OF 6</div>
            <h2>Merchant account registered</h2>
            <p>
              Your Google identity is registered with Kleva. Next, create your
              business profile.
            </p>
          </>
        )}

        {activeStep === 'business_profile' && membership && (
          <div className="onboarding-copy">
            <div className="eyebrow">STEP 2 OF 6</div>
            <h2>{business.value?.name ?? 'Business profile saved'}</h2>
            <p>
              Your owner membership is active. Continue setup now or open the
              dashboard and return later.
            </p>
          </div>
        )}

        {activeStep !== 'dashboard' && (
          <div className="onboarding-footer">
            <form action={saveOnboardingStep}>
              <input
                type="hidden"
                name="currentStep"
                value={nextStep(activeStep)}
              />
              <button className="button button-primary" type="submit">
                Save progress and continue
              </button>
            </form>
            {membership && (
              <form action={saveOnboardingStep}>
                <input type="hidden" name="currentStep" value="dashboard" />
                <button className="onboarding-skip" type="submit">
                  Skip optional setup for now
                </button>
              </form>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function nextStep(step: OnboardingStep): OnboardingStep {
  const order: OnboardingStep[] = [
    'business_profile',
    'whatsapp',
    'products_faq',
    'ai_assistant',
    'dashboard',
  ];
  return order[Math.min(order.indexOf(step) + 1, order.length - 1)];
}

function StatusLine({
  complete,
  unknown,
  completeText,
  waitingText,
  unknownText,
}: {
  complete: boolean;
  unknown: boolean;
  completeText: string;
  waitingText: string;
  unknownText: string;
}) {
  return (
    <p
      className={`onboarding-status${complete ? ' is-complete' : ''}`}
      role="status"
    >
      <span aria-hidden="true">{complete ? '✓' : unknown ? '·' : '○'}</span>
      {complete ? completeText : unknown ? unknownText : waitingText}
    </p>
  );
}
