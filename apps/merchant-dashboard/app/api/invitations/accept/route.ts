import { NextRequest, NextResponse } from 'next/server';
import { isAllowedDashboardOrigin } from '@/lib/dashboard-origins';
import { ApiError, api } from '@/lib/api';

const cookieName = 'kleva_pending_invitation';

export async function POST(request: NextRequest) {
  const csrf = request.cookies
    .getAll()
    .find((cookie) => /kleva_csrf$/i.test(cookie.name));
  if (
    !isAllowedDashboardOrigin(request.headers.get('origin')) ||
    !csrf ||
    request.headers.get('x-csrf-token') !== csrf.value
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
  const token = request.cookies.get(cookieName)?.value;
  if (!token)
    return NextResponse.json(
      {
        error: {
          code: 'invitation_missing',
          message: 'Open the original invitation link again.',
        },
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  try {
    const result = await api.acceptTeamInvitation(token);
    const response = NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
    response.cookies.set(cookieName, '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/invitations/accept',
      maxAge: 0,
      secure: request.nextUrl.protocol === 'https:',
    });
    return response;
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        {
          status: error.status || 503,
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    return NextResponse.json(
      {
        error: {
          code: 'unavailable',
          message: 'The invitation could not be accepted. Try again.',
        },
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
