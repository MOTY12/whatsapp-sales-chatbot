import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WhatsAppExperience } from './whatsapp-experience';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/script', () => ({ default: () => null }));

describe('WhatsAppExperience', () => {
  it('shows the verified connection details and restricts changes to owners', () => {
    render(
      <WhatsAppExperience
        businessId="11111111-1111-4111-8111-111111111111"
        canManage={false}
        initialStatus={{
          status: 'active',
          connectionState: 'connected',
          displayName: 'Kleva Shop',
          displayPhoneNumber: '+234 801 234 5678',
          phoneNumberId: '123456',
          wabaId: '456789',
        }}
      />,
    );

    expect(screen.getByRole('status', { name: 'Connected' })).toBeTruthy();
    expect(screen.getByText('+234 801 234 5678')).toBeTruthy();
    expect(screen.getByText('456789')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Reconnect WhatsApp' }),
    ).toBeNull();
  });

  it('explains the phone PIN and presents self-service signup to business owners', () => {
    render(
      <WhatsAppExperience
        businessId="11111111-1111-4111-8111-111111111111"
        canManage
        initialStatus={{ status: 'pending', connectionState: 'not_connected' }}
      />,
    );

    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(
      screen.getByLabelText(/six-digit WhatsApp two-step PIN/i),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Connect WhatsApp' }),
    ).toBeDisabled();
  });
});
