import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

export const clientId = 'kleva-fixture-client';
export const clientSecret = 'fixture-oidc-secret';

type Fault = 'nonce' | 'issuer' | 'audience' | 'expiry' | 'pkce' | 'signature';

export async function startIdentityProvider() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const key = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'fixture-key',
    alg: 'RS256',
    use: 'sig',
  };
  const requests = new Map<
    string,
    { authorization: URL; subject: string; fault?: Fault }
  >();
  let issuer = '';
  let code = 0;
  const json = (response: ServerResponse, body: object, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  };

  async function respond(request: IncomingMessage, response: ServerResponse) {
    switch (request.url) {
      case '/.well-known/openid-configuration':
        return json(response, {
          issuer,
          authorization_endpoint: issuer + '/authorize',
          token_endpoint: issuer + '/token',
          jwks_uri: issuer + '/jwks',
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
          code_challenge_methods_supported: ['S256'],
        });
      case '/jwks':
        return json(response, { keys: [key] });
      case '/token': {
        let raw = '';
        request.setEncoding('utf8');
        for await (const chunk of request) raw += String(chunk);
        const form = new URLSearchParams(raw);
        const requestCode = form.get('code') ?? '';
        const fixture = requests.get(requestCode);
        requests.delete(requestCode);
        const verifier = form.get('code_verifier') ?? '';
        const challenge = createHash('sha256')
          .update(verifier)
          .digest('base64url');
        if (
          !fixture ||
          fixture.fault === 'pkce' ||
          request.headers.authorization !==
            'Basic ' +
              Buffer.from(clientId + ':' + clientSecret).toString('base64') ||
          form.get('grant_type') !== 'authorization_code' ||
          form.get('redirect_uri') !==
            fixture.authorization.searchParams.get('redirect_uri') ||
          challenge !== fixture.authorization.searchParams.get('code_challenge')
        ) {
          return json(response, { error: 'invalid_grant' }, 400);
        }
        const now = Math.floor(Date.now() / 1000);
        const header = Buffer.from(
          JSON.stringify({ alg: 'RS256', kid: key.kid }),
        ).toString('base64url');
        const claims = Buffer.from(
          JSON.stringify({
            iss: fixture.fault === 'issuer' ? issuer + '/wrong' : issuer,
            sub: fixture.subject,
            aud: fixture.fault === 'audience' ? 'other-client' : clientId,
            nonce:
              fixture.fault === 'nonce'
                ? 'wrong-nonce'
                : fixture.authorization.searchParams.get('nonce'),
            iat: now - (fixture.fault === 'expiry' ? 1000 : 0),
            exp: fixture.fault === 'expiry' ? now - 500 : now + 300,
            email: 'owner@example.test',
            email_verified: false,
          }),
        ).toString('base64url');
        const content = header + '.' + claims;
        const signature = sign('RSA-SHA256', Buffer.from(content), privateKey);
        if (fixture.fault === 'signature') signature[0] ^= 1;
        return json(response, {
          token_type: 'Bearer',
          access_token: 'private-provider-token',
          refresh_token: 'private-provider-refresh-token',
          id_token: content + '.' + signature.toString('base64url'),
        });
      }
      default:
        return json(response, { error: 'not_found' }, 404);
    }
  }

  const server = createServer((request, response) => {
    void respond(request, response).catch(() =>
      json(response, { error: 'fixture_error' }, 500),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected TCP identity provider fixture.');
  issuer = `http://127.0.0.1:${address.port}`;

  return {
    issuer,
    authorize(authorization: URL, subject: string, fault?: Fault) {
      const value = 'fixture-code-' + String(++code);
      requests.set(value, { authorization, subject, fault });
      return value;
    },
    close() {
      server.closeAllConnections();
      return new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
