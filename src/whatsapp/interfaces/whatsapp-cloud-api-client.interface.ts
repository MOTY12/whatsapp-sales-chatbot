import { OutgoingWhatsAppMessage } from '../types/whatsapp.types';

export interface WhatsAppCloudApiClient {
  sendTextMessage(message: OutgoingWhatsAppMessage): Promise<void>;
}

export const WHATSAPP_CLOUD_API_CLIENT = Symbol('WHATSAPP_CLOUD_API_CLIENT');
