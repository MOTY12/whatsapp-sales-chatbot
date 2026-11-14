import { NextResponse } from 'next/server';

export async function GET() {
  const origin = process.env.KLEVA_BACKEND_ORIGIN;
  if (!origin) return NextResponse.json({ error: 'Authentication is not configured.' }, { status: 503 });
  try {
    const upstream = await fetch(new URL('/auth/login', origin), { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    const location = upstream.headers.get('location');
    if (!location || (upstream.status !== 302 && upstream.status !== 303)) return NextResponse.redirect(new URL('/login?error=configuration', process.env.DASHBOARD_PUBLIC_ORIGIN ?? 'http://localhost:3001'));
    const response = NextResponse.redirect(location);
    for (const cookie of upstream.headers.getSetCookie?.() ?? []) response.headers.append('Set-Cookie', cookie);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch {
    return NextResponse.redirect(new URL('/login?error=unavailable', process.env.DASHBOARD_PUBLIC_ORIGIN ?? 'http://localhost:3001'));
  }
}
