import { NextRequest, NextResponse } from 'next/server';
import { ApiError, api } from '@/lib/api';

type RouteContext = { params: Promise<{ path: string[] }> };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(error: unknown) {
  if (error instanceof ApiError) {
    const status = error.status === 0 ? 503 : error.status;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  return NextResponse.json({ error: { code: 'unavailable', message: 'Kleva could not complete that request. Please try again.' } }, {
    status: 500,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const [businessId, collection, conversationId, resource] = path;
  if (!businessId || !idPattern.test(businessId) || collection !== 'conversations') return NextResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 });
  const params = request.nextUrl.searchParams;
  const limit = Math.min(100, Math.max(1, Number(params.get('limit') ?? 30) || 30));
  const cursor = params.get('cursor') ?? undefined;
  try {
    if (path.length === 2) return NextResponse.json(await api.conversations(businessId, limit, cursor), { headers: { 'Cache-Control': 'no-store' } });
    if (!conversationId || !idPattern.test(conversationId)) return NextResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 });
    if (path.length === 3) return NextResponse.json(await api.conversation(businessId, conversationId), { headers: { 'Cache-Control': 'no-store' } });
    if (path.length === 4 && resource === 'messages') return NextResponse.json(await api.messages(businessId, conversationId, limit, cursor), { headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const [businessId, collection, conversationId, action] = path;
  if (!businessId || !idPattern.test(businessId) || collection !== 'conversations' || !conversationId || !idPattern.test(conversationId)) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 });
  }
  const expectedOrigin = process.env.DASHBOARD_PUBLIC_ORIGIN;
  const csrfCookie = request.cookies.getAll().find((cookie) => /kleva_csrf$/i.test(cookie.name));
  const requestOrigin = request.headers.get('origin');
  let sameOrigin = false;
  try { sameOrigin = !!expectedOrigin && !!requestOrigin && new URL(requestOrigin).origin === new URL(expectedOrigin).origin; } catch { sameOrigin = false; }
  if (!sameOrigin || !csrfCookie || request.headers.get('x-csrf-token') !== csrfCookie.value) {
    return NextResponse.json({ error: { code: 'forbidden', message: 'Your session has expired. Sign in again.' } }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    let result;
    if (path.length === 4 && action === 'takeover') result = await api.takeover(businessId, conversationId);
    else if (path.length === 4 && action === 'release') result = await api.release(businessId, conversationId);
    else if (path.length === 4 && action === 'replies') {
      const body: unknown = await request.json().catch(() => null);
      const text = body && typeof body === 'object' && 'text' in body && typeof body.text === 'string' ? body.text : '';
      const key = request.headers.get('idempotency-key') ?? '';
      result = await api.reply(businessId, conversationId, text, key);
    } else return NextResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}
