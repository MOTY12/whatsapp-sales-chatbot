import 'server-only';
import { cookies } from 'next/headers';

export type Membership = {
  businessId: string;
  role: 'owner' | 'editor' | 'agent';
};
export type Identity = { accountId: string; memberships: Membership[] };
export type OnboardingStep =
  | 'business_profile'
  | 'whatsapp'
  | 'products_faq'
  | 'ai_assistant'
  | 'dashboard';
export type OnboardingProgress = {
  current_step: OnboardingStep;
  completed_steps: string[];
  updated_at: string;
};
export type Business = {
  id: string;
  name: string;
  status: string;
  role: Membership['role'];
  industry: string;
  phone: string;
  timezone: string;
  description: string | null;
  openingHours: string | null;
};
export type WhatsAppStatus = {
  status: 'active' | 'inactive' | 'pending';
  connectionState?:
    'not_connected' | 'connecting' | 'action_required' | 'failed' | 'connected';
  id?: string;
  displayName?: string | null;
  displayPhoneNumber?: string | null;
  phoneNumberId?: string;
  wabaId?: string;
  signupFailure?: string | null;
  signupExpiresAt?: string | null;
};
export type EmbeddedWhatsAppSignup = {
  attemptId: string;
  appId: string;
  configId: string;
  apiVersion: string;
};
export type EmbeddedWhatsAppSignupCompletion = {
  attemptId: string;
  code: string;
  wabaId: string;
  phoneNumberId: string;
  registrationPin: string;
};
export type MerchantPilotStatus = {
  enrollment_id?: string | null;
  connection_id?: string | null;
  consent_version?: string | null;
  status?: 'NOT_ENROLLED' | 'PENDING_REVIEW' | 'ACTIVE' | 'REVOKED';
  assistant_ready?: boolean;
  prerequisites?: {
    businessActive: boolean;
    whatsappConnectedAndVerified: boolean;
    pilotApproved: boolean;
    approvalMatchesConnection: boolean;
    aiResponsesEnabled: boolean;
  };
};

export type InboxMode = 'AUTO' | 'HUMAN';
export type Conversation = {
  id: string;
  customer_name: string;
  customer_whatsapp_id: string;
  last_activity: string;
  preview: string | null;
  status: string | null;
  control_mode: InboxMode;
  control_version: number | string;
  in_flight: number | string;
  handoff_needed?: boolean;
  assigned_to_account_id?: string | null;
  unread_count?: number | string;
};
export type ConversationDetail = Omit<
  Conversation,
  'last_activity' | 'preview'
> & {
  control_changed_at: string;
};
export type InboxMessage = {
  id: string;
  direction: 'inbound' | 'outbound' | string;
  content: string;
  status: string;
  provider_message_id: string | null;
  created_at: string;
  authorization_kind: 'AI' | 'HUMAN' | 'SYSTEM' | string | null;
  error_classification: string | null;
};
export type CursorPage<T> = { items: T[]; nextCursor: string | null };
export type InboxControlResult = {
  conversationId: string;
  mode: InboxMode;
  controlVersion: number;
  changedAt: string;
  changed: boolean;
};
export type InboxMember = { account_id: string; role: 'owner' | 'agent' };
export type InboxNote = {
  id: string;
  body: string;
  actor_account_id: string;
  created_at: string;
};
export type QueuedReply = { outboundMessageId: string; status: 'QUEUED' };
export type KnowledgeFaq = {
  id: string;
  status: 'DRAFT' | 'PUBLISHED';
  revision: number;
  published_revision: number | null;
  has_unpublished_changes: boolean;
  question: string;
  answer: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};
