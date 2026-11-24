import { NextRequest, NextResponse } from 'next/server';
import { isAllowedDashboardOrigin } from '@/lib/dashboard-origins';
import { ApiError, api } from '@/lib/api';

type RouteContext = { params: Promise<{ path: string[] }> };
const idPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(error: unknown) {
  if (error instanceof ApiError) {
    const status = error.status === 0 ? 503 : error.status;
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      {
        status,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
  return NextResponse.json(
    {
      error: {
        code: 'unavailable',
        message: 'Kleva could not complete that request. Please try again.',
      },
    },
    {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const [businessId, collection, conversationId, resource] = path;
  if (
    !businessId ||
    !idPattern.test(businessId) ||
    collection !== 'conversations'
  )
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  const params = request.nextUrl.searchParams;
  const limit = Math.min(
    100,
    Math.max(1, Number(params.get('limit') ?? 30) || 30),
  );
  const cursor = params.get('cursor') ?? undefined;
  try {
    if (path.length === 2) {
      const rawStatus = params.get('status') ?? 'all';
      const status = ['all', 'open', 'closed'].includes(rawStatus)
        ? (rawStatus as 'all' | 'open' | 'closed')
        : 'all';
      return NextResponse.json(
        await api.conversations(
          businessId,
          limit,
          cursor,
          status,
          params.get('search') ?? undefined,
          (params.get('channel') as 'all' | 'WHATSAPP' | 'WEBSITE' | null) ??
            'all',
        ),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (path.length === 3 && conversationId === 'events') {
      const upstream = await api.inboxEventStream(businessId, request.signal);
      if (!upstream.ok) {
        const payload = await upstream.json().catch(() => null);
        return NextResponse.json(
          payload ?? {
            error: { code: 'unavailable', message: 'Inbox unavailable.' },
          },
          { status: upstream.status, headers: { 'Cache-Control': 'no-store' } },
        );
      }
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        },
      });
    }
    if (path.length === 3 && conversationId === 'members')
      return NextResponse.json(await api.inboxMembers(businessId), {
        headers: { 'Cache-Control': 'no-store' },
      });
    if (!conversationId || !idPattern.test(conversationId))
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Not found.' } },
        { status: 404 },
      );
    if (path.length === 3)
      return NextResponse.json(
        await api.conversation(businessId, conversationId),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    if (path.length === 4 && resource === 'messages')
      return NextResponse.json(
        await api.messages(businessId, conversationId, limit, cursor),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    if (path.length === 4 && resource === 'notes')
      return NextResponse.json(
        await api.conversationNotes(businessId, conversationId),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const [businessId, collection, conversationId, action] = path;
  if (
    !businessId ||
    !idPattern.test(businessId) ||
    collection !== 'conversations' ||
    !conversationId ||
    !idPattern.test(conversationId)
  ) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  }
  const csrfCookie = request.cookies
    .getAll()
    .find((cookie) => /kleva_csrf$/i.test(cookie.name));
  const requestOrigin = request.headers.get('origin');
  const sameOrigin = isAllowedDashboardOrigin(requestOrigin);
  if (
    !sameOrigin ||
    !csrfCookie ||
    request.headers.get('x-csrf-token') !== csrfCookie.value
  ) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'Your session has expired. Sign in again.',
        },
      },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  try {
    let result;
    if (path.length === 4 && action === 'takeover')
      result = await api.takeover(businessId, conversationId);
    else if (path.length === 4 && action === 'release')
      result = await api.release(businessId, conversationId);
    else if (path.length === 4 && action === 'typing') {
      const body: unknown = await request.json().catch(() => null);
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        typeof (body as { active?: unknown }).active !== 'boolean'
      )
        return NextResponse.json(
          {
            error: {
              code: 'invalid_request',
              message: 'Typing state is invalid.',
            },
          },
          { status: 400 },
        );
      result = await api.inboxTyping(
        businessId,
        conversationId,
        (body as { active: boolean }).active,
      );
    } else if (path.length === 4 && action === 'read')
      result = await api.markConversationRead(businessId, conversationId);
    else if (path.length === 4 && action === 'assignee') {
      const body: unknown = await request.json().catch(() => null);
      const accountId =
        body && typeof body === 'object' && 'accountId' in body
          ? (body as { accountId: string | null }).accountId
          : undefined;
      if (
        accountId !== null &&
        (typeof accountId !== 'string' || !idPattern.test(accountId))
      )
        return NextResponse.json(
          {
            error: {
              code: 'invalid_request',
              message: 'Choose a valid inbox teammate.',
            },
          },
          { status: 400 },
        );
      result = await api.assignConversation(
        businessId,
        conversationId,
        accountId,
      );
    } else if (path.length === 4 && action === 'notes') {
      const body: unknown = await request.json().catch(() => null);
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        !('text' in body) ||
        typeof body.text !== 'string'
      )
        return NextResponse.json(
          {
            error: {
              code: 'invalid_request',
              message: 'Enter a valid internal note.',
            },
          },
          { status: 400 },
        );
      const text =
        body &&
        typeof body === 'object' &&
        'text' in body &&
        typeof body.text === 'string'
          ? body.text
          : '';
      result = await api.addConversationNote(businessId, conversationId, text);
    } else if (path.length === 4 && action === 'status') {
      const body: unknown = await request.json().catch(() => null);
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        !('status' in body) ||
        !['open', 'closed'].includes(String(body.status))
      )
        return NextResponse.json(
          {
            error: {
              code: 'invalid_request',
              message: 'Choose open or closed conversation status.',
            },
          },
          { status: 400 },
        );
      const status =
        body &&
        typeof body === 'object' &&
        'status' in body &&
        typeof body.status === 'string'
          ? body.status
          : '';
      result = await api.setConversationStatus(
        businessId,
        conversationId,
        status as 'open' | 'closed',
      );
    } else if (path.length === 4 && action === 'replies') {
      const body: unknown = await request.json().catch(() => null);
      const text =
        body &&
        typeof body === 'object' &&
        'text' in body &&
        typeof body.text === 'string'
          ? body.text
          : '';
      const key = request.headers.get('idempotency-key') ?? '';
      result = await api.reply(businessId, conversationId, text, key);
    } else
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Not found.' } },
        { status: 404 },
      );
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}
