import { ChannelConnectionService } from '../channels/channel-connection.service';
import { WhatsAppChannelAdapter } from '../channels/adapters/whatsapp/whatsapp.adapter';
import { Module } from '@nestjs/common';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { AssistantModule } from '../assistant/assistant.module';
import { DatabaseModule } from '../database/database.module';
import { WHATSAPP_CLOUD_API_CLIENT } from './interfaces/whatsapp-cloud-api-client.interface';
import { WhatsAppCloudApiService } from './whatsapp-cloud-api.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppService } from './whatsapp.service';
import { WebhookLeadCaptureService } from './webhook-lead-capture.service';

@Module({
  imports: [OnboardingModule, AssistantModule, DatabaseModule],
  controllers: [WhatsAppWebhookController],
  providers: [
    ChannelConnectionService,
    WhatsAppChannelAdapter,
    WhatsAppService,
    WebhookLeadCaptureService,
    WhatsAppCloudApiService,
    {
      provide: WHATSAPP_CLOUD_API_CLIENT,
      useExisting: WhatsAppCloudApiService,
    },
  ],
  exports: [WhatsAppService, ChannelConnectionService, WhatsAppChannelAdapter],
})
export class WhatsAppModule {}