export type MerchantProduct = {
  id: string;
  status: 'DRAFT' | 'PUBLISHED';
  revision: number;
  published_revision: number | null;
  has_unpublished_changes: boolean;
  name: string;
  description: string;
  sku: string | null;
  price: string | null;
  currency: string;
  availability: 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN';
  published_at: string | null;
  created_at: string;
  updated_at: string;
};
export type ProductPage = {
  items: MerchantProduct[];
  limit: number;
  offset: number;
  hasMore: boolean;
};
export type ProductDraft = {
  name: string;
  description: string;
  sku: string | null;
  price: string | null;
  currency: string;
  availability: MerchantProduct['availability'];
};
export type MerchantLead = {
  id: string;
  customer_id: string;
  conversation_id: string;
  customer_name: string;
  customer_whatsapp_id: string;
  source: 'WHATSAPP';
  status: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'WON' | 'LOST';
  first_contact_at: string;
  last_activity_at: string;
  version: number;
  updated_at: string;
};

export type AssistantConfiguration = {
  businessId: string;
  revision: number;
  assistantName: string;
  greeting: string;
  tone: 'PROFESSIONAL' | 'FRIENDLY' | 'CASUAL';
  language: 'ENGLISH' | 'NIGERIAN_PIDGIN';
  responseLength: 'SHORT' | 'BALANCED' | 'DETAILED';
  handoffBehavior: 'OFFER_HUMAN' | 'PRIORITIZE_HUMAN';
  fallbackResponse: string;
  updatedAt: string | null;
};
export type PlaygroundResult = {
  reply: string;
  outcome:
    | 'ANSWERED'
    | 'CLARIFICATION'
    | 'HANDOFF'
    | 'INSUFFICIENT_EVIDENCE'
    | 'PROVIDER_FAILURE';
  sources: {
    id: string;
    revisionId: string;
    type: 'FAQ' | 'PRODUCT';
    title: string;
    excerpt: string;
  }[];
  tokenUsage: { input: number; output: number; kind: 'ACTUAL' | 'ESTIMATED' };
  durationMs: number;
  handoffRecommended: boolean;
};
export type PlaygroundTurn = {
  role: 'customer' | 'assistant';
  content: string;
};

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'quota_exceeded'
  | 'whatsapp_disconnected'
  | 'service_window_closed'
  | 'control_required'
  | 'rate_limited'
  | 'validation'
  | 'unavailable';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: ApiErrorCode = 'unavailable',
  ) {
    super(message);
  }
}

function backendErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const message = (payload as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (
    Array.isArray(message) &&
    message.every((item) => typeof item === 'string')
  )
    return message.join(' ');
  return undefined;
}

