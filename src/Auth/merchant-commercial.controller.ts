import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  MerchantCsrfGuard,
  MerchantSessionGuard,
  principal,
  type MerchantRequest,
} from './auth.guards';
import { MerchantCommercialService } from './merchant-commercial.service';

@Controller('merchant/businesses/:businessId/commercial')
@UseGuards(MerchantSessionGuard)
export class MerchantCommercialController {
  constructor(private readonly commercial: MerchantCommercialService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  read(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
  ) {
    return this.commercial.read(principal(request), businessId);
  }

  @Get('readiness')
  @Header('Cache-Control', 'no-store')
  readiness(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
  ) {
    return this.commercial.readiness(principal(request), businessId);
  }

  @Post('offers/:offerId/accept')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  accept(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('offerId') offerId: string,
    @Body() body: unknown,
  ) {
    return this.commercial.accept(
      principal(request),
      businessId,
      offerId,
      body,
    );
  }
}
