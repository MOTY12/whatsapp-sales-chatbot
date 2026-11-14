'use client';

import { useActionState } from 'react';
import { updateBusiness, type ActionState } from '../actions';
import type { Business } from '@/lib/api';

export function ProfileForm({ business }: { business: Business }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateBusiness, {});
  return <form action={action} className="form-card profile-form">
    <input type="hidden" name="businessId" value={business.id}/>
    <div className="form-grid">
      <label>Business name <span className="required">*</span><input name="name" defaultValue={business.name} required maxLength={120}/></label>
      <label>Industry <span className="required">*</span><input name="industry" defaultValue={business.industry} required maxLength={80}/></label>
      <label>Business phone <span className="required">*</span><input name="phone" type="tel" defaultValue={business.phone} required maxLength={32}/></label>
      <label>Timezone <span className="required">*</span><select name="timezone" defaultValue={business.timezone} required><option value="Africa/Lagos">Africa/Lagos (WAT)</option><option value="Africa/Accra">Africa/Accra (GMT)</option><option value="Europe/London">Europe/London</option><option value="America/New_York">America/New_York</option><option value="Asia/Dubai">Asia/Dubai</option><option value="UTC">UTC</option></select></label>
      <label className="form-full">About your business<textarea name="description" defaultValue={business.description ?? ''} rows={4} maxLength={2000}/></label>
      <label className="form-full">Opening hours<textarea name="openingHours" defaultValue={business.openingHours ?? ''} rows={2} maxLength={500}/></label>
    </div>
    {state.error && <p className="form-error" role="alert">{state.error}</p>}{state.success && <p className="form-success" role="status">{state.success}</p>}
    <div className="form-actions"><p>Your profile is visible to your Kleva support team.</p><button className="button button-primary" disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</button></div>
  </form>;
}
