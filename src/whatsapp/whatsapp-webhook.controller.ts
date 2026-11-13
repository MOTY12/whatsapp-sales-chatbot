import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Headers,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { metaConfig } from '../config/env';
import { WhatsAppWebhookIntake } from './webhook-intake.service';

@Controller('webhooks')
export class WhatsAppWebhookController {
  private readonly config = metaConfig();

  constructor(private readonly intake: WhatsAppWebhookIntake) {}

  @Get('whatsapp')
  verifyWhatsAppWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (
      mode === 'subscribe' &&
      this.config.verifyToken &&
      verifyToken === this.config.verifyToken
    ) {
      return challenge;
    }

    throw new ForbiddenException('Invalid WhatsApp webhook verify token');
  }

  @Post('whatsapp')
  @HttpCode(200)
  async handleWhatsAppWebhook(
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() request: Request & { rawBody?: Buffer },
  ): Promise<{ received: true }> {
    const secret = this.config.appSecret;
    const raw = request.rawBody;
    if (
      !secret ||
      !raw?.length ||
      !/^sha256=[0-9a-f]{64}$/i.test(signature ?? '') ||
      (request.headers['content-encoding'] &&
        request.headers['content-encoding'] !== 'identity')
    ) {
      throw new ForbiddenException(
        'WhatsApp webhook signature could not be verified.',
      );
    }
    const expected = createHmac('sha256', secret).update(raw).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature!.slice(7), 'hex'))) {
      throw new ForbiddenException(
        'WhatsApp webhook signature could not be verified.',
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
      throw new BadRequestException('Invalid WhatsApp webhook JSON.');
    }
    await this.intake.accept(body);
    return { received: true };
  }
}
