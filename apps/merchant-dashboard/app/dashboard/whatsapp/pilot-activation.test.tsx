import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MerchantPilotStatus, WhatsAppStatus } from '@/lib/api';
import { PilotActivation } from './pilot-activation';

vi.mock('../actions', () => ({
  requestPilotReviewFromDashboard: vi.fn(),
  revokePilotFromDashboard: vi.fn(),
}));

afterEach(() => cleanup());

const businessId = '11111111-1111-4111-8111-111111111111';
const connection: WhatsAppStatus = {
  id: '22222222-2222-4222-8222-222222222222',
  status: 'active',
  connectionState: 'connected',
};

describe('merchant AI pilot activation', () => {
  it('lets the owner acknowledge disclosures after backend verification', () => {
    render(
      <PilotActivation
        businessId={businessId}
        canManage
        connection={connection}
        pilot={{ status: 'NOT_ENROLLED' }}
        pilotAvailable
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'AI sales assistant pilot' }),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(/customer conversations may be processed/i),
    ).toBeRequired();
    expect(screen.getByLabelText(/human escalation contact/i)).toBeRequired();
    expect(
      screen.getByRole('button', { name: 'Request pilot activation' }),
    ).toBeTruthy();
  });

  it('does not offer activation to a staff member or without a verified connection', () => {
    const { rerender } = render(
      <PilotActivation
        businessId={businessId}
        canManage={false}
        connection={connection}
        pilot={{ status: 'NOT_ENROLLED' }}
        pilotAvailable
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'Request pilot activation' }),
    ).toBeNull();
    expect(
      screen.getByText(/business owner manages pilot approval/i),
    ).toBeTruthy();

    rerender(
      <PilotActivation
        businessId={businessId}
        canManage
        connection={{ status: 'pending', connectionState: 'not_connected' }}
        pilot={{ status: 'NOT_ENROLLED' }}
        pilotAvailable
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'Request pilot activation' }),
    ).toBeNull();
  });

  it('keeps AI unavailable while review is pending and offers a revocation control', () => {
    const pilot: MerchantPilotStatus = {
      status: 'PENDING_REVIEW',
      enrollment_id: '33333333-3333-4333-8333-333333333333',
    };
    render(
      <PilotActivation
        businessId={businessId}
        canManage
        connection={connection}
        pilot={pilot}
        pilotAvailable
      />,
    );

    expect(screen.getByText(/awaiting Kleva review/i)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Request pilot activation' }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Withdraw request' }),
    ).toBeTruthy();
    expect(screen.getByLabelText(/confirm I want to revoke/i)).toBeRequired();
  });

  it('fails closed when pilot status cannot be read', () => {
    render(
      <PilotActivation
        businessId={businessId}
        canManage
        connection={connection}
        pilot={undefined}
        pilotAvailable={false}
      />,
    );

    expect(screen.getByText(/could not verify pilot approval/i)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Request pilot activation' }),
    ).toBeNull();
  });

  it('identifies the missing readiness prerequisite from backend state', () => {
    render(
      <PilotActivation
        businessId={businessId}
        canManage
        connection={connection}
        pilot={{
          status: 'ACTIVE',
          assistant_ready: false,
          prerequisites: {
            businessActive: true,
            whatsappConnectedAndVerified: true,
            pilotApproved: true,
            approvalMatchesConnection: true,
            aiResponsesEnabled: false,
          },
        }}
        pilotAvailable
      />,
    );

    const checks = screen.getByRole('list', {
      name: 'Pilot activation requirements',
    });
    expect(checks).toHaveTextContent('AI responses are enabled for this pilot');
    expect(checks.querySelector('[data-complete="false"]')).toHaveTextContent(
      'AI responses are enabled for this pilot',
    );
  });
});
