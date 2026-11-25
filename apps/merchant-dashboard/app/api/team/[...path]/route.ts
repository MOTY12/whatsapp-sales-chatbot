import { NextRequest, NextResponse } from 'next/server';
import { ApiError, api } from '@/lib/api';
import { isAllowedDashboardOrigin } from '@/lib/dashboard-origins';

type Context = { params: Promise<{ path: string[] }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(error: unknown) {
  if (error instanceof ApiError)
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status || 503, headers: { 'Cache-Control': 'no-store' } },
    );
  return NextResponse.json(
    {
      error: {
        code: 'unavailable',
        message: 'Team management is temporarily unavailable.',
      },
    },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  );
}

function validMutation(request: NextRequest) {
  const csrf = request.cookies
    .getAll()
    .find((cookie) => /kleva_csrf$/i.test(cookie.name));
  return (
    isAllowedDashboardOrigin(request.headers.get('origin')) &&
    !!csrf &&
    request.headers.get('x-csrf-token') === csrf.value
  );
}

export async function GET(request: NextRequest, context: Context) {
  const { path } = await context.params;
  if (
    !uuid.test(path[0] ?? '') ||
    path.length > 2 ||
    (path[1] &&
      !['invitations', 'audit'].includes(path[1]) &&
      !uuid.test(path[1]))
  )
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  try {
    return NextResponse.json(
      path[1] === 'invitations'
        ? await api.teamInvitations(path[0])
        : path[1] === 'audit'
          ? await api.teamAudit(path[0])
          : path[1]
            ? await api.teamMember(path[0], path[1])
            : await api.team(
                path[0],
                request.nextUrl.searchParams.get('status') ?? 'active',
                {
                  search:
                    request.nextUrl.searchParams.get('search') ?? undefined,
                  limit: Number(
                    request.nextUrl.searchParams.get('limit') ?? 100,
                  ),
                  offset: Number(
                    request.nextUrl.searchParams.get('offset') ?? 0,
                  ),
                },
              ),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  const { path } = await context.params;
  if (!uuid.test(path[0] ?? '') || !validMutation(request))
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'Your session has expired. Sign in again.',
        },
      },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  const body = await request.json().catch(() => null);
  try {
    let result;
    if (path.length === 2 && path[1] === 'invitations') {
      const input =
        body && typeof body === 'object'
          ? (body as Record<string, unknown>)
          : {};
      if (
        typeof input.email !== 'string' ||
        (input.role !== 'editor' && input.role !== 'agent')
      )
        return NextResponse.json(
          {
            error: {
              code: 'validation',
              message: 'Enter an email and choose an allowed team role.',
            },
          },
          { status: 400, headers: { 'Cache-Control': 'no-store' } },
        );
      result = await api.createTeamInvitation(
        path[0],
        input.email,
        input.role,
        request.headers.get('idempotency-key') ?? '',
      );
    } else if (
      path.length === 4 &&
      path[1] === 'invitations' &&
      path[3] === 'resend'
    )
      result = await api.resendTeamInvitation(path[0], path[2]);
    else if (
      path.length === 4 &&
      path[1] === 'invitations' &&
      path[3] === 'revoke'
    )
      result = await api.revokeTeamInvitation(path[0], path[2]);
    else if (
      path.length === 4 &&
      path[1] === 'members' &&
      path[3] === 'revoke'
    ) {
      const input =
        body && typeof body === 'object'
          ? (body as Record<string, unknown>)
          : {};
      result = await api.revokeTeamMember(
        path[0],
        path[2],
        Number(input.version),
      );
    } else
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Not found.' } },
        { status: 404 },
      );
    return NextResponse.json(result, {
      status: path.length === 2 ? 201 : 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const { path } = await context.params;
  if (
    !uuid.test(path[0] ?? '') ||
    path.length !== 3 ||
    path[1] !== 'members' ||
    !uuid.test(path[2]) ||
    !validMutation(request)
  )
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'Your session has expired. Sign in again.',
        },
      },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  const body = await request.json().catch(() => null);
  const input =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (
    (input.role !== 'editor' && input.role !== 'agent') ||
    !Number.isInteger(input.version)
  )
    return NextResponse.json(
      {
        error: {
          code: 'validation',
          message: 'Provide an allowed role and current membership version.',
        },
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  try {
    const result = await api.updateTeamRole(
      path[0],
      path[2],
      input.role,
      Number(input.version),
    );
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
