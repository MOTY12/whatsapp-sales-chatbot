import { Inject, Injectable } from '@nestjs/common';
import {
  IncomingWhatsAppMessage,
  OutgoingWhatsAppMessage,
} from './types/whatsapp.types';
import { WHATSAPP_CLOUD_API_CLIENT } from './interfaces/whatsapp-cloud-api-client.interface';
import type { WhatsAppCloudApiClient } from './interfaces/whatsapp-cloud-api-client.interface';
import { OnboardingService } from '../onboarding/onboarding.service';
import { ConversationStateService } from '../onboarding/conversation-state.service';
import { AssistantService } from '../assistant/assistant.service';
import { AssistantCommandParserService } from '../assistant/assistant-command-parser.service';

@Injectable()
export class WhatsAppService {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly conversationStateService: ConversationStateService,
    private readonly assistantService: AssistantService,
    private readonly assistantParser: AssistantCommandParserService,
    @Inject(WHATSAPP_CLOUD_API_CLIENT)
    private readonly cloudApiClient: WhatsAppCloudApiClient,
  ) {}

  async processIncomingMessage(
    message: IncomingWhatsAppMessage,
  ): Promise<OutgoingWhatsAppMessage> {
    const whatsappId = message.from.trim();

    const currentState = this.conversationStateService.getOrCreate(whatsappId);

    // If onboarding complete or the message looks like an assistant command, route to assistant
    const parsed = this.assistantParser.parse(message.message || '');
    if (currentState.step === 'DONE' || parsed.intent !== 'unknown') {
      const reply = await this.assistantService.handleIncomingMessage(message);
      await this.cloudApiClient.sendTextMessage(reply);
      return reply;
    }

    const botReply = await this.onboardingService.handleIncomingMessage(message);

    await this.cloudApiClient.sendTextMessage(botReply);

    return botReply;
  }
}