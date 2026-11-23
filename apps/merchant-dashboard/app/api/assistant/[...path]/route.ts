import { NextRequest, NextResponse } from 'next/server';
import { isAllowedDashboardOrigin } from '@/lib/dashboard-origins';
import { ApiError, api } from '@/lib/api';

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
    (path.length === 1 && uuid.test(path[0])) ||
    (path.length === 2 && uuid.test(path[0]) && path[1] === 'playground')
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

async function boundedJson(request: NextRequest) {
  if (Number(request.headers.get('content-length') ?? 0) > 12_000) return null;
  const text = await request.text();
  if (text.length > 12_000) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  if (!validPath(path) || path.length !== 1)
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  try {
    return NextResponse.json(await api.assistantConfiguration(path[0]), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  if (!validPath(path) || path.length !== 1)
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
  const body = await boundedJson(request);
  if (body === null)
    return NextResponse.json(
      {
        error: {
          code: 'validation',
          message: 'Assistant settings request is too large.',
        },
      },
      { status: 413 },
    );
  if (body === undefined)
    return NextResponse.json(
      {
        error: {
          code: 'validation',
          message: 'Assistant settings are invalid.',
        },
      },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      await api.updateAssistantConfiguration(
        path[0],
        body as Parameters<typeof api.updateAssistantConfiguration>[1],
      ),
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  if (!validPath(path) || path.length !== 2)
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
  const body = await boundedJson(request);
  if (body === null)
    return NextResponse.json(
      {
        error: {
          code: 'validation',
          message: 'Playground request is too large.',
        },
      },
      { status: 413 },
    );
  if (
    !body ||
    typeof body !== 'object' ||
    !('message' in body) ||
    typeof body.message !== 'string'
  )
    return NextResponse.json(
      { error: { code: 'validation', message: 'Enter a test message.' } },
      { status: 400 },
    );
  try {
    const input = body as {
      message: string;
      history?: Parameters<typeof api.testAssistantMessage>[2];
    };
    return NextResponse.json(
      await api.testAssistantMessage(
        path[0],
        input.message,
        input.history ?? [],
      ),
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    return failure(error);
  }
}
