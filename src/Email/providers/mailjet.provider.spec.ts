import { MailjetProvider } from './mailjet.provider';

describe('MailjetProvider', () => {
  const config = {
    enabled: true as const,
    provider: 'mailjet' as const,
    apiKey: 'fixture-api-key',
    secretKey: 'fixture-secret-key',
    senderEmail: 'verified@example.test',
    senderName: 'Kleva',
    encryptionKey: Buffer.alloc(32),
    frontendUrl: 'https://merchant.example.test',
    rateLimitSecret: 'fixture-rate-limit-secret',
  };

  afterEach(() => jest.restoreAllMocks());

  it('submits text and HTML email using the Mailjet v3.1 endpoint', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          Messages: [{ Status: 'success', To: [{ MessageID: 1234 }] }],
        }),
        { status: 200 },
      ),
    );
    const provider = new MailjetProvider(config);
    await expect(
      provider.send('delivery-uuid', 'merchant@example.test', {
        subject: 'Verify',
        text: 'Plain text',
        html: '<p>HTML</p>',
      }),
    ).resolves.toBe('1234');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.mailjet.com/v3.1/send',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"TextPart":"Plain text"'),
      }),
    );
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      'content-type': 'application/json',
    });
  });

  it.each([401, 403, 400])(
    'classifies HTTP %s as permanent',
    async (status) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status }));
      const provider = new MailjetProvider(config);
      await expect(
        provider.send('delivery-uuid', 'merchant@example.test', {
          subject: 'Verify',
          text: 'text',
          html: '<p>text</p>',
        }),
      ).rejects.toMatchObject({ category: 'permanent', status });
    },
  );

  it('classifies rate limiting and server failures as transient', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 429 }));
    const provider = new MailjetProvider(config);
    await expect(
      provider.send('delivery-uuid', 'merchant@example.test', {
        subject: 'Verify',
        text: 'text',
        html: '<p>text</p>',
      }),
    ).rejects.toMatchObject({ category: 'transient', status: 429 });
  });
});
