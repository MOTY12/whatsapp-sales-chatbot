import { NextRequest, NextResponse } from 'next/server';
import { isAllowedDashboardOrigin } from '@/lib/dashboard-origins';
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
    !['leads', 'sales-policy'].includes(collection) ||
    (collection === 'leads' && leadId && !uuid.test(leadId)) ||
    (collection === 'sales-policy' && path.length !== 2)
  )
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  try {
    if (collection === 'sales-policy' && path.length === 2)
      return NextResponse.json(await api.salesPolicy(businessId), {
        headers: { 'Cache-Control': 'no-store' },
      });
    if (path.length === 2)
      return NextResponse.json(
        await api.leads(
          businessId,
          req.nextUrl.searchParams.get('status') ?? undefined,
          Number(req.nextUrl.searchParams.get('limit') ?? 50),
          req.nextUrl.searchParams.get('cursor') ?? undefined,
        ),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    if (path.length === 3)
      return NextResponse.json(await api.lead(businessId, leadId), {
        headers: { 'Cache-Control': 'no-store' },
      });
    if (path.length === 4 && path[3] === 'qualification')
      return NextResponse.json(
        await api.leadQualification(businessId, leadId),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  } catch (error) {
    return fail(error);
  }
}
async function csrfDenied(req: NextRequest) {
  const origin = req.headers.get('origin');
  const csrf = req.cookies.getAll().find((c) => /kleva_csrf$/i.test(c.name));
  return (
    !isAllowedDashboardOrigin(origin) ||
    !csrf ||
    req.headers.get('x-csrf-token') !== csrf.value
  );
}
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  const [businessId, collection, leadId] = path;
  if (
    !businessId ||
    !uuid.test(businessId) ||
    !['leads', 'sales-policy'].includes(collection) ||
    (collection === 'leads' && (!leadId || !uuid.test(leadId))) ||
    (collection === 'sales-policy' && path.length !== 2) ||
    (collection === 'leads' && ![3, 4].includes(path.length)) ||
    (collection === 'leads' && path.length === 4 && path[3] !== 'qualification')
  )
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  if (await csrfDenied(req))
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
    const body = await req.json();
    if (collection === 'sales-policy')
      return NextResponse.json(
        await api.saveSalesPolicy(
          businessId,
          Number(body.expectedVersion),
          body.fields,
        ),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    if (path.length === 4)
      return NextResponse.json(
        await api.saveLeadQualification(businessId, leadId, body),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    return NextResponse.json(await api.updateLead(businessId, leadId, body), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return fail(error);
  }
}
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  const [businessId, collection, leadId, action] = path;
  if (
    !businessId ||
    !uuid.test(businessId) ||
    collection !== 'leads' ||
    !leadId ||
    !uuid.test(leadId) ||
    action !== 'convert' ||
    path.length !== 4
  )
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  if (await csrfDenied(req))
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
    const key = req.headers.get('idempotency-key');
    if (!key)
      return NextResponse.json(
        {
          error: {
            code: 'bad_request',
            message: 'An idempotency key is required.',
          },
        },
        { status: 400 },
      );
    return NextResponse.json(
      await api.convertLead(businessId, leadId, key, await req.json()),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return fail(error);
  }
}
