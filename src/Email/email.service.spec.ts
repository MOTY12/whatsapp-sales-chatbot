import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { OutboxOperation } from '../database/entities/outbox-operation.entity';
import { EmailService, PermanentEmailFailure } from './email.service';
import { maxExecutionAttempts } from '../jobs/outbox.store';

describe('EmailService durable enqueue', () => {
  const config = {
    enabled: true as const,
    provider: 'mailjet' as const,
    apiKey: 'fixture-key',
    secretKey: 'fixture-secret',
    senderEmail: 'verified@example.test',
    senderName: 'Kleva',
    encryptionKey: Buffer.alloc(32, 4),
    frontendUrl: 'https://merchant.example.test',
    rateLimitSecret: 'fixture-rate-secret',
  };

  it('stores token material encrypted and writes only a UUID reference to the outbox', async () => {
    const stored: unknown[] = [];
    const deliveryId = 'cbbd6ef2-7e67-42ae-a8d6-82bd8e90fb4a';
    const manager = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id FROM public.merchant_email_deliveries'))
          return [{ id: deliveryId }];
        if (params) stored.push(params[2]);
        return [];
      }),
    };
    const database = {
      transaction: (callback: (manager: typeof manager) => Promise<unknown>) =>
        callback(manager),
    };
    const outbox = {
      write: jest.fn(
        (
          _manager: unknown,
          intent: {
            id: string;
            operation: string;
            metadata: Record<string, string>;
          },
        ) => {
          void intent;
          return Promise.resolve();
        },
      ),
    };
    const service = new EmailService(
      config,
      database as never,
      outbox as never,
      {} as never,
    );
    const token = 'very-secret-verification-token';
    await expect(
      service.sendVerification('merchant@example.test', 'Merchant', token),
    ).resolves.toEqual({
      queued: true,
      status: 'queued',
    });
    expect(Buffer.from(stored[0] as Buffer).toString()).not.toContain(token);
    expect(outbox.write).toHaveBeenCalledWith(manager, {
      id: deliveryId,
      operation: 'merchant.email',
      metadata: { deliveryId },
    });
    await service.sendVerification('merchant@example.test', 'Merchant', token);
    expect(outbox.write.mock.calls.map(([, intent]) => intent.id)).toEqual([
      deliveryId,
      deliveryId,
    ]);
  });

  it('reports a missing email outbox relation safely and rejects enqueue', async () => {
    const missingRelation = Object.assign(new Error('relation missing'), {
      code: '42P01',
      table: 'merchant_email_deliveries',
    });
    const manager = { query: jest.fn().mockRejectedValue(missingRelation) };
    const database = {
      transaction: (callback: (manager: typeof manager) => Promise<unknown>) =>
        callback(manager),
    };
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const service = new EmailService(
      config,
      database as never,
      { write: jest.fn() } as never,
      {} as never,
    );

    await expect(
      service.sendPasswordReset('merchant@example.test', 'Merchant', 'token'),
    ).rejects.toThrow(
      new ServiceUnavailableException(
        'Email authentication is temporarily unavailable.',
      ),
    );
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'merchant_email.enqueue_failed',
        databaseErrorCode: '42P01',
        databaseCategory: 'sql_or_schema_error',
      }),
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain(
      'merchant@example.test',
    );
    logger.mockRestore();
  });

  it('leaves transient provider failures retryable and marks exhausted attempts terminal', async () => {
    const deliveryId = 'cbbd6ef2-7e67-42ae-a8d6-82bd8e90fb4a';
    let encryptedPayload: Buffer | undefined;
    const manager = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id FROM public.merchant_email_deliveries'))
          return [{ id: deliveryId }];
        if (params) encryptedPayload = params[2] as Buffer;
        return [];
      }),
    };
    const database = {
      transaction: (callback: (manager: typeof manager) => Promise<unknown>) =>
        callback(manager),
      query: jest.fn(async (sql: string) => {
        if (sql.startsWith('SELECT encrypted_payload'))
          return [{ encrypted_payload: encryptedPayload, status: 'PENDING' }];
        return [];
      }),
    };
    const service = new EmailService(
      config,
      database as never,
      { write: jest.fn() } as never,
      {
        send: jest.fn().mockRejectedValue(new Error('provider unavailable')),
      } as never,
    );
    await service.sendPasswordReset(
      'merchant@example.test',
      'Merchant',
      'one-time-token',
    );
    const operation = {
      id: deliveryId,
      operation: 'merchant.email',
      attempts: 1,
      metadata: { deliveryId },
    } as unknown as Readonly<OutboxOperation>;

    await expect(service.execute(operation)).rejects.toThrow(
      'provider unavailable',
    );
    expect(database.query).toHaveBeenCalledTimes(1);

    await expect(
      service.execute({ ...operation, attempts: maxExecutionAttempts }),
    ).rejects.toBeInstanceOf(PermanentEmailFailure);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'FAILED'"),
      [deliveryId, 'RETRIES_EXHAUSTED'],
    );
  });
});
