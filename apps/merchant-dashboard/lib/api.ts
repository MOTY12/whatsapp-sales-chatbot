import 'server-only';
import { cookies } from 'next/headers';

export type Membership = { businessId: string; role: 'owner' | 'editor' | 'agent' };
export type Identity = { accountId: string; memberships: Membership[] };
export type Business = {
  id: string; name: string; status: string; role: Membership['role']; industry: string;
  phone: string; timezone: string; description: string | null; openingHours: string | null;
};
export type WhatsAppStatus = {
  status: 'active' | 'inactive' | 'pending'; displayName?: string | null;
  phoneNumberId?: string; wabaId?: string;
};

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

const backend = () => {
  const raw = process.env.KLEVA_BACKEND_ORIGIN;
  if (!raw) throw new Error('KLEVA_BACKEND_ORIGIN is required.');
  const url = new URL(raw);
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('KLEVA_BACKEND_ORIGIN must be an origin without credentials or path.');
  }
  return url.origin;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const jar = await cookies();
  const cookieHeader = jar.getAll().map(({ name, value }) => `${name}=${value}`).join('; ');
  const csrf = jar.getAll().find(({ name }) => /csrf/i.test(name))?.value;
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (cookieHeader) headers.set('Cookie', cookieHeader);
  if (['POST', 'PATCH', 'DELETE'].includes(init.method ?? 'GET')) {
    if (!csrf) throw new ApiError(403, 'Your session has expired. Sign in again.');
    headers.set('X-CSRF-Token', csrf);
    headers.set('Origin', process.env.DASHBOARD_PUBLIC_ORIGIN ?? 'http://localhost:3001');
  }

  let response: Response | undefined;
  const safeRead = (init.method ?? 'GET') === 'GET';
  for (let attempt = 0; attempt < (safeRead ? 2 : 1); attempt += 1) {
    try {
      response = await fetch(`${backend()}${path}`, { ...init, headers, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!safeRead || ![502, 503, 504].includes(response.status) || attempt === 1) break;
    } catch {
      if (attempt === 1 || !safeRead) throw new ApiError(0, 'Kleva is temporarily unavailable. Please try again.');
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  if (!response) throw new ApiError(0, 'Kleva is temporarily unavailable. Please try again.');
  if (!response.ok) {
    if (response.status === 401) throw new ApiError(401, 'Your session has expired. Sign in again.');
    const message = response.status === 403 ? 'You do not have permission to make this change.'
      : response.status === 409 ? 'This request conflicts with a recent change. Refresh and try again.'
      : response.status >= 500 ? 'Kleva could not complete that request. Please try again.'
      : 'Please check the information and try again.';
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  identity: () => request<Identity>('/auth/me'),
  business: (id: string) => request<Business>(`/merchant/businesses/${encodeURIComponent(id)}`),
  createBusiness: (body: Omit<Business, 'id' | 'status' | 'role'>, key: string) =>
    request<Business>('/merchant/businesses', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(body) }),
  updateBusiness: (id: string, body: Partial<Pick<Business, 'name' | 'industry' | 'phone' | 'timezone' | 'description' | 'openingHours'>>) =>
    request<Business>(`/merchant/businesses/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  whatsapp: (id: string) => request<WhatsAppStatus>(`/merchant/businesses/${encodeURIComponent(id)}/whatsapp`),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
};
