import { NextRequest, NextResponse } from 'next/server';
import { isAllowedDashboardOrigin } from '@/lib/dashboard-origins';
import { ApiError, api } from '@/lib/api';

type RouteContext = { params: Promise<{ path: string[] }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  if (!uuid.test(path[0] ?? '')) return false;
  if (path[1] === 'documents') {
    return (
      path.length === 2 ||
      (path.length === 3 && ['uploads'].includes(path[2])) ||
      (path.length === 4 &&
        uuid.test(path[2]) &&
        ['complete', 'publish', 'unpublish'].includes(path[3]))
    );
  }
  return (
    path.length >= 1 &&
    path.length <= 3 &&
    (path.length === 1 ||
      (uuid.test(path[1]) &&
        (path.length === 2 || ['publish', 'unpublish'].includes(path[2]))))
  );
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  if (!validPath(path))
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  try {
    const result =
      path.length === 1
        ? await api.faqs(path[0])
        : path.length === 2
          ? path[1] === 'documents'
            ? await api.knowledgeDocuments(path[0])
            : await api.faq(path[0], path[1])
          : null;
    if (!result)
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

export async function POST(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  if (!validPath(path))
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
  try {
    if (path[1] === 'documents') {
      if (path.length === 3 && path[2] === 'uploads') {
        const body = await request.json().catch(() => null);
        const input =
          body && typeof body === 'object'
            ? (body as Record<string, unknown>)
            : {};
        return NextResponse.json(
          await api.createKnowledgeDocumentUpload(
            path[0],
            {
              title: typeof input.title === 'string' ? input.title : '',
              fileName:
                typeof input.fileName === 'string' ? input.fileName : '',
              contentType:
                typeof input.contentType === 'string' ? input.contentType : '',
              sizeBytes:
                typeof input.sizeBytes === 'number' ? input.sizeBytes : 0,
              sha256: typeof input.sha256 === 'string' ? input.sha256 : '',
            },
            request.headers.get('idempotency-key') ?? '',
          ),
          { status: 201, headers: { 'Cache-Control': 'no-store' } },
        );
      }
      if (path.length === 4 && path[3] === 'complete')
        return NextResponse.json(
          await api.completeKnowledgeDocumentUpload(path[0], path[2]),
          { headers: { 'Cache-Control': 'no-store' } },
        );
      if (path.length === 4 && ['publish', 'unpublish'].includes(path[3]))
        return NextResponse.json(
          await (path[3] === 'publish'
            ? api.publishKnowledgeDocument(path[0], path[2])
            : api.unpublishKnowledgeDocument(path[0], path[2])),
          { headers: { 'Cache-Control': 'no-store' } },
        );
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Not found.' } },
        { status: 404 },
      );
    }
    if (path.length === 1) {
      const key = request.headers.get('idempotency-key') ?? '';
      if (!uuidV4.test(key))
        return NextResponse.json(
          {
            error: {
              code: 'validation',
              message:
                'A new FAQ could not be submitted. Refresh and try again.',
            },
          },
          { status: 400 },
        );
      const body: unknown = await request.json().catch(() => null);
      const question =
        body &&
        typeof body === 'object' &&
        'question' in body &&
        typeof body.question === 'string'
          ? body.question
          : '';
      const answer =
        body &&
        typeof body === 'object' &&
        'answer' in body &&
        typeof body.answer === 'string'
          ? body.answer
          : '';
      return NextResponse.json(
        await api.createFaq(path[0], question, answer, key),
        { status: 201, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (path.length === 3 && path[2] === 'publish')
      return NextResponse.json(await api.publishFaq(path[0], path[1]), {
        headers: { 'Cache-Control': 'no-store' },
      });
    if (path.length === 3 && path[2] === 'unpublish')
      return NextResponse.json(await api.unpublishFaq(path[0], path[1]), {
        headers: { 'Cache-Control': 'no-store' },
      });
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
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
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  try {
    const body: unknown = await request.json().catch(() => null);
    const input =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    return NextResponse.json(
      await api.updateFaq(
        path[0],
        path[1],
        typeof input.question === 'string' ? input.question : '',
        typeof input.answer === 'string' ? input.answer : '',
        typeof input.expectedRevision === 'number' ? input.expectedRevision : 0,
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
