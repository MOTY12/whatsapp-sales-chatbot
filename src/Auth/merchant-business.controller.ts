import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Patch,
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
import { MerchantBusinessService } from './merchant-business.service';

@Controller('merchant/businesses')
@UseGuards(MerchantSessionGuard)
export class MerchantBusinessController {
  constructor(private readonly businesses: MerchantBusinessService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  create(
    @Req() request: MerchantRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.businesses.create(principal(request), key, body);
  }

  @Get(':businessId')
  @Header('Cache-Control', 'no-store')
  read(@Req() request: MerchantRequest, @Param('businessId') id: string) {
    return this.businesses.read(principal(request), id);
  }

  @Patch(':businessId')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  update(
    @Req() request: MerchantRequest,
    @Param('businessId') id: string,
    @Body() body: unknown,
  ) {
    return this.businesses.update(principal(request), id, body);
  }
}
