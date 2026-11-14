import { createServer } from 'node:http';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_BUSINESS_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECOND_CONVERSATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_TENANT_CONVERSATION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEFAULT_BUSINESS = { id: BUSINESS_ID, name: 'The Good Store', industry: 'Retail', phone: '+2348012345678', timezone: 'Africa/Lagos', description: null, openingHours: null, status: 'active', role: 'owner' };
const SECOND_BUSINESS = { id: SECOND_BUSINESS_ID, name: 'Second Workspace', industry: 'Services', phone: '+2348011111111', timezone: 'Africa/Lagos', description: null, openingHours: null, status: 'active', role: 'owner' };

let created = false;
let failedWhatsAppOnce = false;
let multipleBusinesses = false;
let emptyInbox = false;
let scenario = '';
let expireSession = false;
let businesses = structuredClone(DEFAULT_BUSINESS);
let mode = 'AUTO';
let changedAt = new Date().toISOString();
let messages = [];
let replies = new Map();
let repliesRequests = 0;
let controlInFlight = 0;

function reset(search = new URLSearchParams()) {
  created = false;
  failedWhatsAppOnce = false;
  multipleBusinesses = search.get('multiple') === '1';
  emptyInbox = search.get('empty') === '1';
  scenario = search.get('scenario') ?? '';
  expireSession = false;
  businesses = structuredClone(DEFAULT_BUSINESS);
  mode = 'AUTO';
  changedAt = new Date().toISOString();
  replies = new Map();
  repliesRequests = 0;
  controlInFlight = 0;
  const now = Date.now();
  messages = Array.from({ length: 31 }, (_, index) => {
    const inbound = index % 2 === 0;
    const last = index === 30;
    return {
      id: `dddddddd-dddd-4ddd-8ddd-${String(index + 1).padStart(12, '0')}`,
      direction: inbound ? 'inbound' : 'outbound',
      content: `Fixture ${inbound ? 'customer' : 'merchant'} message ${String(index + 1).padStart(2, '0')}`,
      status: inbound ? 'received' : last ? 'delivered' : index === 29 ? 'UNCERTAIN' : 'DELIVERED',
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
  return [{ businessId: BUSINESS_ID, role: 'owner' }, ...(multipleBusinesses ? [{ businessId: SECOND_BUSINESS_ID, role: 'owner' }] : [])];
}

function listItems(businessId) {
  if (!created || emptyInbox || businessId === SECOND_BUSINESS_ID) return [];
  const first = messages.at(-1);
  return [
    { id: CONVERSATION_ID, customer_name: 'Amina Yusuf', customer_whatsapp_id: '+234 803 555 0101', last_activity: first?.created_at ?? changedAt, preview: first?.content ?? null, status: 'open', control_mode: mode, control_version: 2, in_flight: String(controlInFlight) },
    { id: SECOND_CONVERSATION_ID, customer_name: 'Olu Bello', customer_whatsapp_id: '+234 802 555 0102', last_activity: new Date(Date.now() - 3_600_000).toISOString(), preview: 'Do you have this in blue?', status: 'open', control_mode: 'AUTO', control_version: 1, in_flight: '0' },
  ];
}

function detail(conversationId, businessId) {
  if (!created || businessId === SECOND_BUSINESS_ID || conversationId !== CONVERSATION_ID) return null;
  return { ...listItems(businessId)[0], control_changed_at: changedAt };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const hasSession = req.headers.cookie?.includes('kleva_session=fixture') && !expireSession;
  const validCsrf = req.headers['x-csrf-token'] === 'fixture-csrf' && req.headers.origin === 'http://localhost:3101';

  if (url.pathname === '/health') return json(200, { ok: true });
  if (url.pathname === '/test/reset') { reset(url.searchParams); return json(200, { ok: true }); }
  if (url.pathname === '/test/expire') { expireSession = true; return json(200, { ok: true }); }
  if (url.pathname === '/test/replies') return json(200, { count: repliesRequests });
  if (url.pathname === '/auth/login') { res.writeHead(302, { Location: 'http://localhost:3101/auth/callback?code=fixture&state=fixture', 'Set-Cookie': 'kleva_oidc_binding=fixture; Path=/; HttpOnly; SameSite=Lax' }); return res.end(); }
  if (url.pathname === '/auth/callback') { res.writeHead(302, { Location: '/auth/me', 'Set-Cookie': ['kleva_session=fixture; Path=/; HttpOnly; SameSite=Lax', 'kleva_csrf=fixture-csrf; Path=/; SameSite=Lax'] }); return res.end(); }
  if (url.pathname === '/auth/me') return json(hasSession ? 200 : 401, { accountId: 'fixture-account', memberships: membershipList() });
  if (url.pathname === '/auth/logout' && req.method === 'POST') {
    if (!validCsrf || !hasSession) return json(403, { error: 'csrf' });
    res.writeHead(204, { 'Set-Cookie': ['kleva_session=; Path=/; Max-Age=0', 'kleva_csrf=; Path=/; Max-Age=0'] }); return res.end();
  }
  if (url.pathname === '/merchant/businesses' && req.method === 'POST') {
    if (!validCsrf || !hasSession) return json(403, { error: 'csrf' });
    if (!req.headers['idempotency-key']) return json(400, { error: 'key required' });
    let body = ''; for await (const chunk of req) body += chunk;
    Object.assign(businesses, JSON.parse(body)); created = true; return json(201, businesses);
  }
  const businessMatch = url.pathname.match(/^\/merchant\/businesses\/([0-9a-f-]+)$/i);
  if (businessMatch?.[1] && req.method === 'GET') {
    if (businessMatch[1] === BUSINESS_ID && hasSession && created) return json(200, businesses);
    if (businessMatch[1] === SECOND_BUSINESS_ID && hasSession && created && multipleBusinesses) return json(200, SECOND_BUSINESS);
    return json(404, { message: 'Not found.' });
  }
  if (url.pathname === `/merchant/businesses/${BUSINESS_ID}` && req.method === 'PATCH') {
    if (!validCsrf || !hasSession || !created) return json(403, { error: 'csrf' });
    let body = ''; for await (const chunk of req) body += chunk; Object.assign(businesses, JSON.parse(body)); return json(200, businesses);
  }
  if (url.pathname === `/merchant/businesses/${BUSINESS_ID}/whatsapp`) {
    if (!failedWhatsAppOnce) { failedWhatsAppOnce = true; return json(503, { error: 'temporary fixture outage' }); }
    return json(200, { status: 'pending' });
  }

  const inboxMatch = url.pathname.match(/^\/merchant\/businesses\/([0-9a-f-]+)\/conversations(?:\/([0-9a-f-]+))?(?:\/(messages|takeover|release|replies))?$/i);
  if (inboxMatch) {
    const [, businessId, conversationId, resource] = inboxMatch;
    if (!hasSession || !created) return json(401, { message: 'Unauthorized' });
    if (businessId !== BUSINESS_ID && !(businessId === SECOND_BUSINESS_ID && multipleBusinesses)) return json(404, { message: 'Not found.' });
    if (req.method === 'GET' && !conversationId) {
      const items = listItems(businessId);
      const pageSize = Number(url.searchParams.get('limit') ?? 30);
      const cursor = url.searchParams.get('cursor');
      return json(200, { items: cursor ? [] : items.slice(0, pageSize), nextCursor: !cursor && items.length > pageSize ? 'fixture-list-cursor' : null });
    }
    if (req.method === 'GET' && conversationId && !resource) {
      const item = detail(conversationId, businessId);
      return item ? json(200, item) : json(404, { message: 'Not found.' });
    }
    if (req.method === 'GET' && conversationId && resource === 'messages') {
      if (!detail(conversationId, businessId)) return json(404, { message: 'Not found.' });
      const pageSize = Number(url.searchParams.get('limit') ?? 30);
      let items;
      let nextCursor;
      if (url.searchParams.get('cursor') === 'fixture-older-cursor') { items = messages.slice(0, 1); nextCursor = null; }
      else { items = messages.slice(-pageSize); nextCursor = messages.length > pageSize ? 'fixture-older-cursor' : null; }
      if (replies.size) for (const reply of replies.values()) reply.status = 'DELIVERED';
      return json(200, { items, nextCursor });
    }
    if (req.method === 'POST' && conversationId && resource && !validCsrf) return json(403, { message: 'Forbidden' });
    if (req.method === 'POST' && conversationId && resource === 'takeover') {
      if (!detail(conversationId, businessId)) return json(404, { message: 'Not found.' });
      mode = 'HUMAN'; changedAt = new Date().toISOString();
      return json(200, { conversationId, mode, controlVersion: 3, changedAt, changed: true });
    }
    if (req.method === 'POST' && conversationId && resource === 'release') {
      if (!detail(conversationId, businessId)) return json(404, { message: 'Not found.' });
      mode = 'AUTO'; changedAt = new Date().toISOString();
      return json(200, { conversationId, mode, controlVersion: 4, changedAt, changed: true });
    }
    if (req.method === 'POST' && conversationId && resource === 'replies') {
      repliesRequests += 1;
      if (!detail(conversationId, businessId)) return json(404, { message: 'Not found.' });
      if (mode !== 'HUMAN') return json(400, { statusCode: 400, message: 'Take over this conversation before replying.' });
      if (scenario === 'quota') return json(429, { statusCode: 429, message: 'WhatsApp message allowance exceeded.' });
      if (scenario === 'disconnected') return json(400, { statusCode: 400, message: 'Verified WhatsApp connection is unavailable.' });
      if (scenario === 'window') return json(400, { statusCode: 400, message: 'Free-form WhatsApp messages require an open customer-service window.' });
      let body = ''; for await (const chunk of req) body += chunk;
      const { text } = JSON.parse(body);
      const key = req.headers['idempotency-key'];
      if (!key || typeof text !== 'string' || !text.trim()) return json(400, { message: 'Reply text required.' });
      if (replies.has(key)) {
        const prior = replies.get(key);
        if (prior.content !== text.trim()) return json(409, { statusCode: 409, message: 'Idempotency conflict.' });
        return json(200, { outboundMessageId: prior.id, status: 'QUEUED' });
      }
      const sent = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', direction: 'outbound', content: text.trim(), status: 'QUEUED', provider_message_id: null, created_at: new Date().toISOString(), authorization_kind: 'HUMAN', error_classification: null };
      replies.set(key, sent); messages.push(sent);
      return json(200, { outboundMessageId: sent.id, status: 'QUEUED' });
    }
  }
  return json(404, { message: 'Not found.' });
});

server.listen(Number(process.env.PORT ?? 3100), '127.0.0.1');
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
