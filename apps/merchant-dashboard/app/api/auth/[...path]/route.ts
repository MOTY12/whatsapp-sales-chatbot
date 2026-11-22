import { NextRequest, NextResponse } from 'next/server';

const allowed = new Set([
  'register',
  'login/password',
  'verify-email',
  'resend-verification',
  'forgot-password',
  'reset-password',
  'password',
]);

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const endpoint = path.join('/');
  if (!allowed.has(endpoint))
    return NextResponse.json({ message: 'Not found.' }, { status: 404 });
  const origin = process.env.KLEVA_BACKEND_ORIGIN;
  if (!origin)
    return NextResponse.json(
      { message: 'Authentication is temporarily unavailable.' },
      { status: 503 },
    );
  const url = new URL(origin);
  if (
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    return NextResponse.json(
      { message: 'Authentication is temporarily unavailable.' },
      { status: 503 },
    );
  const configuredDashboardOrigin = process.env.DASHBOARD_PUBLIC_ORIGIN?.trim();
  let dashboardOrigin: URL;
  try {
    dashboardOrigin = new URL(
      configuredDashboardOrigin || new URL(request.url).origin,
    );
  } catch {
    return NextResponse.json(
      { message: 'Authentication is temporarily unavailable.' },
      { status: 503 },
    );
  }
  if (
    dashboardOrigin.username ||
    dashboardOrigin.password ||
    dashboardOrigin.pathname !== '/' ||
    dashboardOrigin.search ||
    dashboardOrigin.hash ||
    (dashboardOrigin.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(dashboardOrigin.hostname))
  ) {
    return NextResponse.json(
      { message: 'Authentication is temporarily unavailable.' },
      { status: 503 },
    );
  }
  if (request.headers.get('origin') !== dashboardOrigin.origin) {
    return NextResponse.json(
      { message: 'Invalid request origin.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const body = await request.text();
  if (body.length > 16_384)
    return NextResponse.json(
      { message: 'Request is too large.' },
      { status: 413 },
    );
  try {
    const csrf =
      request.cookies.get('__Host-kleva_csrf')?.value ??
      request.cookies.get('kleva_csrf')?.value;
    const upstream = await fetch(new URL(`/auth/${endpoint}`, url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(request.headers.get('cookie')
          ? { Cookie: request.headers.get('cookie')! }
          : {}),
        ...((request.headers.get('x-csrf-token') ?? csrf)
          ? { 'X-CSRF-Token': request.headers.get('x-csrf-token') ?? csrf! }
          : {}),
        Origin: dashboardOrigin.origin,
      },
      body,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    let payload: unknown;
    try {
      payload = await upstream.json();
    } catch {
      payload = { message: 'Authentication is temporarily unavailable.' };
    }
    const response = NextResponse.json(payload, {
      status: upstream.status,
      headers: { 'Cache-Control': 'no-store' },
    });
    for (const cookie of upstream.headers.getSetCookie?.() ?? [])
      response.headers.append('Set-Cookie', cookie);
    return response;
  } catch {
    return NextResponse.json(
      { message: 'Authentication is temporarily unavailable.' },
      { status: 503 },
    );
  }
}
