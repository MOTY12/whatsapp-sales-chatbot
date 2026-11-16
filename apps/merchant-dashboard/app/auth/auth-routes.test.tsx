import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as login } from './login/route';
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
      vi
        .fn()
        .mockResolvedValue(
          new Response('sensitive provider response', { status: 401 }),
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
  });
});
