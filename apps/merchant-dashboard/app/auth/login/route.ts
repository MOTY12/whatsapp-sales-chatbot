import { NextResponse } from 'next/server';

function logBridgeFailure(stage: string, upstreamStatus?: number) {
  console.error({
    event: 'merchant_auth.bridge_failure',
    category: 'OIDC_BRIDGE_FAILED',
    stage,
    ...(upstreamStatus ? { upstreamStatus } : {}),
  });
}

export async function GET() {
  const origin = process.env.KLEVA_BACKEND_ORIGIN;
  if (!origin) {
    logBridgeFailure('login_backend_origin_missing');
    return NextResponse.json(
      { error: 'Authentication is not configured.' },
      { status: 503 },
    );
  }
  try {
    const upstream = await fetch(new URL('/auth/login', origin), {
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    const location = upstream.headers.get('location');
    if (!location || (upstream.status !== 302 && upstream.status !== 303)) {
      logBridgeFailure('login_backend_response_invalid', upstream.status);
      return NextResponse.redirect(
        new URL(
          '/login?error=configuration',
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
    logBridgeFailure('login_backend_unavailable');
    return NextResponse.redirect(
      new URL(
        '/login?error=unavailable',
        process.env.DASHBOARD_PUBLIC_ORIGIN ?? 'http://localhost:3001',
      ),
    );
  }
}
