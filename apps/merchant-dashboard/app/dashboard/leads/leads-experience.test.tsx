import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeadsExperience } from './leads-experience';
import type { MerchantLead } from '@/lib/api';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const lead: MerchantLead = {
  id: '11111111-1111-4111-8111-111111111111',
  customer_id: '22222222-2222-4222-8222-222222222222',
  conversation_id: '33333333-3333-4333-8333-333333333333',
  customer_name: 'Amina',
  customer_whatsapp_id: '2348012345678',
  source: 'WHATSAPP',
  status: 'NEW',
  first_contact_at: '2026-11-15T10:00:00.000Z',
  last_activity_at: '2026-11-15T10:00:00.000Z',
  version: 1,
  updated_at: '2026-11-15T10:00:00.000Z',
};
describe('LeadsExperience', () => {
  it('shows an empty state when there are no leads', () => {
    render(
      <LeadsExperience
        businessId="11111111-1111-4111-8111-111111111111"
        initialPage={{ items: [], nextCursor: null }}
        initialError={null}
      />,
    );
    expect(screen.getByText(/No leads yet/)).toBeTruthy();
  });
  it('filters populated leads by status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [], nextCursor: null }),
      }),
    );
    render(
      <LeadsExperience
        businessId="11111111-1111-4111-8111-111111111111"
        initialPage={{ items: [lead], nextCursor: null }}
        initialError={null}
      />,
    );
    expect(screen.getAllByText('Amina').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Filter leads'), {
      target: { value: 'WON' },
    });
    expect(await screen.findByText('No leads match this status.')).toBeTruthy();
  });
  it('shows lead detail and conversation association', () => {
    render(
      <LeadsExperience
        businessId="11111111-1111-4111-8111-111111111111"
        initialPage={{ items: [lead], nextCursor: null }}
        initialError={null}
      />,
    );
    expect(screen.getAllByText('WHATSAPP').length).toBeGreaterThan(0);
    expect(
      screen
        .getByRole('link', { name: 'Open conversation history' })
        .getAttribute('href'),
    ).toContain(lead.conversation_id);
    expect(screen.getByLabelText('Lead status')).toBeTruthy();
  });
});
