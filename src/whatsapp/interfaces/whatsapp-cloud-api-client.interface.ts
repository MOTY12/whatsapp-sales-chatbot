import { OutgoingWhatsAppMessage } from '../types/whatsapp.types';

export interface WhatsAppCloudApiClient {
  sendTextMessage(
    message: OutgoingWhatsAppMessage,
    businessId?: string,
  ): Promise<string | null>;
}

export class WhatsAppProviderError extends Error {
  constructor(
    readonly definitive: boolean,
    readonly classification: string,
  ) {
    super('WhatsApp provider send failed.');
  }
}

export const WHATSAPP_CLOUD_API_CLIENT = Symbol('WHATSAPP_CLOUD_API_CLIENT');
