import { MerchantPilotService } from './merchant-pilot.service';
import type { EntityManager } from 'typeorm';

jest.mock('../config/env', () => ({
  aiConfig: jest.fn(() => ({ enabled: true })),
}));

describe('MerchantPilotService.status', () => {
  const businessId = '11111111-1111-4111-8111-111111111111';
  const enrolledConnectionId = '22222222-2222-4222-8222-222222222222';
  const actor = { accountId: 'merchant-account' } as never;

  function serviceFor(connectionId: string) {
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('kleva_pilot_status')) {
          return [
            {
              enrollment_id: '33333333-3333-4333-8333-333333333333',
              status: 'ACTIVE',
              connection_id: enrolledConnectionId,
            },
          ];
        }
        if (sql.includes('kleva_read_merchant_profile')) {
          return [{ status: 'active' }];
        }
        return [{ id: connectionId, status: 'active' }];
      }),
    };
    const access = {
      withBusiness: jest.fn(
        async (
          _actor: unknown,
          _businessId: string,
          _permission: string,
          callback: (value: EntityManager) => Promise<unknown>,
        ) => callback(manager as unknown as EntityManager),
      ),
    };
    return new MerchantPilotService(access as never);
  }

  it('reports ready only for the exact WhatsApp connection that was approved', async () => {
    const service = serviceFor(enrolledConnectionId);
    const status = await service.status(actor, businessId);

    expect(status.assistant_ready).toBe(true);
    expect(status.prerequisites).toEqual({
      businessActive: true,
      whatsappConnectedAndVerified: true,
      pilotApproved: true,
      approvalMatchesConnection: true,
      aiResponsesEnabled: true,
    });
  });

  it('does not report ready after the approved WhatsApp connection changes', async () => {
    const service = serviceFor('44444444-4444-4444-8444-444444444444');
    const status = await service.status(actor, businessId);

    expect(status.assistant_ready).toBe(false);
  });
});
