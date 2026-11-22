import { NextRequest, NextResponse } from 'next/server';
import { isAllowedDashboardOrigin } from '@/lib/dashboard-origins';

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
  const requestOrigin = request.headers.get('origin');
  if (!isAllowedDashboardOrigin(requestOrigin)) {
    let safeOrigin = 'missing';
    try {
      if (requestOrigin) safeOrigin = new URL(requestOrigin).origin;
    } catch {
      safeOrigin = 'invalid';
    }
    console.warn({
      event: 'merchant_auth.origin_rejected',
      receivedOrigin: safeOrigin,
    });
    return NextResponse.json(
      { message: 'Invalid request origin.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const dashboardOrigin = new URL(requestOrigin);
  const rawBody = await request.text();
  if (rawBody.length > 16_384)
    return NextResponse.json(
      { message: 'Request is too large.' },
      { status: 413 },
    );
  const isNativeLogin =
    endpoint === 'login/password' &&
    request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/x-www-form-urlencoded');
  let body = rawBody;
  if (isNativeLogin) {
    const form = new URLSearchParams(rawBody);
    body = JSON.stringify({
      email: form.get('email') ?? '',
      password: form.get('password') ?? '',
    });
  }
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
        Origin: requestOrigin,
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
    const response = isNativeLogin
      ? upstream.ok
        ? NextResponse.redirect(
            new URL('/dashboard', dashboardOrigin),
            { status: 303 },
          )
        : NextResponse.redirect(
            new URL(
              `/login?error=${upstream.status === 401 ? 'credentials' : 'unavailable'}`,
              dashboardOrigin,
            ),
            { status: 303 },
          )
      : NextResponse.json(payload, {
      status: upstream.status,
      headers: { 'Cache-Control': 'no-store' },
    });
    response.headers.set('Cache-Control', 'no-store');
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
