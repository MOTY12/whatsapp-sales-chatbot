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

  beforeEach(async () => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      WHATSAPP_VERIFY_TOKEN: 'e2e-verify-token',
      META_APP_SECRET: 'e2e-app-secret',
    });

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
    try {
      await app?.close();
    } finally {
      jest.restoreAllMocks();
    }
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
