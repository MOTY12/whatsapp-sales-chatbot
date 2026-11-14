import { createServer } from 'node:http';

let created = false;
let failedWhatsAppOnce = false;
const business = { id: 'biz-fixture-1234', name: 'The Good Store', industry: 'Retail', phone: '+2348012345678', timezone: 'Africa/Lagos', description: null, openingHours: null, status: 'active', role: 'owner' };
const defaultBusiness = structuredClone(business);
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  if (url.pathname === '/health') return json(200, { ok: true });
  if (url.pathname === '/test/reset') { created = false; failedWhatsAppOnce = false; Object.assign(business, defaultBusiness); return json(200, { ok: true }); }
  if (url.pathname === '/auth/login') { res.writeHead(302, { Location: 'http://localhost:3101/auth/callback?code=fixture&state=fixture', 'Set-Cookie': 'kleva_oidc_binding=fixture; Path=/; HttpOnly; SameSite=Lax' }); return res.end(); }
  if (url.pathname === '/auth/callback') { res.writeHead(302, { Location: '/auth/me', 'Set-Cookie': ['kleva_session=fixture; Path=/; HttpOnly; SameSite=Lax', 'kleva_csrf=fixture-csrf; Path=/; SameSite=Lax'] }); return res.end(); }
  if (url.pathname === '/auth/me') return json(req.headers.cookie?.includes('kleva_session=fixture') ? 200 : 401, created ? { accountId: 'fixture-account', memberships: [{ businessId: business.id, role: 'owner' }] } : { accountId: 'fixture-account', memberships: [] });
  if (url.pathname === '/auth/logout' && req.method === 'POST') { if (req.headers['x-csrf-token'] !== 'fixture-csrf' || req.headers.origin !== 'http://localhost:3101') return json(403, { error: 'csrf' }); res.writeHead(204, { 'Set-Cookie': ['kleva_session=; Path=/; Max-Age=0', 'kleva_csrf=; Path=/; Max-Age=0'] }); return res.end(); }
  if (url.pathname === '/merchant/businesses' && req.method === 'POST') {
    if (req.headers['x-csrf-token'] !== 'fixture-csrf' || req.headers.origin !== 'http://localhost:3101') return json(403, { error: 'csrf' });
    if (!req.headers['idempotency-key']) return json(400, { error: 'key required' });
    let body = ''; for await (const chunk of req) body += chunk;
    Object.assign(business, JSON.parse(body)); created = true; return json(201, business);
  }
  if (url.pathname === `/merchant/businesses/${business.id}` && req.method === 'GET') return json(req.headers.cookie?.includes('kleva_session=fixture') && created ? 200 : 404, business);
  if (url.pathname === `/merchant/businesses/${business.id}` && req.method === 'PATCH') {
    if (req.headers['x-csrf-token'] !== 'fixture-csrf' || req.headers.origin !== 'http://localhost:3101') return json(403, { error: 'csrf' });
    let body = ''; for await (const chunk of req) body += chunk; Object.assign(business, JSON.parse(body)); return json(200, business);
  }
  if (url.pathname === `/merchant/businesses/${business.id}/whatsapp`) {
    if (!failedWhatsAppOnce) { failedWhatsAppOnce = true; return json(503, { error: 'temporary fixture outage' }); }
    return json(200, { status: 'pending' });
  }
  return json(404, { error: 'not found' });
});
server.listen(Number(process.env.PORT ?? 3100), '127.0.0.1');
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
