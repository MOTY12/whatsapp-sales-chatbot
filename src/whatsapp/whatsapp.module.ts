import { Module } from '@nestjs/common';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { AssistantModule } from '../assistant/assistant.module';
import {
  MockWhatsAppCloudApiClient,
  WHATSAPP_CLOUD_API_CLIENT,
} from './interfaces/whatsapp-cloud-api-client.interface';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppService } from './whatsapp.service';

@Module({
  imports: [OnboardingModule, AssistantModule],
  controllers: [WhatsAppWebhookController],
  providers: [
    WhatsAppService,
    {
      provide: WHATSAPP_CLOUD_API_CLIENT,
      useClass: MockWhatsAppCloudApiClient,
    },
  ],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}