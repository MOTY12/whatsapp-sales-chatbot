import { WhatsAppProvisioningService } from './whatsapp-provisioning.service';
import type { OutboxOperation } from '../../database/entities/outbox-operation.entity';

describe('WhatsAppProvisioningService', () => {
  const pending = {
    business_id: '2fa85f64-5717-4562-b3fc-2c963f66afa6',
    connection_id: 'd2719b7e-2f17-4cde-b561-7e22c1b19f07',
    waba_id: '1234567890',
    phone_number_id: '1234567891',
    credential_envelope: { ciphertext: 'encrypted-token' },
    registration_pin_envelope: { ciphertext: 'encrypted-pin' },
    expires_at: null,
    expected_revision: null,
    reconnect: false,
    processing_stage: 'CREDENTIAL_STAGED',
  };
  const operation = {
    id: 'a4728a16-d551-4d8c-a6f4-768fe96dbe3a',
    businessId: pending.business_id,
    operation: 'whatsapp.connection.provision',
    metadata: { attemptId: 'a97b3a8d-2fa9-43ec-93c3-e71398e135d9' },
    attempts: 1,
    leaseToken: '5e5d756a-8f42-44a9-8065-bef28be42314',
  } as OutboxOperation;

  function setup() {
    const database = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('provision_read')) return [pending];
        if (sql.includes('SELECT processing_stage'))
          return [{ processing_stage: 'REGISTERING_PHONE' }];
        if (sql.includes('provision_finish')) return [{ ok: true }];
        if (sql.includes('provision_fail')) return [{ ok: true }];
        return [{ ok: true }];
      }),
    };
    const cipher = {
      decrypt: jest
        .fn()
        .mockReturnValueOnce('private-meta-token')
        .mockReturnValueOnce('123456'),
    };
    const meta = {
      verifyAuthorizedAssets: jest.fn().mockResolvedValue({}),
      subscribeToWebhooks: jest.fn().mockResolvedValue(undefined),
      registerPhoneNumber: jest.fn().mockResolvedValue(undefined),
      verify: jest.fn().mockResolvedValue({
        displayName: 'Example Business',
        displayPhoneNumber: '+2348000000000',
        expiresAt: null,
      }),
    };
    const service = new WhatsAppProvisioningService(
      database as never,
      cipher as never,
      meta as never,
    );
    return { service, database, cipher, meta };
  }

  it('verifies selected assets before mutations and activates only after readiness checks', async () => {
    const { service, database, cipher, meta } = setup();
    await service.execute(operation);

    expect(cipher.decrypt).toHaveBeenNthCalledWith(
      1,
      pending.credential_envelope,
      pending.business_id,
      pending.connection_id,
    );
    expect(meta.verifyAuthorizedAssets).toHaveBeenCalledWith(
      'private-meta-token',
      pending.waba_id,
      pending.phone_number_id,
    );
    expect(
      meta.verifyAuthorizedAssets.mock.invocationCallOrder[0],
    ).toBeLessThan(meta.subscribeToWebhooks.mock.invocationCallOrder[0]);
    expect(meta.subscribeToWebhooks).toHaveBeenCalledTimes(1);
    expect(meta.registerPhoneNumber).toHaveBeenCalledWith(
      'private-meta-token',
      pending.phone_number_id,
      '123456',
    );
    expect(meta.verify).toHaveBeenCalledTimes(1);
    expect(database.query).toHaveBeenCalledWith(
      'SELECT public.kleva_whatsapp_provision_finish($1,$2,$3,$4,$5,$6) AS ok',
      [
        operation.metadata.attemptId,
        operation.id,
        operation.leaseToken,
        'Example Business',
        '+2348000000000',
        null,
      ],
    );
  });

  it('does not mutate Meta when read-only verification rejects the selected assets', async () => {
    const { service, meta } = setup();
    meta.verifyAuthorizedAssets.mockRejectedValueOnce(new Error('rejected'));

    await expect(service.execute(operation)).rejects.toThrow('rejected');
    expect(meta.subscribeToWebhooks).not.toHaveBeenCalled();
    expect(meta.registerPhoneNumber).not.toHaveBeenCalled();
  });

  it('never sends authorization credentials or PINs in the queued operation metadata', () => {
    expect(operation.metadata).toEqual({ attemptId: expect.any(String) });
    expect(JSON.stringify(operation.metadata)).not.toContain(
      'private-meta-token',
    );
    expect(JSON.stringify(operation.metadata)).not.toContain('123456');
  });
});
