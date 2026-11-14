import { WhatsAppChannelAdapter } from '../channels/adapters/whatsapp/whatsapp.adapter';
import { OutboundModule } from './outbound.module';
import { OutboxModule } from '../jobs/outbox.module';
import { DatabaseModule } from '../database/database.module';
import { WhatsAppWebhookIntake } from './webhook-intake.service';
import { Module } from '@nestjs/common';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { AssistantModule } from '../assistant/assistant.module';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppService } from './whatsapp.service';
import { WebhookLeadCaptureService } from './webhook-lead-capture.service';

@Module({
  imports: [
    OnboardingModule,
    AssistantModule,
    OutboundModule,
    OutboxModule,
    DatabaseModule,
  ],
  controllers: [WhatsAppWebhookController],
  providers: [
    WhatsAppChannelAdapter,
    WhatsAppWebhookIntake,
    WhatsAppService,
    WebhookLeadCaptureService,
  ],
  exports: [OutboundModule, WhatsAppService, WhatsAppChannelAdapter],
})
export class WhatsAppModule {}
