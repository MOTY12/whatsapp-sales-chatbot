import { NextRequest, NextResponse } from 'next/server';
import { isAllowedDashboardOrigin } from '@/lib/dashboard-origins';
import {
  ApiError,
  api,
  type EmbeddedWhatsAppSignupCompletion,
} from '@/lib/api';

type RouteContext = { params: Promise<{ path: string[] }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validPath(path: string[]) {
  return (
    (path.length === 1 && uuid.test(path[0])) ||
    (path.length === 3 &&
      uuid.test(path[0]) &&
      path[1] === 'embedded-signup' &&
      ['start', 'complete', 'report'].includes(path[2]))
  );
}

function validMutation(request: NextRequest) {
  const csrfCookie = request.cookies
    .getAll()
    .find((cookie) => /kleva_csrf$/i.test(cookie.name));
  const sameOrigin = isAllowedDashboardOrigin(request.headers.get('origin'));
  return (
    sameOrigin &&
    !!csrfCookie &&
    request.headers.get('x-csrf-token') === csrfCookie.value
  );
}

function failure(error: unknown) {
  const status = error instanceof ApiError ? error.status || 503 : 500;
  const code = error instanceof ApiError ? error.code : 'unavailable';
  const message =
    error instanceof ApiError
      ? error.message
      : 'Kleva could not complete that request. Please try again.';
  return NextResponse.json(
    { error: { code, message } },
    {
      status,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  if (path.length !== 3 || !validPath(path))
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  if (!validMutation(request))
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'Your session has expired. Sign in again.',
        },
      },
      { status: 403 },
    );
  try {
    const businessId = path[0];
    if (path[2] === 'start')
      return NextResponse.json(await api.startWhatsAppSignup(businessId), {
        headers: { 'Cache-Control': 'no-store' },
      });
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json(
        {
          error: {
            code: 'validation',
            message: 'Invalid WhatsApp signup response.',
          },
        },
        { status: 400 },
      );
    const value = body as Record<string, unknown>;
    if (path[2] === 'complete') {
      return NextResponse.json(
        await api.completeWhatsAppSignup(
          businessId,
          value as unknown as EmbeddedWhatsAppSignupCompletion,
        ),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      await api.reportWhatsAppSignup(
        businessId,
        String(value.attemptId ?? ''),
        value.outcome as 'action_required' | 'failed' | 'cancelled',
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  if (path.length !== 1 || !validPath(path))
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  if (!validMutation(request))
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'Your session has expired. Sign in again.',
        },
      },
      { status: 403 },
    );
  try {
    return NextResponse.json(await api.disconnectWhatsApp(path[0]), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}
