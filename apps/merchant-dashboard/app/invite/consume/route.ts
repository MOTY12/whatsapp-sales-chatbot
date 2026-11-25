import { NextRequest, NextResponse } from 'next/server';

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const cookieName = 'kleva_pending_invitation';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const destination = new URL('/invitations/accept', request.url);
  const response = NextResponse.redirect(destination, 303);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  if (tokenPattern.test(token)) {
    response.cookies.set(cookieName, token, {
      httpOnly: true,
      secure: request.nextUrl.protocol === 'https:',
      sameSite: 'lax',
      path: '/api/invitations/accept',
      maxAge: 60 * 60 * 24 * 3,
    });
  }
  return response;
}
