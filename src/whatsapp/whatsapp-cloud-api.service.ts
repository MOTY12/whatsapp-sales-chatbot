import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { WhatsAppCloudApiClient } from './interfaces/whatsapp-cloud-api-client.interface';
import { OutgoingWhatsAppMessage } from './types/whatsapp.types';

@Injectable()
export class WhatsAppCloudApiService implements WhatsAppCloudApiClient {
  private readonly logger = new Logger(WhatsAppCloudApiService.name);
  private readonly accessToken = this.requireEnv('WHATSAPP_ACCESS_TOKEN');
  private readonly phoneNumberId = this.requireEnv('WHATSAPP_PHONE_NUMBER_ID');
  private readonly apiVersion = process.env.WHATSAPP_API_VERSION?.trim() || 'v25.0';
  private readonly graphBaseUrl = process.env.META_GRAPH_BASE_URL?.trim() || 'https://graph.facebook.com';

  async sendTextMessage(message: OutgoingWhatsAppMessage): Promise<void> {
    try {
      await axios.post(
        `${this.graphBaseUrl}/${this.apiVersion}/${this.phoneNumberId}/messages`,
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
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(`Sent WhatsApp reply to ${message.to}`);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.logger.error(
          `Failed to send WhatsApp reply to ${message.to}: ${JSON.stringify(error.response?.data ?? error.message)}`,
        );
        return;
      }

      const messageText = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send WhatsApp reply to ${message.to}: ${messageText}`);
    }
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
