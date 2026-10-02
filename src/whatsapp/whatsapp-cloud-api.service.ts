import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { WhatsAppCloudApiClient } from './interfaces/whatsapp-cloud-api-client.interface';
import { OutgoingWhatsAppMessage } from './types/whatsapp.types';
import { BusinessRepository } from '../database/repositories/business.repository';

@Injectable()
export class WhatsAppCloudApiService implements WhatsAppCloudApiClient {
  private readonly logger = new Logger(WhatsAppCloudApiService.name);
  private readonly apiVersion =
    process.env.WHATSAPP_API_VERSION?.trim() || 'v25.0';
  private readonly graphBaseUrl =
    process.env.META_GRAPH_BASE_URL?.trim() || 'https://graph.facebook.com';

  constructor(private readonly businesses: BusinessRepository) {}

  async sendTextMessage(
    message: OutgoingWhatsAppMessage,
    businessId?: string,
  ): Promise<void> {
    try {
      const connection = await this.resolveConnection(businessId);
      await axios.post(
        `${this.graphBaseUrl}/${this.apiVersion}/${connection.phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: this.normalizeRecipient(message.to),
          type: 'text',
          text: {
            preview_url: false,
            body: message.message,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${connection.accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log('Sent WhatsApp message.');
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.logger.error(
          `Failed to send WhatsApp message: ${JSON.stringify(error.response?.status ?? error.message)}`,
        );
        return;
      }

      const messageText =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send WhatsApp message: ${messageText}`);
    }
  }

  private async resolveConnection(
    businessId?: string,
  ): Promise<{ accessToken: string; phoneNumberId: string }> {
    if (businessId) {
      const business = await this.businesses.findById(businessId);
      if (!business?.accessToken || !business.phoneNumberId) {
        throw new Error(
          'This business does not have an active WhatsApp connection.',
        );
      }
      return {
        accessToken: business.accessToken,
        phoneNumberId: business.phoneNumberId,
      };
    }

    return {
      accessToken: this.requireEnv('WHATSAPP_ACCESS_TOKEN'),
      phoneNumberId: this.requireEnv('WHATSAPP_PHONE_NUMBER_ID'),
    };
  }

  private normalizeRecipient(value: string): string {
    return value.replace(/[^\d]/g, '');
  }

  private requireEnv(name: string): string {
    const value = process.env[name]?.trim();

    if (!value || value.startsWith('your_')) {
      throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
  }
}
