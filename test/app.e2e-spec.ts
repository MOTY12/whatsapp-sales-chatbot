import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppController } from './../src/app.controller';
import { AppService } from './../src/app.service';
import { WhatsAppWebhookController } from './../src/whatsapp/whatsapp-webhook.controller';
import { WhatsAppService } from './../src/whatsapp/whatsapp.service';

describe('HTTP (e2e)', () => {
  let app: INestApplication<App>;
  const previousVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const previousAppSecret = process.env.META_APP_SECRET;

  beforeEach(async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'e2e-verify-token';
    process.env.META_APP_SECRET = 'e2e-app-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController, WhatsAppWebhookController],
      providers: [
        AppService,
        {
          provide: WhatsAppService,
          useValue: {
            handleWebhookPayload: jest.fn(),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    process.env.WHATSAPP_VERIFY_TOKEN = previousVerifyToken;
    process.env.META_APP_SECRET = previousAppSecret;
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('verifies the WhatsApp webhook challenge', () => {
    return request(app.getHttpServer())
      .get('/webhooks/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'e2e-verify-token',
        'hub.challenge': 'challenge-123',
      })
      .expect(200)
      .expect('challenge-123');
  });

  it('rejects an invalid WhatsApp webhook verify token', () => {
    return request(app.getHttpServer())
      .get('/webhooks/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'challenge-123',
      })
      .expect(403);
  });
});
