import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as authPost } from '../api/auth/[...path]/route';
import { GET as login } from './login/route';
import { GET as signup } from './signup/route';
import { GET as callback } from './callback/route';

const dashboardOrigin = 'http://localhost:3001';
const providerUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?state=fixture';

function request(url: string, cookie?: string) {
  return new NextRequest(url, {
    headers: cookie ? { cookie } : undefined,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('merchant OIDC route bridge', () => {
  it('forwards login redirect and the browser binding cookie', async () => {
    vi.stubEnv('KLEVA_BACKEND_ORIGIN', 'http://localhost:3000');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          location: providerUrl,
          'set-cookie':
            'kleva_oidc_binding=binding-fixture; HttpOnly; Path=/; SameSite=Lax',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await login();

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(providerUrl);
    expect(response.headers.get('set-cookie')).toContain('kleva_oidc_binding=');
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('/auth/login', 'http://localhost:3000'),
      expect.objectContaining({ redirect: 'manual', cache: 'no-store' }),
    );
  });

  it('starts a distinct server-bound signup intent', async () => {
    vi.stubEnv('KLEVA_BACKEND_ORIGIN', 'http://localhost:3000');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          location: providerUrl,
          'set-cookie': 'kleva_oidc_binding=signup-binding; HttpOnly; Path=/',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await signup();

    expect(response.headers.get('location')).toBe(providerUrl);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('/auth/signup', 'http://localhost:3000'),
      expect.objectContaining({ redirect: 'manual', cache: 'no-store' }),
    );
  });

  it('forwards callback query, binding cookie, and backend session cookies', async () => {
    vi.stubEnv('KLEVA_BACKEND_ORIGIN', 'http://localhost:3000');
    const upstreamHeaders = new Headers({ location: '/auth/me' });
    upstreamHeaders.append(
      'set-cookie',
      'kleva_session=session-fixture; HttpOnly; Path=/; SameSite=Lax',
    );
    upstreamHeaders.append(
      'set-cookie',
      'kleva_csrf=csrf-fixture; Path=/; SameSite=Lax',
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: upstreamHeaders,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await callback(
      request(
        `${dashboardOrigin}/auth/callback?code=provider-code-fixture&state=state-fixture`,
        'kleva_oidc_binding=binding-fixture',
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      `${dashboardOrigin}/dashboard`,
    );
    expect(response.headers.get('set-cookie')).toContain(
      'kleva_session=session-fixture',
    );
    expect(response.headers.get('set-cookie')).toContain(
      'kleva_csrf=csrf-fixture',
    );
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.pathname).toBe('/auth/callback');
    expect(target.searchParams.get('code')).toBe('provider-code-fixture');
    expect(init.headers).toEqual({
      cookie: 'kleva_oidc_binding=binding-fixture',
    });
  });

  it('keeps provider callback errors generic and logs no callback values', async () => {
    vi.stubEnv('KLEVA_BACKEND_ORIGIN', 'http://localhost:3000');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('sensitive provider response', {
          status: 401,
          headers: { 'x-request-id': '5f6c674e-6e7a-4a1a-82cd-6f6c39bdb2df' },
        }),
      ),
    );
    const errorLog = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const response = await callback(
      request(
        `${dashboardOrigin}/auth/callback?code=secret-code-fixture&state=secret-state-fixture`,
      ),
    );

    expect(response.headers.get('location')).toBe(
      `${dashboardOrigin}/login?error=callback`,
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      'secret-code-fixture',
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      'secret-state-fixture',
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      'sensitive provider response',
    );
    expect(JSON.stringify(errorLog.mock.calls)).toContain(
      '5f6c674e-6e7a-4a1a-82cd-6f6c39bdb2df',
    );
    expect(JSON.stringify(errorLog.mock.calls)).toContain(
      'OIDC_CALLBACK_BRIDGE_FAILED',
    );
  });

  it('shows the specific registration-versus-login outcome safely', async () => {
    vi.stubEnv('KLEVA_BACKEND_ORIGIN', 'http://localhost:3000');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            code: 'merchant_account_not_found',
            message: 'No merchant account found. Please create an account.',
          },
          { status: 401 },
        ),
      ),
    );

    const response = await callback(
      request(`${dashboardOrigin}/auth/callback?code=fixture&state=fixture`),
    );

    expect(response.headers.get('location')).toBe(
      `${dashboardOrigin}/login?error=not_registered`,
    );
  });

  it('resumes registration after the backend authenticates a new merchant', async () => {
    vi.stubEnv('KLEVA_BACKEND_ORIGIN', 'http://localhost:3000');
    const upstreamHeaders = new Headers({ location: '/onboarding' });
    upstreamHeaders.append('set-cookie', 'kleva_session=session; Path=/');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 302, headers: upstreamHeaders }),
        ),
    );

    const response = await callback(
      request(`${dashboardOrigin}/auth/callback?code=fixture&state=fixture`),
    );

    expect(response.headers.get('location')).toBe(
      `${dashboardOrigin}/onboarding`,
    );
  });
});

