import { NextResponse } from 'next/server';

export async function startAuth(
  intent: 'login' | 'signup' | 'link',
  cookieHeader?: string,
) {
  const frontendPath = intent === 'link' ? '/dashboard/settings' : `/${intent}`;
  const backendPath =
    intent === 'link' ? '/auth/google/link' : `/auth/${intent}`;
  const origin = process.env.KLEVA_BACKEND_ORIGIN;
  if (!origin) {
    console.error({
      event: 'merchant_auth.bridge_failure',
      category: 'OIDC_LOGIN_BRIDGE_FAILED',
      stage: `${intent}_backend_origin_missing`,
    });
    return NextResponse.redirect(
      new URL(
        `${frontendPath}?error=${intent === 'link' ? 'link' : 'configuration'}`,
        process.env.DASHBOARD_PUBLIC_ORIGIN ?? 'http://localhost:3001',
      ),
    );
  }
  try {
    const upstream = await fetch(new URL(backendPath, origin), {
      headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    const location = upstream.headers.get('location');
    if (!location || (upstream.status !== 302 && upstream.status !== 303)) {
      console.error({
        event: 'merchant_auth.bridge_failure',
        category: 'OIDC_LOGIN_BRIDGE_FAILED',
        stage: `${intent}_backend_response_invalid`,
        upstreamStatus: upstream.status,
      });
      return NextResponse.redirect(
        new URL(
          `${frontendPath}?error=${intent === 'link' ? 'link' : 'configuration'}`,
          process.env.DASHBOARD_PUBLIC_ORIGIN ?? 'http://localhost:3001',
        ),
      );
    }
    const response = NextResponse.redirect(location);
    for (const cookie of upstream.headers.getSetCookie?.() ?? [])
      response.headers.append('Set-Cookie', cookie);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch {
    console.error({
      event: 'merchant_auth.bridge_failure',
      category: 'OIDC_LOGIN_BRIDGE_FAILED',
      stage: `${intent}_backend_unavailable`,
    });
    return NextResponse.redirect(
      new URL(
        `${frontendPath}?error=${intent === 'link' ? 'link' : 'unavailable'}`,
        process.env.DASHBOARD_PUBLIC_ORIGIN ?? 'http://localhost:3001',
      ),
    );
  }
}
