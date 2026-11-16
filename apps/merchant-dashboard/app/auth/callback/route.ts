import { NextRequest, NextResponse } from 'next/server';

function logBridgeFailure(stage: string, upstreamStatus?: number) {
  console.error({
    event: 'merchant_auth.bridge_failure',
    category: 'OIDC_BRIDGE_FAILED',
    stage,
    ...(upstreamStatus ? { upstreamStatus } : {}),
  });
}

export async function GET(request: NextRequest) {
  const backend = process.env.KLEVA_BACKEND_ORIGIN;
  if (!backend) {
    logBridgeFailure('callback_backend_origin_missing');
    return NextResponse.redirect(
      new URL('/login?error=configuration', request.url),
    );
  }
  try {
    const target = new URL(`/auth/callback${request.nextUrl.search}`, backend);
    const upstream = await fetch(target, {
      headers: { cookie: request.headers.get('cookie') ?? '' },
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (upstream.status !== 302 && upstream.status !== 303) {
      logBridgeFailure('callback_backend_response_invalid', upstream.status);
      return NextResponse.redirect(
        new URL('/login?error=callback', request.url),
      );
    }
    const response = NextResponse.redirect(new URL('/dashboard', request.url));
    const cookies = upstream.headers.getSetCookie?.() ?? [];
    for (const cookie of cookies) response.headers.append('Set-Cookie', cookie);
    return response;
  } catch {
    logBridgeFailure('callback_backend_unavailable');
    return NextResponse.redirect(
      new URL('/login?error=unavailable', request.url),
    );
  }
}
