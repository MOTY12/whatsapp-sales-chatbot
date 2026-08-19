import { Body, Controller, Post } from '@nestjs/common';
import type { IncomingWhatsAppMessage, OutgoingWhatsAppMessage } from './types/whatsapp.types';
import { WhatsAppService } from './whatsapp.service';

@Controller('webhooks')
export class WhatsAppWebhookController {
  constructor(private readonly whatsappService: WhatsAppService) {}

  @Post('whatsapp')
  async handleWhatsAppWebhook(
    @Body() body: IncomingWhatsAppMessage,
  ): Promise<OutgoingWhatsAppMessage> {
    return this.whatsappService.processIncomingMessage(body);
  }
}