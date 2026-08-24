import { Body, Controller, ForbiddenException, Get, Post, Query } from '@nestjs/common';
import type { IncomingWhatsAppMessage, OutgoingWhatsAppMessage } from './types/whatsapp.types';
import { WhatsAppService } from './whatsapp.service';

@Controller('webhooks')
export class WhatsAppWebhookController {
  constructor(private readonly whatsappService: WhatsAppService) {}

  @Get('whatsapp')
  verifyWhatsAppWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (mode === 'subscribe' && verifyToken === process.env.WHATSAPP_VERIFY_TOKEN) {
      return challenge;
    }

    throw new ForbiddenException('Invalid WhatsApp webhook verify token');
  }

  @Post('whatsapp')
  async handleWhatsAppWebhook(
    @Body() body: IncomingWhatsAppMessage,
  ): Promise<OutgoingWhatsAppMessage> {
    return this.whatsappService.processIncomingMessage(body);
  }
}
