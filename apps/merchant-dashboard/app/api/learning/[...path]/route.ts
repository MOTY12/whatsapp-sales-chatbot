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
      uuid.test(path[2])) ||
    (path.length === 2 && uuid.test(path[0]) && path[1] === 'suggestions') ||
    (path.length === 4 &&
      uuid.test(path[0]) &&
      path[1] === 'gaps' &&
      uuid.test(path[2]) &&
      path[3] === 'suggestions') ||
    (path.length === 5 &&
      uuid.test(path[0]) &&
      path[1] === 'gaps' &&
      uuid.test(path[2]) &&
      path[3] === 'suggestions' &&
      path[4] === 'ai-draft') ||
    (path.length === 3 &&
      uuid.test(path[0]) &&
      path[1] === 'suggestions' &&
      uuid.test(path[2])) ||
    (path.length === 4 &&
      uuid.test(path[0]) &&
      path[1] === 'suggestions' &&
      uuid.test(path[2]) &&
      ['submit', 'approve', 'dismiss', 'retry', 'evaluations'].includes(
        path[3],
      ))
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
  if (
    !validPath(path) ||
    !(
      (path.length === 2 && path[1] === 'gaps') ||
      (path.length === 2 && path[1] === 'suggestions') ||
      (path.length === 4 &&
        path[1] === 'suggestions' &&
        path[3] === 'evaluations')
    )
  )
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  const status = request.nextUrl.searchParams.get('status') ?? undefined;
  try {
    const result =
      path.length === 4
        ? await api.learningEvaluations(path[0], path[2])
        : path[1] === 'gaps'
          ? await api.knowledgeGaps(path[0], status)
          : await api.learningSuggestions(path[0], status);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  if (
    !validPath(path) ||
    path.length !== 3 ||
    !['gaps', 'suggestions'].includes(path[1])
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
          message: 'Your session has expired. Sign in again.',
        },
      },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  if (
    Number(request.headers.get('content-length') ?? 0) >
    (path[1] === 'suggestions' ? 7000 : 1000)
  )
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
    path[1] === 'gaps' &&
    (!body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !('status' in body) ||
      !['OPEN', 'REVIEWED', 'DISMISSED'].includes(String(body.status)))
  )
    return NextResponse.json(
      {
        error: { code: 'validation', message: 'Choose a valid review status.' },
      },
      { status: 400 },
    );
  try {
    if (path[1] === 'gaps') {
      return NextResponse.json(
        await api.updateKnowledgeGap(
          path[0],
          path[2],
          (body as { status: KnowledgeGap['status'] }).status,
        ),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const input = body as Record<string, unknown>;
    if (
      !input ||
      typeof input.question !== 'string' ||
      typeof input.answer !== 'string' ||
      !Number.isInteger(input.expectedVersion)
    )
      return NextResponse.json(
        {
          error: {
            code: 'validation',
            message: 'Provide a valid question, answer and version.',
          },
        },
        { status: 400 },
      );
    return NextResponse.json(
      await api.updateLearningSuggestion(path[0], path[2], {
        expectedVersion: Number(input.expectedVersion),
        question: input.question,
        answer: input.answer,
      }),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  if (!validPath(path) || (path.length !== 4 && path.length !== 5))
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
  if (Number(request.headers.get('content-length') ?? 0) > 7000)
    return NextResponse.json(
      {
        error: {
          code: 'validation',
          message: 'Suggestion request is too large.',
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
  try {
    let result;
    if (path.length === 5 && path[1] === 'gaps' && path[4] === 'ai-draft') {
      result = await api.draftLearningSuggestion(path[0], path[2]);
    } else if (path.length === 4 && path[1] === 'gaps') {
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        typeof (body as Record<string, unknown>).question !== 'string' ||
        typeof (body as Record<string, unknown>).answer !== 'string'
      )
        return NextResponse.json(
          {
            error: {
              code: 'validation',
              message: 'Provide a question and answer.',
            },
          },
          { status: 400 },
        );
      result = await api.createLearningSuggestion(
        path[0],
        path[2],
        body as { question: string; answer: string },
      );
    } else if (path.length === 4 && path[1] === 'suggestions') {
      const [businessId, , suggestionId, action] = path;
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return NextResponse.json(
          {
            error: {
              code: 'validation',
              message: 'Invalid suggestion request.',
            },
          },
          { status: 400 },
        );
      const input = body as Record<string, unknown>;
      if (action === 'submit')
        result = await api.submitLearningSuggestion(
          businessId,
          suggestionId,
          Number(input.expectedVersion),
        );
      else if (action === 'approve')
        result = await api.approveLearningSuggestion(
          businessId,
          suggestionId,
          Number(input.expectedVersion),
          String(input.idempotencyKey ?? ''),
        );
      else
        return NextResponse.json(
          { error: { code: 'not_found', message: 'Not found.' } },
          { status: 404 },
        );
    } else {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Not found.' } },
        { status: 404 },
      );
    }
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}
