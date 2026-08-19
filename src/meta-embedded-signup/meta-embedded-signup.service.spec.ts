import { Test } from '@nestjs/testing';
import axios from 'axios';
import { EmbeddedSignupConnectionService } from './embedded-signup-connection.service';
import { MetaEmbeddedSignupService } from './meta-embedded-signup.service';

jest.mock('axios');

describe('MetaEmbeddedSignupService', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;
  let service: MetaEmbeddedSignupService;
  let connectionService: EmbeddedSignupConnectionService;

  beforeEach(async () => {
    process.env.META_APP_ID = 'app-123';
    process.env.META_APP_SECRET = 'secret-123';
    process.env.META_REDIRECT_URI = 'https://example.com/meta/callback';
    process.env.WHATSAPP_BUSINESS_CONFIG_ID = 'config-123';
    process.env.WHATSAPP_API_VERSION = 'v20.0';
    process.env.META_GRAPH_BASE_URL = 'https://graph.example.com';

    const moduleRef = await Test.createTestingModule({
      providers: [EmbeddedSignupConnectionService, MetaEmbeddedSignupService],
    }).compile();

    service = moduleRef.get(MetaEmbeddedSignupService);
    connectionService = moduleRef.get(EmbeddedSignupConnectionService);
    mockedAxios.get.mockReset();
  });

  it('createSignupUrl includes the required Meta params', () => {
    const signupUrl = service.createSignupUrl({
      ownerWhatsappId: 'whatsapp-owner',
      businessId: 'business-1',
    });

    const parsed = new URL(signupUrl);

    expect(parsed.origin).toBe('https://www.facebook.com');
    expect(parsed.pathname).toBe('/v20.0/dialog/oauth');
    expect(parsed.searchParams.get('client_id')).toBe('app-123');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://example.com/meta/callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe(
      'whatsapp_business_management,whatsapp_business_messaging,business_management',
    );
    expect(parsed.searchParams.get('extras')).toContain('whatsapp_embedded_signup');

    const state = parsed.searchParams.get('state');

    expect(state).toBeTruthy();
    expect(state ? service.verifyAndDecodeState(state) : null).toEqual({
      ownerWhatsappId: 'whatsapp-owner',
      businessId: 'business-1',
    });
  });

  it('verifies and rejects tampered state', () => {
    const signupUrl = service.createSignupUrl({
      ownerWhatsappId: 'whatsapp-owner',
      businessId: 'business-1',
    });

    const parsed = new URL(signupUrl);
    const state = parsed.searchParams.get('state');

    expect(state).toBeTruthy();

    if (!state) {
      return;
    }

    expect(service.verifyAndDecodeState(state)).toEqual({
      ownerWhatsappId: 'whatsapp-owner',
      businessId: 'business-1',
    });

    const [encodedPayload, signature] = state.split('.');

    if (!encodedPayload || !signature) {
      throw new Error('Expected state with payload and signature.');
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      ownerWhatsappId: string;
      businessId: string;
    };
    payload.businessId = 'business-2';

    const tamperedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const tamperedState = `${tamperedPayload}.${signature}`;

    expect(() => service.verifyAndDecodeState(tamperedState)).toThrow(
      'The embedded signup state signature could not be verified.',
    );
  });

  it('callback exchanges code and saves the connection', async () => {
    const signupUrl = service.createSignupUrl({
      ownerWhatsappId: 'whatsapp-owner',
      businessId: 'business-1',
    });
    const state = new URL(signupUrl).searchParams.get('state');

    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('/oauth/access_token')) {
        return { data: { access_token: 'access-token-123' } } as never;
      }

      if (url.endsWith('/me')) {
        return { data: { id: 'me-1', name: 'Owner' } } as never;
      }

      if (url.endsWith('/me/businesses')) {
        return { data: { data: [{ id: 'business-meta-1', name: 'Kleva' }] } } as never;
      }

      if (url.endsWith('/owned_whatsapp_business_accounts')) {
        return { data: { data: [{ id: 'waba-1', name: 'Kleva WABA' }] } } as never;
      }

      if (url.endsWith('/phone_numbers')) {
        return {
          data: {
            data: [
              {
                id: 'phone-1',
                display_phone_number: '+2348012345678',
                verified_name: 'Kleva',
              },
            ],
          },
        } as never;
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await service.handleCallback({
      code: 'auth-code-123',
      state: state ?? undefined,
    });

    expect(result.statusCode).toBe(200);
    expect(result.html).toContain('WhatsApp Business connected successfully');

    expect(connectionService.getEmbeddedSignupConnection('business-1')).toEqual({
      businessId: 'business-1',
      ownerWhatsappId: 'whatsapp-owner',
      wabaId: 'waba-1',
      phoneNumberId: 'phone-1',
      displayPhoneNumber: '+2348012345678',
      accessToken: 'access-token-123',
      connectedAt: expect.any(String),
      status: 'connected',
    });
  });
});