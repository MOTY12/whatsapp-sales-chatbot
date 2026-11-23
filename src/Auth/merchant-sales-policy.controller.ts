import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  MerchantCsrfGuard,
  MerchantSessionGuard,
  principal,
  type MerchantRequest,
} from './auth.guards';
import { MerchantLeadsService } from './merchant-leads.service';

@Controller('merchant/businesses/:businessId/sales-policy')
@UseGuards(MerchantSessionGuard)
export class MerchantSalesPolicyController {
  constructor(private readonly leads: MerchantLeadsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  read(@Req() req: MerchantRequest, @Param('businessId') businessId: string) {
    return this.leads.salesPolicy(principal(req), businessId);
  }

  @Patch()
  @UseGuards(MerchantCsrfGuard)
  @Header('Cache-Control', 'no-store')
  save(
    @Req() req: MerchantRequest,
    @Param('businessId') businessId: string,
    @Body() body: unknown,
  ) {
    return this.leads.saveSalesPolicy(principal(req), businessId, body);
  }
}
