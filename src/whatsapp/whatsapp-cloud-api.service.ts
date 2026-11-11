import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { metaConfig } from '../config/env';
import type { WhatsAppCloudApiClient } from './interfaces/whatsapp-cloud-api-client.interface';
import { OutgoingWhatsAppMessage } from './types/whatsapp.types';
import { BusinessRepository } from '../database/repositories/business.repository';

@Injectable()
export class WhatsAppCloudApiService implements WhatsAppCloudApiClient {
  private readonly logger = new Logger(WhatsAppCloudApiService.name);
  private readonly config = metaConfig();

  constructor(private readonly businesses: BusinessRepository) {}

  async sendTextMessage(
    message: OutgoingWhatsAppMessage,
    businessId?: string,
  ): Promise<void> {
    try {
      const connection = await this.resolveConnection(businessId);
      await axios.post(
        `${this.config.graphBaseUrl}/${this.config.apiVersion}/${connection.phoneNumberId}/messages`,
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
          maxRedirects: 0,
          headers: {
            Authorization: `Bearer ${connection.accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log('Sent WhatsApp message.');
    } catch (error) {
      this.logger.error({
        event: 'whatsapp.send_failed',
        status: axios.isAxiosError(error) ? error.response?.status : undefined,
      });
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

    const { accessToken, phoneNumberId } = this.config;
    if (!accessToken || !phoneNumberId) {
      throw new Error('The platform WhatsApp connection is not configured.');
    }
    return { accessToken, phoneNumberId };
  }

  private normalizeRecipient(value: string): string {
    return value.replace(/[^\d]/g, '');
  }
}
