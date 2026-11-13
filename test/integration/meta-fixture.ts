import { createServer } from 'node:http';

export async function startMetaFixture() {
  const sent: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const token = request.headers.authorization?.slice(7);
    let body: object = {};
    let status = 200;
    if (url.pathname.endsWith('/debug_token')) {
      const input = url.searchParams.get('input_token');
      body = {
        data: {
          app_id: '123',
          is_valid:
            token === '123|fixture-app-secret' && input !== 'invalid-token',
          expires_at: 0,
          scopes: [
            'whatsapp_business_management',
            'whatsapp_business_messaging',
          ],
        },
      };
    } else if (url.pathname.endsWith('/456/phone_numbers')) {
      body = { data: [{ id: '789', verified_name: 'Fixture shop' }] };
    } else if (url.pathname.endsWith('/456/subscribed_apps')) {
      body = { data: [{ whatsapp_business_api_data: { id: '123' } }] };
    } else if (url.pathname.endsWith('/789/messages')) {
      sent.push(token ?? '');
      body =
        token === 'revoked-token'
          ? { error: { code: 190 } }
          : { messages: [{ id: 'wamid.fixture' }] };
      status = token === 'revoked-token' ? 401 : 200;
    } else {
      status = 404;
    }
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected Meta fixture address.');
  return {
    origin: 'http://127.0.0.1:' + String(address.port),
    sent,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
