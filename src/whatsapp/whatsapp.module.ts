import { Module } from '@nestjs/common';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { AssistantModule } from '../assistant/assistant.module';
import { WHATSAPP_CLOUD_API_CLIENT } from './interfaces/whatsapp-cloud-api-client.interface';
import { WhatsAppCloudApiService } from './whatsapp-cloud-api.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppService } from './whatsapp.service';

@Module({
  imports: [OnboardingModule, AssistantModule],
  controllers: [WhatsAppWebhookController],
  providers: [
    WhatsAppService,
    WhatsAppCloudApiService,
    {
      provide: WHATSAPP_CLOUD_API_CLIENT,
      useExisting: WhatsAppCloudApiService,
    },
  ],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
