'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { ApiError, api } from '@/lib/api';

export type ActionState = { error?: string; success?: string };

export async function createBusiness(_previous: ActionState, form: FormData): Promise<ActionState> {
  const key = String(form.get('idempotencyKey') ?? '');
  const body = {
    name: String(form.get('name') ?? '').trim(), industry: String(form.get('industry') ?? '').trim(),
    phone: String(form.get('phone') ?? '').trim(), timezone: String(form.get('timezone') ?? '').trim(),
    description: String(form.get('description') ?? '').trim() || null,
    openingHours: String(form.get('openingHours') ?? '').trim() || null,
  };
  if (!/^[0-9a-f-]{36}$/i.test(key)) return { error: 'Please reload the page and submit again.' };
  if (!body.name || !body.industry || !body.phone || !body.timezone) return { error: 'Complete all required fields.' };
  if (!/^\+[1-9]\d{6,14}$/.test(body.phone.replace(/[ ()-]/g, ''))) return { error: 'Use an international phone number, including country code.' };
  try {
    const business = await api.createBusiness(body, key);
    redirect(`/dashboard?businessId=${encodeURIComponent(business.id)}&welcome=1`);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'digest' in error && String(error.digest).startsWith('NEXT_REDIRECT')) throw error;
    return { error: error instanceof ApiError ? error.message : 'Could not create your business. Please try again.' };
  }
}

export async function updateBusiness(_previous: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get('businessId') ?? '');
  if (!id) return { error: 'Select a business before saving.' };
  const body = {
    name: String(form.get('name') ?? '').trim(), industry: String(form.get('industry') ?? '').trim(),
    phone: String(form.get('phone') ?? '').trim(), timezone: String(form.get('timezone') ?? '').trim(),
    description: String(form.get('description') ?? '').trim() || null,
    openingHours: String(form.get('openingHours') ?? '').trim() || null,
  };
  if (!body.name || !body.industry || !body.phone || !body.timezone) return { error: 'Complete all required fields.' };
  try {
    await api.updateBusiness(id, body);
    return { success: 'Business profile saved.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Could not save your profile. Please try again.' };
  }
}

export async function logout() {
  try { await api.logout(); } catch { /* Expired sessions are cleared by returning to login. */ }
  redirect('/login');
}

export async function newBusinessKey() { return randomUUID(); }
