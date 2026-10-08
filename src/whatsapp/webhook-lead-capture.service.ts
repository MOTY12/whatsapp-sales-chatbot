import { Injectable, Logger } from '@nestjs/common';
import { BusinessRepository } from '../database/repositories/business.repository';
import { ConversationRepository } from '../database/repositories/conversation.repository';
import { CustomerRepository } from '../database/repositories/customer.repository';
import { MessageRepository } from '../database/repositories/message.repository';
import { UserRepository } from '../database/repositories/user.repository';
import { IncomingWhatsAppMessage } from './types/whatsapp.types';

export type WebhookMessageDisposition =
  | { kind: 'duplicate' | 'unsupported' | 'unknown_business' }
  | {
      kind: 'owner_command';
      businessId: string;
      ownerId: string;
      timezone: string;
    }
  | {
      kind: 'customer_message';
      businessId: string;
      ownerWhatsappId?: string;
      customerName: string;
      isNewLead: boolean;
    };

@Injectable()
export class WebhookLeadCaptureService {
  private readonly logger = new Logger(WebhookLeadCaptureService.name);

  constructor(
    private readonly businesses: BusinessRepository,
    private readonly users: UserRepository,
    private readonly customers: CustomerRepository,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
  ) {}

  async capture(
    message: IncomingWhatsAppMessage,
  ): Promise<WebhookMessageDisposition> {
    if (
      message.type !== 'text' ||
      !message.phoneNumberId ||
      !message.providerMessageId
    ) {
      return { kind: 'unsupported' };
    }

    const business = await this.businesses.findByPhoneNumberId(
      message.phoneNumberId,
    );
    if (!business) {
      this.logger.warn(`Webhook received for an unrecognised phone number ID.`);
      return { kind: 'unknown_business' };
    }

    const existingMessage = await this.messages.findByProviderId(
      message.providerMessageId,
    );
    if (existingMessage) {
      return { kind: 'duplicate' };
    }

    const owner = await this.users.findByWhatsappId(message.from);
    if (owner?.businessId === business.id) {
      return {
        kind: 'owner_command',
        businessId: business.id,
        ownerId: owner.id,
        timezone: business.timezone ?? 'UTC',
      };
    }

    const normalizedPhone = normalizePhone(message.from);
    let customer = await this.customers.findByWhatsappIdAndBusiness(
      message.from,
      business.id,
    );
    let isNewLead = false;

    if (!customer) {
      customer = await this.customers.findByPhoneAndBusiness(
        normalizedPhone,
        business.id,
      );
    }

    if (!customer) {
      isNewLead = true;
      customer = await this.customers.create({
        businessId: business.id,
        ownerId: owner?.id,
        name: message.profileName?.trim() || `WhatsApp ${normalizedPhone}`,
        phone: normalizedPhone,
        whatsappId: message.from,
        source: 'whatsapp',
        leadStage: 'New Lead',
        lastInteraction: message.timestamp ?? new Date(),
      });
    } else {
      await this.customers.update(customer.id, {
        lastInteraction: message.timestamp ?? new Date(),
      });
    }

    let conversation = await this.conversations.findLatestForCustomer(
      business.id,
      customer.id,
    );
    if (!conversation) {
      conversation = await this.conversations.create({
        businessId: business.id,
        customerId: customer.id,
        status: 'open',
      });
    }

    try {
      await this.messages.create({
        businessId: business.id,
        conversationId: conversation.id,
        direction: 'inbound',
        content: message.message,
        status: 'delivered',
        whatsappMessageId: message.providerMessageId,
        metadata: { source: 'whatsapp' },
      });
    } catch (error) {
      // The database unique index is the final idempotency guard during concurrent retries.
      if (await this.messages.findByProviderId(message.providerMessageId)) {
        return { kind: 'duplicate' };
      }
      throw error;
    }

    await this.conversations.touch(conversation.id);
    const businessOwners = await this.users.findByBusinessId(business.id);
    const businessOwner = businessOwners.find((user) =>
      user.roles.includes('owner'),
    );

    return {
      kind: 'customer_message',
      businessId: business.id,
      ownerWhatsappId: businessOwner?.whatsappId ?? undefined,
      customerName: customer.name,
      isNewLead,
    };
  }
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}
