import axios, { AxiosError } from 'axios';
import { BadRequestException } from '@nestjs/common';
import { MetaWhatsAppVerifier } from './meta-verifier';

describe('MetaWhatsAppVerifier Embedded Signup', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.replaceProperty(process, 'env', {
      ...originalEnv,
      NODE_ENV: 'test',
      META_APP_ID: '123',
      META_APP_SECRET: 'fixture-secret',
      WHATSAPP_BUSINESS_CONFIG_ID: 'config-456',
      WHATSAPP_API_VERSION: 'v27.0',
      META_GRAPH_BASE_URL: 'https://graph.facebook.com',
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('exchanges the one-time code server-side and performs subscription and phone registration', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue({
      data: { access_token: 'fixture-business-token', expires_in: 3600 },
    } as never);
    const post = jest.spyOn(axios, 'post').mockResolvedValue({
      data: { success: true },
    } as never);
    const verifier = new MetaWhatsAppVerifier();

    expect(verifier.embeddedSignupSettings()).toEqual({
      appId: '123',
      configId: 'config-456',
      apiVersion: 'v27.0',
    });
    const token = await verifier.exchangeCode('one-time-code');
    expect(token.accessToken).toBe('fixture-business-token');
    expect(get).toHaveBeenCalledWith(
      'https://graph.facebook.com/v27.0/oauth/access_token',
      expect.objectContaining({
        params: {
          client_id: '123',
          client_secret: 'fixture-secret',
          code: 'one-time-code',
        },
        maxRedirects: 0,
      }),
    );

    await verifier.subscribeToWebhooks(token.accessToken, '456');
    await verifier.registerPhoneNumber(token.accessToken, '789', '123456');
    expect(post).toHaveBeenNthCalledWith(
      1,
      'https://graph.facebook.com/v27.0/456/subscribed_apps',
      undefined,
      expect.objectContaining({
        headers: { Authorization: 'Bearer fixture-business-token' },
      }),
    );
    expect(post).toHaveBeenNthCalledWith(
      2,
      'https://graph.facebook.com/v27.0/789/register',
      { messaging_product: 'whatsapp', pin: '123456' },
      expect.any(Object),
    );
  });

  it('classifies rejected authorization codes without exposing the provider payload', async () => {
    jest.spyOn(axios, 'get').mockRejectedValue(
      new AxiosError(
        'provider response contains private details',
        'ERR_BAD_REQUEST',
        undefined,
        undefined,
        {
          status: 400,
          statusText: 'Bad Request',
          headers: {},
          config: { headers: {} } as never,
          data: { error: { message: 'private Meta details' } },
        },
      ),
    );
    const verifier = new MetaWhatsAppVerifier();
    await expect(verifier.exchangeCode('expired-code')).rejects.toMatchObject({
      constructor: BadRequestException,
      message:
        'Meta could not exchange this signup code. Start a new connection attempt.',
    });
  });
});
