import { MerchantPilotService } from './merchant-pilot.service';
import type { EntityManager } from 'typeorm';

jest.mock('../config/env', () => ({
  aiConfig: jest.fn(() => ({ enabled: true })),
  aiResponsesEnabled: jest.fn(() => true),
}));

describe('MerchantPilotService.status', () => {
  const businessId = '11111111-1111-4111-8111-111111111111';
  const enrolledConnectionId = '22222222-2222-4222-8222-222222222222';
  const actor = { accountId: 'merchant-account' } as never;

  function serviceFor(
    connectionId: string,
    readinessOverrides: Record<string, unknown> = {},
    remaining = 100,
    aiRequestAllowance = true,
  ) {
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
        if (sql.includes('kleva_pilot_readiness')) {
          return [
            {
              business_active: true,
              connection_id: connectionId,
              whatsapp_verified: true,
              published_knowledge: true,
              assistant_configured: true,
              pilot_approved: true,
              approval_matches_connection:
                connectionId === enrolledConnectionId,
              human_takeover_count: 0,
              ...readinessOverrides,
            },
          ];
        }
        return [];
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
    const usage = {
      hasAiRequestAllowance: jest.fn().mockResolvedValue(aiRequestAllowance),
      getUsageSummary: jest.fn().mockResolvedValue({
        categories: {
          ai_input_tokens: { remaining },
          ai_output_tokens: { remaining },
          whatsapp_outbound: { remaining },
        },
      }),
    };
    return new MerchantPilotService(access as never, usage as never);
  }

  it('reports ready only for the exact WhatsApp connection that was approved', async () => {
    const service = serviceFor(enrolledConnectionId);
    const status = await service.status(actor, businessId);

    expect(status.assistant_ready).toBe(true);
    expect(status.prerequisites).toEqual({
      businessActive: true,
      whatsappConnectedAndVerified: true,
      publishedKnowledge: true,
      assistantConfigured: true,
      pilotApproved: true,
      approvalMatchesConnection: true,
      aiResponsesEnabled: true,
      usageQuotaReady: true,
    });
    expect(status.automation_status).toBe('ACTIVE');
  });

  it('does not report ready after the approved WhatsApp connection changes', async () => {
    const service = serviceFor('44444444-4444-4444-8444-444444444444');
    const status = await service.status(actor, businessId);

    expect(status.assistant_ready).toBe(false);
    expect(status.automation_status).toBe('OFF');
  });

  it('blocks pilot enrollment when published knowledge is missing', async () => {
    const service = serviceFor(enrolledConnectionId, {
      published_knowledge: false,
    });

    await expect(
      service.enroll(actor, businessId, {
        connectionId: enrolledConnectionId,
        consentVersion: 'pilot-merchant-v1',
        aiProviderDisclosureAccepted: true,
        humanEscalationAccepted: true,
      }),
    ).rejects.toThrow('Complete all AI activation requirements');
  });

  it('reports OFF when no usage quota remains', async () => {
    const status = await serviceFor(enrolledConnectionId, {}, 0).status(
      actor,
      businessId,
    );

    expect(status.activation_ready).toBe(false);
    expect(status.automation_status).toBe('OFF');
  });

  it('reports OFF when the per-request token allowance is disabled', async () => {
    const status = await serviceFor(
      enrolledConnectionId,
      {},
      100,
      false,
    ).status(actor, businessId);

    expect(status.activation_ready).toBe(false);
    expect(status.prerequisites.usageQuotaReady).toBe(false);
  });
});