describe('merchant email/password same-origin bridge', () => {
  it.each([
    {
      label: 'localhost HTTP',
      origin: 'http://localhost:3001',
      sessionCookie: 'kleva_session=session-fixture; Path=/; HttpOnly; SameSite=Lax',
      csrfCookie: 'kleva_csrf=csrf-fixture; Path=/; SameSite=Lax',
      cookieNames: ['kleva_session', 'kleva_csrf'],
    },
    {
      label: 'public HTTPS tunnel',
      origin: 'https://merchant-preview.ngrok-free.app',
      sessionCookie:
        '__Host-kleva_session=session-fixture; Path=/; HttpOnly; Secure; SameSite=Lax',
      csrfCookie:
        '__Host-kleva_csrf=csrf-fixture; Path=/; Secure; SameSite=Lax',
      cookieNames: ['__Host-kleva_session', '__Host-kleva_csrf'],
    },
  ])(
    'posts credentials and forwards secure session cookies for $label',
    async ({ origin, sessionCookie, csrfCookie, cookieNames }) => {
      vi.stubEnv('KLEVA_BACKEND_ORIGIN', 'http://localhost:3000');
      vi.stubEnv('DASHBOARD_PUBLIC_ORIGIN', origin);
      const upstreamHeaders = new Headers();
      upstreamHeaders.append('set-cookie', sessionCookie);
      upstreamHeaders.append('set-cookie', csrfCookie);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ nextPath: '/dashboard' }), {
            status: 200,
            headers: upstreamHeaders,
          }),
        )
        .mockResolvedValueOnce(Response.json({ message: 'Password updated.' }));
      vi.stubGlobal('fetch', fetchMock);

      const credentials = { email: 'merchant@example.test', password: 'secret password' };
      const loginResponse = await authPost(
        new NextRequest(`${origin}/api/auth/login/password`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify(credentials),
        }),
        { params: Promise.resolve({ path: ['login', 'password'] }) },
      );

      expect(loginResponse.status).toBe(200);
      expect(await loginResponse.json()).toEqual({ nextPath: '/dashboard' });
      expect(loginResponse.headers.getSetCookie()).toEqual([
        sessionCookie,
        csrfCookie,
      ]);
      const [loginUrl, loginInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
      expect(loginUrl.href).toBe(
        'http://localhost:3000/auth/login/password',
      );
      expect(loginUrl.search).toBe('');
      expect(loginInit.method).toBe('POST');
      expect(loginInit.body).toBe(JSON.stringify(credentials));
      expect(new Headers(loginInit.headers).get('origin')).toBe(origin);

      const sessionCookieHeader = cookieNames
        .map((name) => `${name}=${name.includes('session') ? 'session-fixture' : 'csrf-fixture'}`)
        .join('; ');
      const updateResponse = await authPost(
        new NextRequest(`${origin}/api/auth/password`, {
          method: 'POST',
          headers: {
            origin,
            cookie: sessionCookieHeader,
            'x-csrf-token': 'csrf-fixture',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ password: 'new secret password' }),
        }),
        { params: Promise.resolve({ path: ['password'] }) },
      );

      expect(updateResponse.status).toBe(200);
      const [updateUrl, updateInit] = fetchMock.mock.calls[1] as [URL, RequestInit];
      expect(updateUrl.pathname).toBe('/auth/password');
      expect(new Headers(updateInit.headers).get('cookie')).toBe(
        sessionCookieHeader,
      );
      expect(new Headers(updateInit.headers).get('x-csrf-token')).toBe(
        'csrf-fixture',
      );
      expect(new Headers(updateInit.headers).get('origin')).toBe(origin);
    },
  );

  it('rejects a browser origin that does not match the configured dashboard', async () => {
    vi.stubEnv('KLEVA_BACKEND_ORIGIN', 'http://localhost:3000');
    vi.stubEnv('DASHBOARD_PUBLIC_ORIGIN', 'https://merchant-preview.ngrok-free.app');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await authPost(
      new NextRequest('https://merchant-preview.ngrok-free.app/api/auth/login/password', {
        method: 'POST',
        headers: {
          origin: 'https://attacker.example.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email: 'merchant@example.test', password: 'secret' }),
      }),
      { params: Promise.resolve({ path: ['login', 'password'] }) },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
