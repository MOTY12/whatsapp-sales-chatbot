import { Inject, Injectable } from '@nestjs/common';
import {
  IncomingWhatsAppMessage,
  OutgoingWhatsAppMessage,
} from './types/whatsapp.types';
import {
  WHATSAPP_CLOUD_API_CLIENT,
  WhatsAppCloudApiClient,
} from './interfaces/whatsapp-cloud-api-client.interface';
import { OnboardingService } from '../onboarding/onboarding.service';

@Injectable()
export class WhatsAppService {
  constructor(
    private readonly onboardingService: OnboardingService,
    @Inject(WHATSAPP_CLOUD_API_CLIENT)
    private readonly cloudApiClient: WhatsAppCloudApiClient,
  ) {}

  async processIncomingMessage(
    message: IncomingWhatsAppMessage,
  ): Promise<OutgoingWhatsAppMessage> {
    const botReply = await this.onboardingService.handleIncomingMessage(message);

    await this.cloudApiClient.sendTextMessage(botReply);

    return botReply;
  }
}