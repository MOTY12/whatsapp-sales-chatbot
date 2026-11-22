import { NextRequest, NextResponse } from 'next/server';
import { isAllowedDashboardOrigin } from '@/lib/dashboard-origins';
import { ApiError, api, type ProductDraft } from '@/lib/api';

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
  return (
    path.length >= 1 &&
    path.length <= 3 &&
    uuid.test(path[0]) &&
    (path.length === 1 ||
      (uuid.test(path[1]) &&
        (path.length === 2 || ['publish', 'unpublish'].includes(path[2]))))
  );
}

function notFound() {
  return NextResponse.json(
    { error: { code: 'not_found', message: 'Not found.' } },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  if (!validPath(path)) return notFound();
  try {
    const result =
      path.length === 1
        ? await api.products(
            path[0],
            Number(request.nextUrl.searchParams.get('limit') ?? 50),
            Number(request.nextUrl.searchParams.get('offset') ?? 0),
          )
        : path.length === 2
          ? await api.product(path[0], path[1])
          : null;
    return result
      ? NextResponse.json(result, {
          headers: { 'Cache-Control': 'no-store' },
        })
      : notFound();
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

function mutationFailure() {
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

function productBody(body: unknown): ProductDraft {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return {
      name: '',
      description: '',
      sku: null,
      price: null,
      currency: 'NGN',
      availability: 'UNKNOWN',
    };
  const fields = body as Record<string, unknown>;
  return {
    name: typeof fields.name === 'string' ? fields.name : '',
    description:
      typeof fields.description === 'string' ? fields.description : '',
    sku: typeof fields.sku === 'string' ? fields.sku : null,
    price:
      typeof fields.price === 'string' || fields.price === null
        ? fields.price
        : null,
    currency: typeof fields.currency === 'string' ? fields.currency : 'NGN',
    availability: (typeof fields.availability === 'string'
      ? fields.availability
      : 'UNKNOWN') as ProductDraft['availability'],
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  if (!validPath(path)) return notFound();
  if (!validMutation(request)) return mutationFailure();
  try {
    if (path.length === 1) {
      const key = request.headers.get('idempotency-key') ?? '';
      if (!uuidV4.test(key))
        return NextResponse.json(
          {
            error: {
              code: 'validation',
              message:
                'A new product could not be submitted. Refresh and try again.',
            },
          },
          { status: 400, headers: { 'Cache-Control': 'no-store' } },
        );
      const body: unknown = await request.json().catch(() => null);
      return NextResponse.json(
        await api.createProduct(path[0], productBody(body), key),
        { status: 201, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (path.length === 3 && path[2] === 'publish')
      return NextResponse.json(await api.publishProduct(path[0], path[1]), {
        headers: { 'Cache-Control': 'no-store' },
      });
    if (path.length === 3 && path[2] === 'unpublish')
      return NextResponse.json(await api.unpublishProduct(path[0], path[1]), {
        headers: { 'Cache-Control': 'no-store' },
      });
    return notFound();
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  if (!validPath(path) || path.length !== 2) return notFound();
  if (!validMutation(request)) return mutationFailure();
  try {
    const body: unknown = await request.json().catch(() => null);
    const fields =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    return NextResponse.json(
      await api.updateProduct(
        path[0],
        path[1],
        productBody(fields),
        typeof fields.expectedRevision === 'number'
          ? fields.expectedRevision
          : 0,
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}
