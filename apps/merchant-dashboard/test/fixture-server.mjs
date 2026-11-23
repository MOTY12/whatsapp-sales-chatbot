import { createServer } from 'node:http';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_BUSINESS_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECOND_CONVERSATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FIRST_FAQ_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const FIRST_PRODUCT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const DEFAULT_BUSINESS = {
  id: BUSINESS_ID,
  name: 'The Good Store',
  industry: 'Retail',
  phone: '+2348012345678',
  timezone: 'Africa/Lagos',
  description: null,
  openingHours: null,
  status: 'active',
  role: 'owner',
};
const SECOND_BUSINESS = {
  id: SECOND_BUSINESS_ID,
  name: 'Second Workspace',
  industry: 'Services',
  phone: '+2348011111111',
  timezone: 'Africa/Lagos',
  description: null,
  openingHours: null,
  status: 'active',
  role: 'owner',
};

let created = false;
let failedWhatsAppOnce = false;
let multipleBusinesses = false;
let emptyInbox = false;
let fixtureRole = 'owner';
let scenario = '';
let expireSession = false;
let businesses = structuredClone(DEFAULT_BUSINESS);
let mode = 'AUTO';
let changedAt = new Date().toISOString();
let messages = [];
let replies = new Map();
let repliesRequests = 0;
let controlInFlight = 0;
let faqs = [];
let faqKeys = new Map();
let faqCreateRequests = 0;
let products = [];
let leads = [];
let salesPolicy = null;
let leadQualifications = new Map();
let leadConversions = new Map();
let productKeys = new Map();
let productCreateRequests = 0;
let onboardingStep = 'business_profile';
let onboardingCompletedSteps = [];
let assistantConfig = {};
let assistantPlaygroundRequests = 0;
let internalNotes = [];
let assignedAccountId = null;
let conversationStatus = 'open';
let unreadCount = 2;

function reset(search = new URLSearchParams()) {
  created = false;
  failedWhatsAppOnce = false;
  multipleBusinesses = search.get('multiple') === '1';
  emptyInbox = search.get('empty') === '1';
  fixtureRole = search.get('role') ?? 'owner';
  scenario = search.get('scenario') ?? '';
  expireSession = false;
  businesses = structuredClone(DEFAULT_BUSINESS);
  mode = 'AUTO';
  changedAt = new Date().toISOString();
  replies = new Map();
  repliesRequests = 0;
  controlInFlight = 0;
  faqs = [];
  faqKeys = new Map();
  faqCreateRequests = 0;
  products = [];
  leads = [];
  salesPolicy = {
    version: 1,
    fields: [
      {
        id: 'product_interest',
        label: 'Product of interest',
        type: 'TEXT',
        required: true,
        validation: { maxLength: 240 },
        order: 10,
        purpose: 'Product the customer is considering.',
        consentRequired: false,
      },
      {
        id: 'quantity',
        label: 'Quantity',
        type: 'NUMBER',
        required: false,
        validation: { min: 1, max: 10000 },
        order: 20,
        purpose: 'Quantity requested.',
        consentRequired: false,
      },
    ],
    changed_by: 'fixture-owner',
    updated_at: new Date().toISOString(),
  };
  leadQualifications = new Map();
  leadConversions = new Map();
  productKeys = new Map();
  productCreateRequests = 0;
  onboardingStep = 'business_profile';
  onboardingCompletedSteps = [];
  assistantConfig = {
    businessId: BUSINESS_ID,
    revision: 0,
    assistantName: 'Kleva Assistant',
    greeting: 'Hello! How can I help you today?',
    tone: 'FRIENDLY',
    language: 'ENGLISH',
    responseLength: 'BALANCED',
    handoffBehavior: 'OFFER_HUMAN',
    fallbackResponse:
      'I don’t have enough published information to answer confidently. A team member can help.',
    updatedAt: null,
  };
  assistantPlaygroundRequests = 0;
  internalNotes = [];
  assignedAccountId = null;
  conversationStatus = 'open';
  unreadCount = 2;
  const now = Date.now();
  messages = Array.from({ length: 31 }, (_, index) => {
    const inbound = index % 2 === 0;
    const last = index === 30;
    return {
      id: `dddddddd-dddd-4ddd-8ddd-${String(index + 1).padStart(12, '0')}`,
      direction: inbound ? 'inbound' : 'outbound',
      content: `Fixture ${inbound ? 'customer' : 'merchant'} message ${String(index + 1).padStart(2, '0')}`,
      status: inbound
        ? 'received'
        : last
          ? 'delivered'
          : index === 29
            ? 'UNCERTAIN'
            : 'DELIVERED',
      provider_message_id: inbound ? null : `wamid-fixture-${index + 1}`,
      created_at: new Date(now - (31 - index) * 60_000).toISOString(),
      authorization_kind: inbound ? null : index === 29 ? 'HUMAN' : 'AI',
      error_classification: index === 29 ? 'PROVIDER_HTTP_401' : null,
    };
  });
  if (emptyInbox) messages = [];
}
reset();

