import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  MerchantSessionGuard,
  principal,
  type MerchantRequest,
} from '../Auth/auth.guards';
import { MerchantAnalyticsService } from './merchant-analytics.service';

@Controller('merchant/businesses/:businessId/analytics')
@UseGuards(MerchantSessionGuard)
export class MerchantAnalyticsController {
  constructor(private readonly analytics: MerchantAnalyticsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  report(
    @Req() req: MerchantRequest,
    @Param('businessId') businessId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('timezone') timezone?: string,
    @Query('channel') channel?: string,
    @Query('preset') preset?: string,
  ) {
    return this.analytics.report(principal(req), businessId, {
      from,
      to,
      timezone,
      channel,
      preset,
    });
  }
}
