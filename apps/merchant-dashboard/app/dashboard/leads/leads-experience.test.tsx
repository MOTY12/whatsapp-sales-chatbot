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

  it('qualifies a lead from its policy fields and confirms conversion as a manual record', async () => {
    let status = 'CONTACTED';
    let version = 2;
    let qualification: Record<string, unknown> | null = null;
    let conversions: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/sales-policy'))
          return {
            ok: true,
            json: async () => ({
              policy: {
                version: 1,
                fields: [
                  {
                    id: 'product_interest',
                    label: 'Product of interest',
                    type: 'TEXT',
                    required: true,
                    validation: { maxLength: 240 },
                    order: 10,
                    purpose: 'Product being considered.',
                    consentRequired: false,
                  },
                ],
                changed_by: null,
                updated_at: null,
              },
            }),
          } as Response;
        if (url.endsWith('/qualification') && init?.method === 'PATCH') {
          const inputBody = JSON.parse(String(init.body));
          version += 1;
          if (inputBody.markQualified) status = 'QUALIFIED';
          qualification = {
            id: 'qualification-1',
            lead_id: lead.id,
            revision: 1,
            policy_version: 1,
            field_values: inputBody.fieldValues,
            consent_evidence: inputBody.consentEvidence,
            qualification_status: inputBody.markQualified
              ? 'QUALIFIED'
              : 'IN_PROGRESS',
            qualified_by: inputBody.markQualified ? 'owner' : null,
            qualified_at: inputBody.markQualified
              ? new Date().toISOString()
              : null,
            created_at: new Date().toISOString(),
          };
          return {
            ok: true,
            json: async () => ({
              ...qualification,
              lead_status: status,
              lead_version: version,
            }),
          } as Response;
        }
        if (url.endsWith('/convert')) {
          const inputBody = JSON.parse(String(init?.body));
          status = inputBody.outcome;
          version += 1;
          const key = new Headers(init?.headers).get('Idempotency-Key');
          expect(key).toBeTruthy();
          conversions = [
            {
              id: 'conversion-1',
              outcome: status,
              reference: inputBody.details.reference,
              conversion_value: null,
              currency: null,
              conversion_date: new Date().toISOString().slice(0, 10),
              loss_reason: null,
              converted_by: 'owner',
              created_at: new Date().toISOString(),
            },
          ];
          return {
            ok: true,
            json: async () => ({
              lead_version: version,
              created_at: new Date().toISOString(),
            }),
          } as Response;
        }
        if (url.endsWith('/qualification'))
          return {
            ok: true,
            json: async () => ({
              record: qualification,
              history: qualification ? [qualification] : [],
              conversions,
            }),
          } as Response;
        if (url.includes('/leads/'))
          return {
            ok: true,
            json: async () => ({
              leadId: lead.id,
              status,
              version,
              updatedAt: new Date().toISOString(),
              changed: true,
            }),
          } as Response;
        return {
          ok: true,
          json: async () => ({ items: [], nextCursor: null }),
        } as Response;
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <LeadsExperience
        businessId="11111111-1111-4111-8111-111111111111"
        initialPage={{
          items: [{ ...lead, status: 'CONTACTED', version: 2 }],
          nextCursor: null,
        }}
        initialError={null}
      />,
    );
    expect(await screen.findByLabelText(/Product of interest/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Product of interest/), {
      target: { value: 'Handwoven tote' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mark as qualified' }));
    expect(await screen.findByText(/Lead qualified/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Won' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reference (optional)'), {
      target: { value: 'merchant-reference-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm outcome' }));
    expect(await screen.findByText(/Lead recorded as WON/)).toBeTruthy();
    expect(await screen.findByText(/Outcome WON/)).toBeTruthy();
  });
});