function membershipList() {
  if (!created) return [];
  return [
    { businessId: BUSINESS_ID, role: fixtureRole },
    ...(multipleBusinesses
      ? [{ businessId: SECOND_BUSINESS_ID, role: 'owner' }]
      : []),
  ];
}

function listItems(businessId) {
  if (!created || emptyInbox || businessId === SECOND_BUSINESS_ID) return [];
  const first = messages.at(-1);
  return [
    {
      id: CONVERSATION_ID,
      customer_name: 'Amina Yusuf',
      customer_whatsapp_id: '+234 803 555 0101',
      last_activity: first?.created_at ?? changedAt,
      preview: first?.content ?? null,
      status: conversationStatus,
      control_mode: mode,
      control_version: 2,
      in_flight: String(controlInFlight),
      assigned_to_account_id: assignedAccountId,
      unread_count: String(unreadCount),
    },
    {
      id: SECOND_CONVERSATION_ID,
      customer_name: 'Olu Bello',
      customer_whatsapp_id: '+234 802 555 0102',
      last_activity: new Date(Date.now() - 3_600_000).toISOString(),
      preview: 'Do you have this in blue?',
      status: 'open',
      control_mode: 'AUTO',
      control_version: 1,
      in_flight: '0',
    },
  ];
}

function detail(conversationId, businessId) {
  if (
    !created ||
    businessId === SECOND_BUSINESS_ID ||
    conversationId !== CONVERSATION_ID
  )
    return null;
  return {
    ...listItems(businessId)[0],
    status: conversationStatus,
    control_changed_at: changedAt,
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const json = (status, value) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(value));
  };
  const hasSession =
    req.headers.cookie?.includes('kleva_session=fixture') && !expireSession;
  const validCsrf =
    req.headers['x-csrf-token'] === 'fixture-csrf' &&
    req.headers.origin === 'http://localhost:3101';

  if (url.pathname === '/health') return json(200, { ok: true });
  if (url.pathname === '/test/reset') {
    reset(url.searchParams);
    return json(200, { ok: true });
  }
  if (url.pathname === '/test/expire') {
    expireSession = true;
    return json(200, { ok: true });
  }
  if (url.pathname === '/test/scenario') {
    scenario = url.searchParams.get('value') ?? '';
    return json(200, { ok: true });
  }
  if (url.pathname === '/test/replies')
    return json(200, { count: repliesRequests });
  if (url.pathname === '/test/faqs')
    return json(200, { count: faqCreateRequests });
  if (url.pathname === '/test/assistant')
    return json(200, { requests: assistantPlaygroundRequests });
  if (url.pathname === '/test/products')
    return json(200, { count: productCreateRequests });
  if (url.pathname === '/test/leads' && req.method === 'POST') {
    leads = [
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        business_id: BUSINESS_ID,
        customer_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        conversation_id: CONVERSATION_ID,
        customer_name: 'Amina',
        customer_whatsapp_id: '2348012345678',
        source: 'WHATSAPP',
        status: 'NEW',
        first_contact_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        version: 1,
        updated_at: new Date().toISOString(),
      },
    ];
    return json(201, { count: leads.length });
  }
  if (url.pathname === '/test/leads') return json(200, { count: leads.length });
  if (url.pathname === '/auth/login') {
    res.writeHead(302, {
      Location:
        'http://localhost:3101/auth/callback?code=fixture&state=fixture',
      'Set-Cookie':
        'kleva_oidc_binding=fixture; Path=/; HttpOnly; SameSite=Lax',
    });
    return res.end();
  }
  if (url.pathname === '/auth/callback') {
    res.writeHead(302, {
      Location: '/auth/me',
      'Set-Cookie': [
        'kleva_session=fixture; Path=/; HttpOnly; SameSite=Lax',
        'kleva_csrf=fixture-csrf; Path=/; SameSite=Lax',
      ],
    });
    return res.end();
  }
  if (url.pathname === '/auth/me')
    return json(hasSession ? 200 : 401, {
      accountId: 'fixture-account',
      memberships: membershipList(),
    });
  if (url.pathname === '/auth/onboarding' && req.method === 'GET') {
    if (!hasSession) return json(401, { message: 'Unauthorized' });
    return json(200, {
      current_step: onboardingStep,
      completed_steps: onboardingCompletedSteps,
      updated_at: changedAt,
    });
  }
  if (url.pathname === '/auth/onboarding' && req.method === 'POST') {
    if (!hasSession || !validCsrf) return json(403, { message: 'Forbidden' });
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    const validSteps = [
      'business_profile',
      'whatsapp',
      'products_faq',
      'ai_assistant',
      'dashboard',
    ];
    if (!validSteps.includes(input.currentStep))
      return json(400, { message: 'Choose a valid onboarding step.' });
    onboardingStep = input.currentStep;
    changedAt = new Date().toISOString();
    return json(200, {
      current_step: onboardingStep,
      completed_steps: onboardingCompletedSteps,
      updated_at: changedAt,
    });
  }
  if (url.pathname === '/auth/logout' && req.method === 'POST') {
    if (!validCsrf || !hasSession) return json(403, { error: 'csrf' });
    res.writeHead(204, {
      'Set-Cookie': [
        'kleva_session=; Path=/; Max-Age=0',
        'kleva_csrf=; Path=/; Max-Age=0',
      ],
    });
    return res.end();
  }
  if (url.pathname === '/merchant/businesses' && req.method === 'POST') {
    if (!validCsrf || !hasSession) return json(403, { error: 'csrf' });
    if (!req.headers['idempotency-key'])
      return json(400, { error: 'key required' });
    let body = '';
    for await (const chunk of req) body += chunk;
    Object.assign(businesses, JSON.parse(body));
    created = true;
    return json(201, businesses);
  }
  const businessMatch = url.pathname.match(
    /^\/merchant\/businesses\/([0-9a-f-]+)$/i,
  );
  if (businessMatch?.[1] && req.method === 'GET') {
    if (businessMatch[1] === BUSINESS_ID && hasSession && created)
      return json(200, businesses);
    if (
      businessMatch[1] === SECOND_BUSINESS_ID &&
      hasSession &&
      created &&
      multipleBusinesses
    )
      return json(200, SECOND_BUSINESS);
    return json(404, { message: 'Not found.' });
  }
  if (
    url.pathname === `/merchant/businesses/${BUSINESS_ID}` &&
    req.method === 'PATCH'
  ) {
    if (!validCsrf || !hasSession || !created)
      return json(403, { error: 'csrf' });
    let body = '';
    for await (const chunk of req) body += chunk;
    Object.assign(businesses, JSON.parse(body));
    return json(200, businesses);
  }
  if (url.pathname === `/merchant/businesses/${BUSINESS_ID}/whatsapp`) {
    if (!failedWhatsAppOnce) {
      failedWhatsAppOnce = true;
      return json(503, { error: 'temporary fixture outage' });
    }
    return json(200, { status: 'pending' });
  }

  const assistantMatch = url.pathname.match(
    /^\/merchant\/businesses\/([0-9a-f-]+)\/assistant\/(configuration|playground)$/i,
  );
  if (assistantMatch) {
    const [, businessId, action] = assistantMatch;
    if (!hasSession || !created) return json(401, { message: 'Unauthorized' });
    if (
      businessId !== BUSINESS_ID &&
      !(businessId === SECOND_BUSINESS_ID && multipleBusinesses)
    )
      return json(404, { message: 'Not found.' });
    if (!['owner', 'editor'].includes(fixtureRole))
      return json(403, { message: 'Forbidden' });
    if (req.method === 'GET' && action === 'configuration')
      return json(
        200,
        businessId === BUSINESS_ID
          ? assistantConfig
          : { ...assistantConfig, businessId: SECOND_BUSINESS_ID, revision: 0 },
      );
    if (
      req.method !== 'GET' &&
      (!validCsrf || !['owner', 'editor'].includes(fixtureRole))
    )
      return json(403, { message: 'Forbidden' });
    let rawBody = '';
    for await (const chunk of req) rawBody += chunk;
    const input = JSON.parse(rawBody || '{}');
    if (req.method === 'PATCH' && action === 'configuration') {
      if (input.revision !== assistantConfig.revision)
        return json(409, {
          message: 'Assistant settings changed. Refresh and try again.',
        });
      assistantConfig = {
        ...assistantConfig,
        ...input,
        revision: assistantConfig.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      return json(200, assistantConfig);
    }
    if (req.method === 'POST' && action === 'playground') {
      assistantPlaygroundRequests += 1;
      if (input.message.toLowerCase().includes('discount'))
        return json(200, {
          reply: assistantConfig.fallbackResponse,
          outcome: 'INSUFFICIENT_EVIDENCE',
          sources: [],
          tokenUsage: { input: 0, output: 0, kind: 'ACTUAL' },
          durationMs: 7,
          handoffRecommended: true,
        });
      const asksPrice = /how much|price|cost/i.test(input.message);
      const publishedProduct = asksPrice
        ? products.find((item) => item.status === 'PUBLISHED')
        : null;
      const publishedFaq = publishedProduct
        ? null
        : faqs.find((faq) => faq.status === 'PUBLISHED');
      const productPrice = publishedProduct
        ? Number(publishedProduct.price).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : null;
      const sources = publishedProduct
        ? [
            {
              id: publishedProduct.id,
              revisionId: `revision-${publishedProduct.revision}`,
              type: 'PRODUCT',
              title: publishedProduct.name,
              excerpt: `${publishedProduct.description} Price: ${publishedProduct.currency} ${productPrice}.`,
            },
          ]
        : publishedFaq
          ? [
              {
                id: publishedFaq.id,
                revisionId: `revision-${publishedFaq.revision}`,
                type: 'FAQ',
                title: publishedFaq.question,
                excerpt: publishedFaq.answer,
              },
            ]
          : [];
      const pidginDelivery =
        assistantConfig.language === 'NIGERIAN_PIDGIN' &&
        publishedFaq?.answer.toLowerCase().includes('ikeja');
      const reply = publishedProduct
        ? `${publishedProduct.name} costs ${publishedProduct.currency} ${productPrice}.`
        : pidginDelivery
          ? 'Yes o, we dey deliver reach Ikeja within one business day.'
          : (publishedFaq?.answer ?? assistantConfig.fallbackResponse);
      return json(200, {
        reply,
        outcome:
          publishedProduct || publishedFaq
            ? 'ANSWERED'
            : 'INSUFFICIENT_EVIDENCE',
        sources,
        tokenUsage: { input: 75, output: 12, kind: 'ACTUAL' },
        durationMs: 21,
        handoffRecommended: !publishedProduct && !publishedFaq,
      });
    }
    return json(404, { message: 'Not found.' });
  }

  const faqMatch = url.pathname.match(
    /^\/merchant\/businesses\/([0-9a-f-]+)\/faqs(?:\/([0-9a-f-]+)(?:\/(publish|unpublish))?)?$/i,
  );
  if (faqMatch) {
    const [, businessId, faqId, action] = faqMatch;
    if (!hasSession || !created) return json(401, { message: 'Unauthorized' });
    if (
      businessId !== BUSINESS_ID &&
      !(businessId === SECOND_BUSINESS_ID && multipleBusinesses)
    )
      return json(404, { message: 'Not found.' });
    if (!['owner', 'editor'].includes(fixtureRole))
      return json(403, { message: 'Forbidden' });
    if (scenario === 'faq-failure' && req.method === 'GET' && !faqId)
      return json(503, { message: 'Temporary outage' });
    if (req.method === 'GET' && !faqId)
      return json(200, businessId === BUSINESS_ID ? faqs : []);
    const found =
      businessId === BUSINESS_ID ? faqs.find((faq) => faq.id === faqId) : null;
    if (req.method === 'GET' && faqId)
      return found ? json(200, found) : json(404, { message: 'Not found.' });
    if (
      req.method !== 'GET' &&
      (!validCsrf || !['owner', 'editor'].includes(fixtureRole))
    )
      return json(403, { message: 'Forbidden' });
    if (req.method === 'POST' && !faqId) {
      faqCreateRequests += 1;
      let body = '';
      for await (const chunk of req) body += chunk;
      const { question, answer } = JSON.parse(body);
      const key = req.headers['idempotency-key'];
      if (!key || !question?.trim() || !answer?.trim())
        return json(400, { message: 'Question and answer required.' });
      const fingerprint = `${question.trim()}\0${answer.trim()}`;
      if (faqKeys.has(key)) {
        const prior = faqKeys.get(key);
        if (prior.fingerprint !== fingerprint)
          return json(409, {
            statusCode: 409,
            message: 'Idempotency conflict.',
          });
        return json(
          201,
          faqs.find((faq) => faq.id === prior.id),
        );
      }
      const faq = {
        id:
          faqCreateRequests === 1
            ? FIRST_FAQ_ID
            : `ffffffff-ffff-4fff-8fff-${String(faqCreateRequests).padStart(12, '0')}`,
        status: 'DRAFT',
        revision: 1,
        published_revision: null,
        has_unpublished_changes: false,
        question: question.trim(),
        answer: answer.trim(),
        published_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      faqs.unshift(faq);
      faqKeys.set(key, { fingerprint, id: faq.id });
      return json(201, faq);
    }
    if (req.method === 'PATCH' && faqId) {
      if (!found) return json(404, { message: 'Not found.' });
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      if (!input.question?.trim() || !input.answer?.trim())
        return json(400, { message: 'Question and answer required.' });
      if (input.expectedRevision !== found.revision)
        return json(409, {
          statusCode: 409,
          message: 'FAQ revision conflict.',
        });
      found.revision += 1;
      found.question = input.question.trim();
      found.answer = input.answer.trim();
      found.updated_at = new Date().toISOString();
      found.has_unpublished_changes =
        found.published_revision !== null &&
        found.published_revision !== found.revision;
      return json(200, found);
    }
    if (req.method === 'POST' && faqId && action && found) {
      if (action === 'publish') {
        if (found.published_revision !== found.revision) {
          found.published_revision = found.revision;
          found.published_at = new Date().toISOString();
          found.updated_at = found.published_at;
        }
        found.status = 'PUBLISHED';
        found.has_unpublished_changes = false;
      } else {
        found.status = 'DRAFT';
        found.published_revision = null;
        found.has_unpublished_changes = false;
        found.updated_at = new Date().toISOString();
      }
      return json(201, found);
    }
    if (faqId && action && !found) return json(404, { message: 'Not found.' });
  }

  const policyMatch = url.pathname.match(
    /^\/merchant\/businesses\/([0-9a-f-]+)\/sales-policy$/i,
  );
  if (policyMatch) {
    const [, businessId] = policyMatch;
    if (!hasSession || !created) return json(401, { message: 'Unauthorized' });
    if (
      businessId !== BUSINESS_ID &&
      !(businessId === SECOND_BUSINESS_ID && multipleBusinesses)
    )
      return json(404, { message: 'Not found.' });
    if (!['owner', 'editor'].includes(fixtureRole))
      return json(403, { message: 'Forbidden' });
    if (req.method === 'GET')
      return json(200, {
        policy: salesPolicy,
        history: [{ ...salesPolicy, created_at: salesPolicy.updated_at }],
        templates: {
          retail: salesPolicy.fields,
          service: [
            {
              id: 'service_required',
              label: 'Service required',
              type: 'TEXT',
              required: true,
              validation: { maxLength: 240 },
              order: 10,
              purpose: 'Service the customer requested.',
              consentRequired: false,
            },
            {
              id: 'preferred_date',
              label: 'Preferred appointment date',
              type: 'DATE',
              required: false,
              validation: {},
              order: 20,
              purpose: 'A preferred date is not a booking confirmation.',
              consentRequired: false,
            },
          ],
        },
      });
    if (req.method === 'PATCH') {
      if (!validCsrf) return json(403, { message: 'Forbidden' });
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      if (input.expectedVersion !== salesPolicy.version)
        return json(409, { message: 'Policy changed.' });
      salesPolicy = {
        version: salesPolicy.version + 1,
        fields: input.fields,
        changed_by: 'fixture-owner',
        updated_at: new Date().toISOString(),
      };
      return json(200, salesPolicy);
    }
  }
  const leadMatch = url.pathname.match(
    /^\/merchant\/businesses\/([0-9a-f-]+)\/leads(?:\/([0-9a-f-]+)(?:\/(qualification|convert))?)?$/i,
  );
  if (leadMatch) {
    const [, businessId, leadId, action] = leadMatch;
    if (!hasSession || !created) return json(401, { message: 'Unauthorized' });
    if (
      businessId !== BUSINESS_ID &&
      !(businessId === SECOND_BUSINESS_ID && multipleBusinesses)
    )
      return json(404, { message: 'Not found.' });
    if (!['owner', 'agent', 'editor'].includes(fixtureRole))
      return json(403, { message: 'Forbidden' });
    if (req.method === 'GET' && !leadId) {
      const items = businessId === BUSINESS_ID ? leads : [];
      const cursor = url.searchParams.get('cursor');
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const status = url.searchParams.get('status');
      const filtered = status
        ? items.filter((item) => item.status === status)
        : items;
      return json(200, {
        items: cursor ? [] : filtered.slice(0, limit),
        nextCursor: null,
      });
    }
    const found =
      businessId === BUSINESS_ID
        ? leads.find((item) => item.id === leadId)
        : null;
    if (req.method === 'GET' && action === 'qualification' && leadId) {
      const history = leadQualifications.get(leadId) ?? [];
      return json(200, {
        record: history.at(-1) ?? null,
        history,
        conversions: leadConversions.get(leadId) ?? [],
      });
    }
    if (req.method === 'PATCH' && action === 'qualification' && leadId) {
      if (!validCsrf) return json(403, { message: 'Forbidden' });
      if (!found) return json(404, { message: 'Not found.' });
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      if (
        input.policyVersion !== salesPolicy.version ||
        input.expectedLeadVersion !== found.version
      )
        return json(409, { message: 'Lead or policy changed.' });
      const missing = salesPolicy.fields.find(
        (field) =>
          field.required &&
          (input.fieldValues[field.id] === undefined ||
            input.fieldValues[field.id] === null ||
            input.fieldValues[field.id] === ''),
      );
      if (input.markQualified && missing)
        return json(400, {
          message: `${missing.label} is required before qualifying this lead.`,
        });
      if (
        input.markQualified &&
        found.status !== 'CONTACTED' &&
        found.status !== 'QUALIFIED'
      )
        return json(409, { message: 'Contact the lead before qualifying.' });
      found.version += 1;
      if (input.markQualified) found.status = 'QUALIFIED';
      found.updated_at = new Date().toISOString();
      const record = {
        id: `qualification-${found.version}`,
        lead_id: found.id,
        revision: (leadQualifications.get(leadId) ?? []).length + 1,
        policy_version: salesPolicy.version,
        field_values: input.fieldValues,
        consent_evidence: input.consentEvidence,
        qualification_status: input.markQualified ? 'QUALIFIED' : 'IN_PROGRESS',
        qualified_by: input.markQualified ? 'fixture-owner' : null,
        qualified_at: input.markQualified ? new Date().toISOString() : null,
        created_at: new Date().toISOString(),
      };
      leadQualifications.set(leadId, [
        ...(leadQualifications.get(leadId) ?? []),
        record,
      ]);
      return json(200, {
        ...record,
        lead_status: found.status,
        lead_version: found.version,
      });
    }
    if (req.method === 'POST' && action === 'convert' && leadId) {
      if (!validCsrf) return json(403, { message: 'Forbidden' });
      if (!found) return json(404, { message: 'Not found.' });
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      const conversions = leadConversions.get(leadId) ?? [];
      const prior = conversions.find(
        (entry) => entry.idempotency_key === req.headers['idempotency-key'],
      );
      if (prior)
        return json(201, {
          lead_id: leadId,
          outcome: prior.outcome,
          lead_version: found.version,
          conversion_id: prior.id,
          created_at: prior.created_at,
          changed: false,
        });
      if (
        conversions.length ||
        found.status === 'WON' ||
        found.status === 'LOST'
      )
        return json(409, { message: 'Already converted.' });
      if (
        input.expectedLeadVersion !== found.version ||
        (input.outcome === 'WON' && found.status !== 'QUALIFIED')
      )
        return json(409, { message: 'Lead changed or is not eligible.' });
      found.status = input.outcome;
      found.version += 1;
      found.updated_at = new Date().toISOString();
      const event = {
        id: `conversion-${found.version}`,
        idempotency_key: req.headers['idempotency-key'],
        outcome: input.outcome,
        reference: input.details.reference ?? null,
        conversion_value: input.details.value ?? null,
        currency: input.details.currency ?? null,
        conversion_date:
          input.outcome === 'WON'
            ? new Date().toISOString().slice(0, 10)
            : null,
        loss_reason: input.details.lossReason ?? null,
        converted_by: 'fixture-owner',
        created_at: new Date().toISOString(),
      };
      leadConversions.set(leadId, [...conversions, event]);
      return json(201, {
        lead_id: leadId,
        outcome: input.outcome,
        lead_version: found.version,
        conversion_id: event.id,
        created_at: event.created_at,
        changed: true,
      });
    }
    if (req.method === 'GET' && leadId)
      return found ? json(200, found) : json(404, { message: 'Not found.' });
    if (req.method === 'PATCH' && leadId) {
      if (!validCsrf) return json(403, { message: 'Forbidden' });
      if (!found) return json(404, { message: 'Not found.' });
      let body = '';
      for await (const chunk of req) body += chunk;
      const update = JSON.parse(body);
      if (!['NEW', 'CONTACTED'].includes(update.status))
        return json(400, { message: 'Invalid lead status.' });
      if (
        found.status !== update.status &&
        found.version !== update.expectedVersion
      )
        return json(409, { message: 'Lead changed.' });
      const changed = found.status !== update.status;
      if (changed) {
        found.status = update.status;
        found.version += 1;
        found.updated_at = new Date().toISOString();
      }
      return json(200, {
        leadId: found.id,
        status: found.status,
        version: found.version,
        updatedAt: found.updated_at,
        changed,
      });
    }
  }

  const productMatch = url.pathname.match(
    /^\/merchant\/businesses\/([0-9a-f-]+)\/products(?:\/([0-9a-f-]+)(?:\/(publish|unpublish))?)?$/i,
  );
  if (productMatch) {
    const [, businessId, productId, action] = productMatch;
    if (!hasSession || !created) return json(401, { message: 'Unauthorized' });
    if (
      businessId !== BUSINESS_ID &&
      !(businessId === SECOND_BUSINESS_ID && multipleBusinesses)
    )
      return json(404, { message: 'Not found.' });
    if (!['owner', 'editor'].includes(fixtureRole))
      return json(403, { message: 'Forbidden' });
    if (scenario === 'product-failure' && req.method === 'GET' && !productId)
      return json(503, { message: 'Temporary outage' });
    if (req.method === 'GET' && !productId) {
      const items = businessId === BUSINESS_ID ? products : [];
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return json(200, {
        items: items.slice(offset, offset + limit),
        limit,
        offset,
        hasMore: offset + limit < items.length,
      });
    }
    const found =
      businessId === BUSINESS_ID
        ? products.find((item) => item.id === productId)
        : null;
    if (req.method === 'GET' && productId)
      return found ? json(200, found) : json(404, { message: 'Not found.' });
    if (
      req.method !== 'GET' &&
      (!validCsrf || !['owner', 'editor'].includes(fixtureRole))
    )
      return json(403, { message: 'Forbidden' });
    if (req.method === 'POST' && !productId) {
      productCreateRequests += 1;
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      const key = req.headers['idempotency-key'];
      if (!key || !input.name?.trim())
        return json(400, { message: 'Product name required.' });
      const fingerprint = JSON.stringify(input);
      if (productKeys.has(key)) {
        const prior = productKeys.get(key);
        if (prior.fingerprint !== fingerprint)
          return json(409, { message: 'Idempotency conflict.' });
        return json(
          201,
          products.find((item) => item.id === prior.id),
        );
      }
      const product = {
        id:
          productCreateRequests === 1
            ? FIRST_PRODUCT_ID
            : `eeeeeeee-eeee-4eee-8eee-${String(productCreateRequests).padStart(12, '0')}`,
        status: 'DRAFT',
        revision: 1,
        published_revision: null,
        has_unpublished_changes: false,
        ...input,
        published_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      products.unshift(product);
      productKeys.set(key, { fingerprint, id: product.id });
      return json(201, product);
    }
    if (req.method === 'PATCH' && productId) {
      if (!found) return json(404, { message: 'Not found.' });
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      if (input.expectedRevision !== found.revision)
        return json(409, { message: 'Product revision conflict.' });
      found.revision += 1;
      Object.assign(found, {
        name: input.name,
        description: input.description,
        sku: input.sku,
        price: input.price,
        currency: input.currency,
        availability: input.availability,
        updated_at: new Date().toISOString(),
        has_unpublished_changes:
          found.published_revision !== null &&
          found.published_revision !== found.revision,
      });
      return json(200, found);
    }
    if (req.method === 'POST' && productId && action && found) {
      if (action === 'publish') {
        found.published_revision = found.revision;
        found.published_at = new Date().toISOString();
        found.status = 'PUBLISHED';
        found.has_unpublished_changes = false;
      } else {
        found.status = 'DRAFT';
        found.published_revision = null;
        found.has_unpublished_changes = false;
      }
      found.updated_at = new Date().toISOString();
      return json(201, found);
    }
    if (productId && action && !found)
      return json(404, { message: 'Not found.' });
  }

  const inboxMatch = url.pathname.match(
    /^\/merchant\/businesses\/([0-9a-f-]+)\/conversations(?:\/([0-9a-f-]+|members))?(?:\/(messages|takeover|release|replies|read|assignee|notes|status))?$/i,
  );
  if (inboxMatch) {
    const [, businessId, conversationId, resource] = inboxMatch;
    if (!hasSession || !created) return json(401, { message: 'Unauthorized' });
    if (
      businessId !== BUSINESS_ID &&
      !(businessId === SECOND_BUSINESS_ID && multipleBusinesses)
    )
      return json(404, { message: 'Not found.' });
    if (req.method === 'GET' && conversationId === 'members' && !resource)
      return json(200, [{ account_id: 'fixture-account', role: 'owner' }]);
    if (req.method === 'GET' && !conversationId) {
      let items = listItems(businessId);
      const requestedStatus = url.searchParams.get('status') ?? 'all';
      const search = (url.searchParams.get('search') ?? '')
        .trim()
        .toLowerCase();
      if (requestedStatus === 'open')
        items = items.filter(
          (item) =>
            !['closed', 'resolved'].includes(String(item.status).toLowerCase()),
        );
      if (requestedStatus === 'closed')
        items = items.filter((item) =>
          ['closed', 'resolved'].includes(String(item.status).toLowerCase()),
        );
      if (search)
        items = items.filter((item) =>
          `${item.customer_name} ${item.customer_whatsapp_id} ${item.preview ?? ''}`
            .toLowerCase()
            .includes(search),
        );
      const pageSize = Number(url.searchParams.get('limit') ?? 30);
      const cursor = url.searchParams.get('cursor');
      return json(200, {
        items: cursor ? [] : items.slice(0, pageSize),
        nextCursor:
          !cursor && items.length > pageSize ? 'fixture-list-cursor' : null,
      });
    }
    if (req.method === 'GET' && conversationId && !resource) {
      const item = detail(conversationId, businessId);
      return item ? json(200, item) : json(404, { message: 'Not found.' });
    }
    if (req.method === 'GET' && conversationId && resource === 'messages') {
      if (!detail(conversationId, businessId))
        return json(404, { message: 'Not found.' });
      const pageSize = Number(url.searchParams.get('limit') ?? 30);
      let items;
      let nextCursor;
      if (url.searchParams.get('cursor') === 'fixture-older-cursor') {
        items = messages.slice(0, 1);
        nextCursor = null;
      } else {
        items = messages.slice(-pageSize);
        nextCursor = messages.length > pageSize ? 'fixture-older-cursor' : null;
      }
      if (replies.size)
        for (const reply of replies.values()) reply.status = 'DELIVERED';
      return json(200, { items, nextCursor });
    }
    if (req.method === 'GET' && conversationId && resource === 'notes') {
      if (!detail(conversationId, businessId))
        return json(404, { message: 'Not found.' });
      return json(200, internalNotes);
    }
    if (req.method === 'POST' && conversationId && resource && !validCsrf)
      return json(403, { message: 'Forbidden' });
    if (req.method === 'POST' && conversationId && resource === 'read') {
      if (!detail(conversationId, businessId))
        return json(404, { message: 'Not found.' });
      unreadCount = 0;
      return json(200, { last_read_at: new Date().toISOString() });
    }
    if (req.method === 'POST' && conversationId && resource === 'assignee') {
      if (!detail(conversationId, businessId))
        return json(404, { message: 'Not found.' });
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      assignedAccountId = input.accountId ?? null;
      return json(200, {
        assigned_to_account_id: assignedAccountId,
        changed: true,
      });
    }
    if (req.method === 'POST' && conversationId && resource === 'notes') {
      if (!detail(conversationId, businessId))
        return json(404, { message: 'Not found.' });
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      const note = {
        id: `note-${internalNotes.length + 1}`,
        body: input.text,
        actor_account_id: 'fixture-account',
        created_at: new Date().toISOString(),
      };
      internalNotes = [...internalNotes, note];
      return json(201, note);
    }
    if (req.method === 'POST' && conversationId && resource === 'status') {
      if (!detail(conversationId, businessId))
        return json(404, { message: 'Not found.' });
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      conversationStatus = input.status;
      if (conversationStatus === 'closed') mode = 'HUMAN';
      changedAt = new Date().toISOString();
      return json(200, { status: conversationStatus, updated_at: changedAt });
    }
    if (req.method === 'POST' && conversationId && resource === 'takeover') {
      if (!detail(conversationId, businessId))
        return json(404, { message: 'Not found.' });
      mode = 'HUMAN';
      changedAt = new Date().toISOString();
      return json(200, {
        conversationId,
        mode,
        controlVersion: 3,
        changedAt,
        changed: true,
      });
    }
    if (req.method === 'POST' && conversationId && resource === 'release') {
      if (!detail(conversationId, businessId))
        return json(404, { message: 'Not found.' });
      mode = 'AUTO';
      changedAt = new Date().toISOString();
      return json(200, {
        conversationId,
        mode,
        controlVersion: 4,
        changedAt,
        changed: true,
      });
    }
    if (req.method === 'POST' && conversationId && resource === 'replies') {
      repliesRequests += 1;
      if (!detail(conversationId, businessId))
        return json(404, { message: 'Not found.' });
      if (mode !== 'HUMAN')
        return json(400, {
          statusCode: 400,
          message: 'Take over this conversation before replying.',
        });
      if (scenario === 'quota')
        return json(429, {
          statusCode: 429,
          message: 'WhatsApp message allowance exceeded.',
        });
      if (scenario === 'disconnected')
        return json(400, {
          statusCode: 400,
          message: 'Verified WhatsApp connection is unavailable.',
        });
      if (scenario === 'window')
        return json(400, {
          statusCode: 400,
          message:
            'Free-form WhatsApp messages require an open customer-service window.',
        });
      let body = '';
      for await (const chunk of req) body += chunk;
      const { text } = JSON.parse(body);
      const key = req.headers['idempotency-key'];
      if (!key || typeof text !== 'string' || !text.trim())
        return json(400, { message: 'Reply text required.' });
      if (replies.has(key)) {
        const prior = replies.get(key);
        if (prior.content !== text.trim())
          return json(409, {
            statusCode: 409,
            message: 'Idempotency conflict.',
          });
        return json(200, { outboundMessageId: prior.id, status: 'QUEUED' });
      }
      const sent = {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        direction: 'outbound',
        content: text.trim(),
        status: 'QUEUED',
        provider_message_id: null,
        created_at: new Date().toISOString(),
        authorization_kind: 'HUMAN',
        error_classification: null,
      };
      replies.set(key, sent);
      messages.push(sent);
      return json(200, { outboundMessageId: sent.id, status: 'QUEUED' });
    }
  }
  return json(404, { message: 'Not found.' });
});

server.listen(Number(process.env.PORT ?? 3100), '127.0.0.1');
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
