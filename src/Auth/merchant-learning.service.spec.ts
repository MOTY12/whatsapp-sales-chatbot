import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MerchantLearningService } from './merchant-learning.service';

describe('MerchantLearningService', () => {
  const actor = { accountId: 'account', sessionDigest: 'session-digest' };
  const businessId = '11111111-1111-4111-8111-111111111111';
  const clusterId = '22222222-2222-4222-8222-222222222222';
  let access: {
    withBusiness: (
      actor: unknown,
      businessId: string,
      permission: string,
      operation: (manager: never, membership: never) => Promise<unknown>,
    ) => Promise<unknown>;
  };
  let manager: { query: jest.Mock };
  let service: MerchantLearningService;

  beforeEach(() => {
    manager = { query: jest.fn() };
    access = {
      withBusiness: async (_actor, _business, permission, operation) => {
        if (permission !== 'knowledge.manage')
          throw new Error('bad permission');
        return operation(
          manager as never,
          { businessId, role: 'owner' } as never,
        );
      },
    };
    service = new MerchantLearningService(access as never);
  });

  it('lists gaps through the tenant session and validates bounded filters', async () => {
    manager.query.mockResolvedValue([{ id: clusterId }]);
    await expect(
      service.list(actor, businessId, 'open', '25'),
    ).resolves.toEqual({
      items: [{ id: clusterId }],
      limit: 25,
    });
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT * FROM public.kleva_learning_gaps($1,$2)',
      [25, 'OPEN'],
    );
    expect(() => service.list(actor, businessId, 'alliance')).toThrow(
      BadRequestException,
    );
    expect(() => service.list(actor, businessId, undefined, '500')).toThrow(
      BadRequestException,
    );
  });

  it('updates only an authorized tenant cluster with a strict status body', async () => {
    manager.query.mockResolvedValue([{ id: clusterId, status: 'REVIEWED' }]);
    await expect(
      service.updateStatus(actor, businessId, clusterId, {
        status: 'REVIEWED',
      }),
    ).resolves.toEqual({ id: clusterId, status: 'REVIEWED' });
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT * FROM public.kleva_learning_gap_set_status($1,$2)',
      [clusterId, 'REVIEWED'],
    );
    expect(() =>
      service.updateStatus(actor, businessId, clusterId, {
        status: 'PUBLISHED',
      }),
    ).toThrow(BadRequestException);
    manager.query.mockResolvedValue([]);
    await expect(
      service.updateStatus(actor, businessId, clusterId, { status: 'OPEN' }),
    ).rejects.toThrow(NotFoundException);
  });
});
