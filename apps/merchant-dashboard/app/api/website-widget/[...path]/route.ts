import { NextRequest, NextResponse } from 'next/server';
import { isAllowedDashboardOrigin } from '@/lib/dashboard-origins';
import { ApiError, api } from '@/lib/api';

type Context = { params: Promise<{ path: string[] }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validMutation(request: NextRequest) {
  const cookie = request.cookies
    .getAll()
    .find(({ name }) => /kleva_csrf$/i.test(name));
  return (
    isAllowedDashboardOrigin(request.headers.get('origin')) &&
    !!cookie &&
    request.headers.get('x-csrf-token') === cookie.value
  );
}
function fail(error: unknown) {
  if (error instanceof ApiError)
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status || 503, headers: { 'Cache-Control': 'no-store' } },
    );
  return NextResponse.json(
    {
      error: {
        code: 'unavailable',
        message: 'Widget settings could not be saved. Please try again.',
      },
    },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  );
}
async function bounded(request: NextRequest) {
  if (Number(request.headers.get('content-length') ?? 0) > 12000) return null;
  const text = await request.text();
  if (text.length > 12000) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
export async function GET(_request: NextRequest, context: Context) {
  const { path } = await context.params;
  if (path.length !== 1 || !uuid.test(path[0]))
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  try {
    return NextResponse.json(await api.websiteWidgets(path[0]), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: NextRequest, context: Context) {
  const { path } = await context.params;
  if (
    path.length < 1 ||
    !uuid.test(path[0]) ||
    !(
      path.length === 1 ||
      (path.length === 3 && uuid.test(path[1]) && path[2] === 'rotate')
    )
  )
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  if (!validMutation(request))
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'Your session expired. Sign in again.',
        },
      },
      { status: 403 },
    );
  const body = await bounded(request);
  if (body === null)
    return NextResponse.json(
      {
        error: { code: 'validation', message: 'Widget request is too large.' },
      },
      { status: 413 },
    );
  try {
    if (path.length === 1) {
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        typeof (body as { name?: unknown }).name !== 'string'
      )
        return NextResponse.json(
          { error: { code: 'validation', message: 'Enter a widget name.' } },
          { status: 400 },
        );
      return NextResponse.json(
        await api.createWebsiteWidget(path[0], (body as { name: string }).name),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(await api.rotateWebsiteWidget(path[0], path[1]), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return fail(error);
  }
}
export async function PATCH(request: NextRequest, context: Context) {
  const { path } = await context.params;
  if (
    path.length < 2 ||
    !uuid.test(path[0]) ||
    !uuid.test(path[1]) ||
    !(path.length === 2 || (path.length === 3 && path[2] === 'domains'))
  )
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  if (!validMutation(request))
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'Your session expired. Sign in again.',
        },
      },
      { status: 403 },
    );
  const body = await bounded(request);
  if (body === null || body === undefined)
    return NextResponse.json(
      {
        error: {
          code: 'validation',
          message: 'Widget settings are invalid or too large.',
        },
      },
      { status: 400 },
    );
  try {
    if (path.length === 3)
      return NextResponse.json(
        await api.setWebsiteWidgetDomains(
          path[0],
          path[1],
          (body as { origins: string[] }).origins,
        ),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    return NextResponse.json(
      await api.updateWebsiteWidget(path[0], path[1], body),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return fail(error);
  }
}
