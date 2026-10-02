import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
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
    if (
      mode === 'subscribe' &&
      verifyToken === process.env.WHATSAPP_VERIFY_TOKEN
    ) {
      return challenge;
    }

    throw new ForbiddenException('Invalid WhatsApp webhook verify token');
  }

  @Post('whatsapp')
  async handleWhatsAppWebhook(
    @Body() body: unknown,
    @Headers('x-hub-signature-256') signature?: string,
    @Req() request?: Request & { rawBody?: Buffer },
  ): Promise<{ received: true }> {
    this.assertValidSignature(body, signature, request?.rawBody);
    await this.whatsappService.handleWebhookPayload(body);

    return { received: true };
  }

  private assertValidSignature(
    body: unknown,
    signature?: string,
    rawBody?: Buffer,
  ): void {
    const secret = process.env.META_APP_SECRET?.trim();
    if (!secret) {
      throw new ForbiddenException(
        'META_APP_SECRET must be configured to receive webhooks.',
      );
    }
    if (!signature?.startsWith('sha256=')) {
      throw new ForbiddenException('Missing WhatsApp webhook signature.');
    }
    const payload = rawBody ?? Buffer.from(JSON.stringify(body), 'utf8');
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    const actual = signature.slice('sha256='.length);
    const expectedBuffer = Buffer.from(expected, 'hex');
    const actualBuffer = Buffer.from(actual, 'hex');
    if (
      expectedBuffer.length !== actualBuffer.length ||
      !timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      throw new ForbiddenException('Invalid WhatsApp webhook signature.');
    }
  }
}
