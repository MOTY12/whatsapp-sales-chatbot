'use client';

import { useActionState } from 'react';
import { createBusiness, type ActionState } from './actions';

export function BusinessForm({ idempotencyKey }: { idempotencyKey: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createBusiness, {});
  return <form action={action} className="form-card">
    <input type="hidden" name="idempotencyKey" value={idempotencyKey}/>
    <div className="form-grid">
      <label>Business name <span className="required">*</span><input name="name" autoComplete="organization" required maxLength={120} placeholder="e.g. The Good Store"/></label>
      <label>Industry <span className="required">*</span><input name="industry" required maxLength={80} placeholder="e.g. Retail"/></label>
      <label>Business phone <span className="required">*</span><input name="phone" required type="tel" autoComplete="tel" placeholder="+234 801 234 5678"/><small>Include your country code.</small></label>
      <label>Timezone <span className="required">*</span><select name="timezone" required defaultValue="Africa/Lagos"><option value="Africa/Lagos">Africa/Lagos (WAT)</option><option value="Africa/Accra">Africa/Accra (GMT)</option><option value="Europe/London">Europe/London</option><option value="America/New_York">America/New_York</option><option value="Asia/Dubai">Asia/Dubai</option><option value="UTC">UTC</option></select></label>
      <label className="form-full">About your business<textarea name="description" rows={3} maxLength={2000} placeholder="What do you sell or help customers with?"/></label>
      <label className="form-full">Opening hours<textarea name="openingHours" rows={2} maxLength={500} placeholder="e.g. Monday–Saturday, 9am–6pm"/></label>
    </div>
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    <div className="form-actions"><p>Fields marked <span className="required">*</span> are required.</p><button className="button button-primary" disabled={pending}>{pending ? 'Creating business…' : 'Create business'} <span aria-hidden="true">→</span></button></div>
  </form>;
}
