import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ChannelConnectionService } from '../channels/channel-connection.service';
import {
  CredentialCipher,
  type CredentialEnvelope,
} from '../channels/secure-whatsapp/credential-cipher';
import { metaConfig } from '../config/env';
import type { WhatsAppCloudApiClient } from './interfaces/whatsapp-cloud-api-client.interface';
import { OutgoingWhatsAppMessage } from './types/whatsapp.types';
import { BusinessRepository } from '../database/repositories/business.repository';

@Injectable()
export class WhatsAppCloudApiService implements WhatsAppCloudApiClient {
  private readonly logger = new Logger(WhatsAppCloudApiService.name);
  private readonly config = metaConfig();

  constructor(
    private readonly businesses: BusinessRepository,
    private readonly channels: ChannelConnectionService,
    private readonly cipher: CredentialCipher,
    @InjectDataSource() private readonly database: DataSource,
  ) {}

  async sendTextMessage(
    message: OutgoingWhatsAppMessage,
    businessId?: string,
  ): Promise<void> {
    let connection:
      | Awaited<ReturnType<WhatsAppCloudApiService['resolveConnection']>>
      | undefined;
    try {
      connection = await this.resolveConnection(businessId);
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
          timeout: 10000,
          headers: {
            Authorization: `Bearer ${connection.accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log('Sent WhatsApp message.');
    } catch (error) {
      if (
        businessId &&
        connection?.revision !== undefined &&
        axios.isAxiosError<{ error?: { code?: number } }>(error) &&
        error.response?.data?.error?.code === 190
      ) {
        try {
          await this.database.query(
            `UPDATE public.whatsapp_credentials SET expires_at = now(), revision = revision + 1
             WHERE business_id = $1 AND revision = $2`,
            [businessId, connection.revision],
          );
        } catch {
          this.logger.error('Could not fence the revoked WhatsApp credential.');
        }
      }
      this.logger.error({
        event: 'whatsapp.send_failed',
        status: axios.isAxiosError(error) ? error.response?.status : undefined,
      });
    }
  }

  private async resolveConnection(businessId?: string): Promise<{
    accessToken: string;
    phoneNumberId: string;
    revision?: number;
  }> {
    if (businessId) {
      const [secure] = await this.database.query<
        {
          id: string;
          asset: string;
          envelope: CredentialEnvelope | null;
          revision: number;
          usable: boolean;
        }[]
      >(
        `SELECT c.id, c."externalAssetId" AS asset, w.envelope, w.revision,
           (w.envelope IS NOT NULL AND (w.expires_at IS NULL OR w.expires_at > now())) AS usable
         FROM public.whatsapp_credentials w JOIN public.channel_connections c ON c.id = w.connection_id
         WHERE w.business_id = $1`,
        [businessId],
      );
      if (secure) {
        const route =
          secure.usable &&
          (await this.channels.resolve({
            provider: 'whatsapp',
            externalAssetId: secure.asset,
          }));
        if (
          !secure.envelope ||
          !route ||
          route.connectionId !== secure.id ||
          route.businessId !== businessId
        ) {
          throw new Error('Secure WhatsApp connection is unavailable.');
        }
        return {
          accessToken: this.cipher.decrypt(
            secure.envelope,
            businessId,
            secure.id,
          ),
          phoneNumberId: secure.asset,
          revision: secure.revision,
        };
      }
      const business = await this.businesses.findById(businessId);
      if (!business?.accessToken || !business.phoneNumberId) {
        throw new Error(
          'This business does not have an active WhatsApp connection.',
        );
      }
      const route = await this.channels.resolve({
        provider: 'whatsapp',
        externalAssetId: business.phoneNumberId,
      });
      if (route?.businessId !== businessId)
        throw new Error('Legacy WhatsApp connection is unavailable.');
      return {
        accessToken: business.accessToken,
        phoneNumberId: business.phoneNumberId,
      };
    }

    const { accessToken, phoneNumberId } = this.config;
    if (!accessToken || !phoneNumberId) {
      throw new Error('The platform WhatsApp connection is not configured.');
    }
    const [reserved] = await this.database.query<{ reserved: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM public.channel_connections
         WHERE provider = 'whatsapp' AND "externalAssetId" = $1 AND NOT "legacyBackfill"
       ) AS reserved`,
      [phoneNumberId],
    );
    if (reserved.reserved)
      throw new Error('Platform asset is reserved for a tenant.');
    return { accessToken, phoneNumberId };
  }

  private normalizeRecipient(value: string): string {
    return value.replace(/[^\d]/g, '');
  }
}
