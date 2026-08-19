import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { MetaEmbeddedSignupCallbackQuery } from './types/meta-embedded-signup.types';
import { MetaEmbeddedSignupService } from './meta-embedded-signup.service';

@Controller('meta/embedded-signup')
export class MetaEmbeddedSignupController {
  constructor(private readonly metaEmbeddedSignupService: MetaEmbeddedSignupService) {}

  @Get('callback')
  async callback(
    @Query() query: MetaEmbeddedSignupCallbackQuery,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.metaEmbeddedSignupService.handleCallback(query);

    response.status(result.statusCode).type('html').send(result.html);
  }
}