const backend = () => {
  const raw = process.env.KLEVA_BACKEND_ORIGIN;
  if (!raw) throw new Error('KLEVA_BACKEND_ORIGIN is required.');
  const url = new URL(raw);
  if (
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(
      'KLEVA_BACKEND_ORIGIN must be an origin without credentials or path.',
    );
  }
  return url.origin;
};

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<T> {
  const jar = await cookies();
  const cookieHeader = jar
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join('; ');
  const csrf = jar.getAll().find(({ name }) => /csrf/i.test(name))?.value;
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (cookieHeader) headers.set('Cookie', cookieHeader);
  if (['POST', 'PATCH', 'DELETE'].includes(init.method ?? 'GET')) {
    if (!csrf)
      throw new ApiError(403, 'Your session has expired. Sign in again.');
    headers.set('X-CSRF-Token', csrf);
    headers.set(
      'Origin',
      process.env.DASHBOARD_PUBLIC_ORIGIN ?? 'http://localhost:3001',
    );
  }

  let response: Response | undefined;
  const safeRead = (init.method ?? 'GET') === 'GET';
  for (let attempt = 0; attempt < (safeRead ? 2 : 1); attempt += 1) {
    try {
      response = await fetch(`${backend()}${path}`, {
        ...init,
        headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (
        !safeRead ||
        ![502, 503, 504].includes(response.status) ||
        attempt === 1
      )
        break;
    } catch {
      if (attempt === 1 || !safeRead)
        throw new ApiError(
          0,
          'Kleva is temporarily unavailable. Please try again.',
        );
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  if (!response)
    throw new ApiError(
      0,
      'Kleva is temporarily unavailable. Please try again.',
    );
  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    const backendMessage = backendErrorMessage(payload);
    if (response.status === 401)
      throw new ApiError(
        401,
        'Your session has expired. Sign in again.',
        'unauthorized',
      );
    if (response.status === 403)
      throw new ApiError(
        403,
        'You do not have permission to access this inbox.',
        'forbidden',
      );
    if (response.status === 404)
      throw new ApiError(
        404,
        'This conversation is no longer available.',
        'not_found',
      );
    if (response.status === 409)
      throw new ApiError(
        409,
        'This request conflicts with a recent change. Refresh and try again.',
        'conflict',
      );
    if (response.status === 429)
      if (backendMessage?.startsWith('Playground limit reached'))
        throw new ApiError(429, backendMessage, 'rate_limited');
      else
        throw new ApiError(
          429,
          'Your WhatsApp message allowance has been reached. Try again after your allowance resets.',
          'quota_exceeded',
        );
    if (
      response.status === 400 &&
      backendMessage === 'Verified WhatsApp connection is unavailable.'
    ) {
      throw new ApiError(
        400,
        'WhatsApp is disconnected. Contact your Kleva support representative to restore the connection.',
        'whatsapp_disconnected',
      );
    }
    if (
      response.status === 400 &&
      (backendMessage?.includes('window is closed') ||
        backendMessage?.includes('open customer-service window'))
    ) {
      throw new ApiError(
        400,
        'The 24-hour WhatsApp service window has closed. Wait for the customer to message again before replying.',
        'service_window_closed',
      );
    }
    if (
      response.status === 400 &&
      backendMessage === 'Take over this conversation before replying.'
    ) {
      throw new ApiError(
        400,
        'Take over the conversation before sending a reply.',
        'control_required',
      );
    }
    const message =
      response.status >= 500
        ? 'Kleva could not complete that request. Please try again.'
        : 'Please check the information and try again.';
    throw new ApiError(
      response.status,
      message,
      response.status >= 500 ? 'unavailable' : 'validation',
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  identity: () => request<Identity>('/auth/me'),
  onboarding: () => request<OnboardingProgress>('/auth/onboarding'),
  updateOnboarding: (currentStep: OnboardingStep) =>
    request<OnboardingProgress>('/auth/onboarding', {
      method: 'POST',
      body: JSON.stringify({ currentStep }),
    }),
  business: (id: string) =>
    request<Business>(`/merchant/businesses/${encodeURIComponent(id)}`),
  createBusiness: (
    body: Omit<Business, 'id' | 'status' | 'role'>,
    key: string,
  ) =>
    request<Business>('/merchant/businesses', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(body),
    }),
  updateBusiness: (
    id: string,
    body: Partial<
      Pick<
        Business,
        | 'name'
        | 'industry'
        | 'phone'
        | 'timezone'
        | 'description'
        | 'openingHours'
      >
    >,
  ) =>
    request<Business>(`/merchant/businesses/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  whatsapp: (id: string) =>
    request<WhatsAppStatus>(
      `/merchant/businesses/${encodeURIComponent(id)}/whatsapp`,
    ),
  disconnectWhatsApp: (id: string) =>
    request<WhatsAppStatus>(
      `/merchant/businesses/${encodeURIComponent(id)}/whatsapp`,
      { method: 'DELETE' },
    ),
  startWhatsAppSignup: (id: string) =>
    request<EmbeddedWhatsAppSignup>(
      `/merchant/businesses/${encodeURIComponent(id)}/whatsapp/embedded-signup/start`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  completeWhatsAppSignup: (
    id: string,
    body: EmbeddedWhatsAppSignupCompletion,
  ) =>
    request<WhatsAppStatus>(
      `/merchant/businesses/${encodeURIComponent(id)}/whatsapp/embedded-signup/complete`,
      { method: 'POST', body: JSON.stringify(body) },
      30000,
    ),
  reportWhatsAppSignup: (
    id: string,
    attemptId: string,
    outcome: 'action_required' | 'failed' | 'cancelled',
  ) =>
    request<{ ok: boolean }>(
      `/merchant/businesses/${encodeURIComponent(id)}/whatsapp/embedded-signup/report`,
      { method: 'POST', body: JSON.stringify({ attemptId, outcome }) },
    ),
  pilot: (id: string) =>
    request<MerchantPilotStatus>(
      `/merchant/businesses/${encodeURIComponent(id)}/pilot`,
    ),
  enrollPilot: (
    businessId: string,
    connectionId: string,
    aiProviderDisclosureAccepted: boolean,
    humanEscalationAccepted: boolean,
  ) =>
    request<{ status: string }>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/pilot/enroll`,
      {
        method: 'POST',
        body: JSON.stringify({
          connectionId,
          consentVersion: 'pilot-merchant-v1',
          aiProviderDisclosureAccepted,
          humanEscalationAccepted,
        }),
      },
    ),
  revokePilot: (businessId: string, enrollmentId: string) =>
    request<{ revoked: boolean }>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/pilot/${encodeURIComponent(enrollmentId)}/revoke`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  conversations: (
    businessId: string,
    limit = 30,
    cursor?: string,
    status: 'all' | 'open' | 'closed' = 'all',
    search?: string,
  ) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    query.set('status', status);
    if (search?.trim()) query.set('search', search.trim());
    return request<CursorPage<Conversation>>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/conversations?${query}`,
    );
  },
  conversation: (businessId: string, conversationId: string) =>
    request<ConversationDetail>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/conversations/${encodeURIComponent(conversationId)}`,
    ),
  inboxMembers: (businessId: string) =>
    request<InboxMember[]>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/conversations/members`,
    ),
  markConversationRead: (businessId: string, conversationId: string) =>
    request<{ last_read_at: string }>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/conversations/${encodeURIComponent(conversationId)}/read`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  assignConversation: (
    businessId: string,
    conversationId: string,
    accountId: string | null,
  ) =>
    request<{ assigned_to_account_id: string | null; changed: boolean }>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/conversations/${encodeURIComponent(conversationId)}/assignee`,
      { method: 'POST', body: JSON.stringify({ accountId }) },
    ),
  conversationNotes: (businessId: string, conversationId: string) =>
    request<InboxNote[]>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/conversations/${encodeURIComponent(conversationId)}/notes`,
    ),
  addConversationNote: (
    businessId: string,
    conversationId: string,
    text: string,
  ) =>
    request<InboxNote>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/conversations/${encodeURIComponent(conversationId)}/notes`,
      { method: 'POST', body: JSON.stringify({ text }) },
    ),
  setConversationStatus: (
    businessId: string,
    conversationId: string,
    status: 'open' | 'closed',
  ) =>
    request<{ status: string; updated_at: string }>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/conversations/${encodeURIComponent(conversationId)}/status`,
      { method: 'POST', body: JSON.stringify({ status }) },
    ),
  messages: (
    businessId: string,
    conversationId: string,
    limit = 30,
    cursor?: string,
  ) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    return request<CursorPage<InboxMessage>>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/conversations/${encodeURIComponent(conversationId)}/messages?${query}`,
    );
  },
  takeover: (businessId: string, conversationId: string) =>
    request<InboxControlResult>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/conversations/${encodeURIComponent(conversationId)}/takeover`,
      { method: 'POST' },
    ),
  release: (businessId: string, conversationId: string) =>
    request<InboxControlResult>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/conversations/${encodeURIComponent(conversationId)}/release`,
      { method: 'POST' },
    ),
  reply: (
    businessId: string,
    conversationId: string,
    text: string,
    idempotencyKey: string,
  ) =>
    request<QueuedReply>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/conversations/${encodeURIComponent(conversationId)}/replies`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ text }),
      },
    ),
  faqs: (businessId: string) =>
    request<KnowledgeFaq[]>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/faqs`,
    ),
  faq: (businessId: string, faqId: string) =>
    request<KnowledgeFaq>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/faqs/${encodeURIComponent(faqId)}`,
    ),
  createFaq: (
    businessId: string,
    question: string,
    answer: string,
    idempotencyKey: string,
  ) =>
    request<KnowledgeFaq>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/faqs`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ question, answer }),
      },
    ),
  updateFaq: (
    businessId: string,
    faqId: string,
    question: string,
    answer: string,
    expectedRevision: number,
  ) =>
    request<KnowledgeFaq>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/faqs/${encodeURIComponent(faqId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ question, answer, expectedRevision }),
      },
    ),
  publishFaq: (businessId: string, faqId: string) =>
    request<KnowledgeFaq>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/faqs/${encodeURIComponent(faqId)}/publish`,
      { method: 'POST' },
    ),
  unpublishFaq: (businessId: string, faqId: string) =>
    request<KnowledgeFaq>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/faqs/${encodeURIComponent(faqId)}/unpublish`,
      { method: 'POST' },
    ),
  products: (businessId: string, limit = 50, offset = 0) =>
    request<ProductPage>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/products?limit=${limit}&offset=${offset}`,
    ),
  leads: (businessId: string, status?: string, limit = 50, cursor?: string) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (status) query.set('status', status);
    if (cursor) query.set('cursor', cursor);
    return request<CursorPage<MerchantLead>>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/leads?${query}`,
    );
  },
  lead: (businessId: string, leadId: string) =>
    request<MerchantLead>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/leads/${encodeURIComponent(leadId)}`,
    ),
  updateLead: (
    businessId: string,
    leadId: string,
    body: { status: MerchantLead['status']; expectedVersion: number },
  ) =>
    request<{
      leadId: string;
      status: MerchantLead['status'];
      version: number;
      updatedAt: string;
      changed: boolean;
    }>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/leads/${encodeURIComponent(leadId)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  product: (businessId: string, productId: string) =>
    request<MerchantProduct>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/products/${encodeURIComponent(productId)}`,
    ),
  createProduct: (
    businessId: string,
    product: ProductDraft,
    idempotencyKey: string,
  ) =>
    request<MerchantProduct>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/products`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(product),
      },
    ),
  updateProduct: (
    businessId: string,
    productId: string,
    product: ProductDraft,
    expectedRevision: number,
  ) =>
    request<MerchantProduct>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/products/${encodeURIComponent(productId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ ...product, expectedRevision }),
      },
    ),
  publishProduct: (businessId: string, productId: string) =>
    request<MerchantProduct>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/products/${encodeURIComponent(productId)}/publish`,
      { method: 'POST' },
    ),
  unpublishProduct: (businessId: string, productId: string) =>
    request<MerchantProduct>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/products/${encodeURIComponent(productId)}/unpublish`,
      { method: 'POST' },
    ),
  assistantConfiguration: (businessId: string) =>
    request<AssistantConfiguration>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/assistant/configuration`,
    ),
  updateAssistantConfiguration: (
    businessId: string,
    configuration: AssistantConfiguration,
  ) =>
    request<AssistantConfiguration>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/assistant/configuration`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          revision: configuration.revision,
          assistantName: configuration.assistantName,
          greeting: configuration.greeting,
          tone: configuration.tone,
          language: configuration.language,
          responseLength: configuration.responseLength,
          handoffBehavior: configuration.handoffBehavior,
          fallbackResponse: configuration.fallbackResponse,
        }),
      },
    ),
  testAssistantMessage: (
    businessId: string,
    message: string,
    history: PlaygroundTurn[],
  ) =>
    request<PlaygroundResult>(
      `/merchant/businesses/${encodeURIComponent(businessId)}/assistant/playground`,
      { method: 'POST', body: JSON.stringify({ message, history }) },
      35000,
    ),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
};
