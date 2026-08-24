import { Body, Controller, ForbiddenException, Get, Post, Query } from '@nestjs/common';
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
  async handleWhatsAppWebhook(@Body() body: unknown): Promise<{ received: true }> {
    console.log('Received WhatsApp webhook payload:', body);
    await this.whatsappService.handleWebhookPayload(body);

    return { received: true };
  }
}
