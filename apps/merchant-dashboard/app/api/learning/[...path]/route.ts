import { NextRequest, NextResponse } from 'next/server';
import { isAllowedDashboardOrigin } from '@/lib/dashboard-origins';
import { ApiError, api, type KnowledgeGap } from '@/lib/api';

type RouteContext = { params: Promise<{ path: string[] }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(error: unknown) {
  if (error instanceof ApiError)
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status || 503, headers: { 'Cache-Control': 'no-store' } },
    );
  return NextResponse.json(
    {
      error: {
        code: 'unavailable',
        message: 'Kleva could not complete that request. Please try again.',
      },
    },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  );
}

function validPath(path: string[]) {
  return (
    (path.length === 2 && uuid.test(path[0]) && path[1] === 'gaps') ||
    (path.length === 3 &&
      uuid.test(path[0]) &&
      path[1] === 'gaps' &&
      uuid.test(path[2]))
  );
}

function validMutation(request: NextRequest) {
  const csrfCookie = request.cookies
    .getAll()
    .find((cookie) => /kleva_csrf$/i.test(cookie.name));
  return (
    isAllowedDashboardOrigin(request.headers.get('origin')) &&
    !!csrfCookie &&
    request.headers.get('x-csrf-token') === csrfCookie.value
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  if (!validPath(path) || path.length !== 2)
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  const status = request.nextUrl.searchParams.get('status') ?? undefined;
  try {
    return NextResponse.json(await api.knowledgeGaps(path[0], status), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  if (!validPath(path) || path.length !== 3)
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
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  if (Number(request.headers.get('content-length') ?? 0) > 1000)
    return NextResponse.json(
      {
        error: {
          code: 'validation',
          message: 'Knowledge-gap update is too large.',
        },
      },
      { status: 413 },
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    !('status' in body) ||
    !['OPEN', 'REVIEWED', 'DISMISSED'].includes(String(body.status))
  )
    return NextResponse.json(
      {
        error: { code: 'validation', message: 'Choose a valid review status.' },
      },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      await api.updateKnowledgeGap(
        path[0],
        path[2],
        body.status as KnowledgeGap['status'],
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
