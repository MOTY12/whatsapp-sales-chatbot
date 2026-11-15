import { NextRequest, NextResponse } from 'next/server';
import { ApiError, api } from '@/lib/api';
type RouteContext = { params: Promise<{ path: string[] }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(error: unknown) {
  if (error instanceof ApiError)
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      {
        status: error.status === 0 ? 503 : error.status,
        headers: { 'Cache-Control': 'no-store' },
      },
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
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  const [businessId, collection, leadId] = path;
  if (
    !businessId ||
    !uuid.test(businessId) ||
    collection !== 'leads' ||
    (leadId && !uuid.test(leadId))
  )
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  try {
    if (path.length === 2)
      return NextResponse.json(
        await api.leads(
          businessId,
          req.nextUrl.searchParams.get('status') ?? undefined,
        ),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    if (path.length === 3)
      return NextResponse.json(await api.lead(businessId, leadId), {
        headers: { 'Cache-Control': 'no-store' },
      });
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  } catch (error) {
    return fail(error);
  }
}
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  const [businessId, collection, leadId] = path;
  if (
    !businessId ||
    !uuid.test(businessId) ||
    collection !== 'leads' ||
    !leadId ||
    !uuid.test(leadId)
  )
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  const expected = process.env.DASHBOARD_PUBLIC_ORIGIN,
    origin = req.headers.get('origin'),
    csrf = req.cookies.getAll().find((c) => /kleva_csrf$/i.test(c.name));
  let same = false;
  try {
    same =
      !!expected &&
      !!origin &&
      new URL(origin).origin === new URL(expected).origin;
  } catch {}
  if (!same || !csrf || req.headers.get('x-csrf-token') !== csrf.value)
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
    return NextResponse.json(
      await api.updateLead(businessId, leadId, await req.json()),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return fail(error);
  }
}
