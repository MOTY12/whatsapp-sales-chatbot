import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { WebhookLeadCaptureService } from './webhook-lead-capture.service';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly conversationStateService: ConversationStateService,
    private readonly assistantService: AssistantService,
    private readonly assistantParser: AssistantCommandParserService,
    private readonly leadCapture: WebhookLeadCaptureService,
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

    const botReply =
      await this.onboardingService.handleIncomingMessage(message);

    await this.cloudApiClient.sendTextMessage(botReply);

    return botReply;
  }

  async processWebhookMessage(message: IncomingWhatsAppMessage): Promise<void> {
    const disposition = await this.leadCapture.capture(message);

    if (disposition.kind === 'owner_command') {
      const reply = await this.assistantService.handleIncomingMessage(message);
      await this.cloudApiClient.sendTextMessage(reply, disposition.businessId);
      return;
    }

    if (
      disposition.kind === 'customer_message' &&
      disposition.isNewLead &&
      disposition.ownerWhatsappId
    ) {
      await this.cloudApiClient.sendTextMessage(
        {
          to: disposition.ownerWhatsappId,
          message: `New lead: ${disposition.customerName} sent you a WhatsApp message.`,
        },
        disposition.businessId,
      );
    }
  }

  async handleWebhookPayload(payload: unknown): Promise<void> {
    const messages = this.extractIncomingMessages(payload);

    if (!messages.length) {
      this.logger.debug(
        'Received WhatsApp webhook payload without user text messages.',
      );
      return;
    }

    for (const message of messages) {
      await this.processWebhookMessage(message);
    }
  }

  private extractIncomingMessages(payload: unknown): IncomingWhatsAppMessage[] {
    if (this.isSimplifiedIncomingMessage(payload)) {
      return [payload];
    }

    if (!this.isRecord(payload)) {
      return [];
    }

    const entry = Array.isArray(payload.entry) ? payload.entry : [];

    return entry.flatMap((entryItem) => {
      if (!this.isRecord(entryItem)) {
        return [];
      }

      const changes = Array.isArray(entryItem.changes) ? entryItem.changes : [];

      return changes.flatMap((change) => {
        if (!this.isRecord(change) || !this.isRecord(change.value)) {
          return [];
        }

        const metaMessages = Array.isArray(change.value.messages)
          ? change.value.messages
          : [];

        const phoneNumberId = this.readNestedString(change.value, [
          'metadata',
          'phone_number_id',
        ]);
        const contacts = Array.isArray(change.value.contacts)
          ? change.value.contacts
          : [];
        return metaMessages
          .map((metaMessage) =>
            this.toIncomingMessage(metaMessage, phoneNumberId, contacts),
          )
          .filter((message): message is IncomingWhatsAppMessage =>
            Boolean(message),
          );
      });
    });
  }

  private toIncomingMessage(
    metaMessage: unknown,
    phoneNumberId?: string,
    contacts: unknown[] = [],
  ): IncomingWhatsAppMessage | undefined {
    if (!this.isRecord(metaMessage)) {
      return undefined;
    }

    const from =
      typeof metaMessage.from === 'string' ? metaMessage.from : undefined;
    const type =
      typeof metaMessage.type === 'string' ? metaMessage.type : 'unknown';
    const textBody = this.readNestedString(metaMessage, ['text', 'body']);
    const providerMessageId =
      typeof metaMessage.id === 'string' ? metaMessage.id : undefined;
    const timestamp =
      typeof metaMessage.timestamp === 'string'
        ? new Date(Number(metaMessage.timestamp) * 1000)
        : undefined;
    const contact = contacts.find(
      (item) => this.isRecord(item) && item.wa_id === from,
    );
    const profileName = this.isRecord(contact)
      ? this.readNestedString(contact, ['profile', 'name'])
      : undefined;

    if (!from || !textBody || !providerMessageId || !phoneNumberId) {
      return undefined;
    }

    return {
      from,
      message: textBody,
      type,
      providerMessageId,
      phoneNumberId,
      profileName,
      timestamp:
        timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp : undefined,
    };
  }

  private isSimplifiedIncomingMessage(
    payload: unknown,
  ): payload is IncomingWhatsAppMessage {
    if (!this.isRecord(payload)) {
      return false;
    }

    return (
      typeof payload.from === 'string' &&
      typeof payload.message === 'string' &&
      typeof payload.type === 'string'
    );
  }

  private readNestedString(
    payload: Record<string, unknown>,
    path: string[],
  ): string | undefined {
    let current: unknown = payload;

    for (const key of path) {
      if (!this.isRecord(current)) {
        return undefined;
      }

      current = current[key];
    }

    return typeof current === 'string' ? current : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }
}
