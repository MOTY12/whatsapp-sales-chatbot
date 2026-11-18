import { EmailService } from './email.service';

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
});
