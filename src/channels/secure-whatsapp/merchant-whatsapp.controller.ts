import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
} from '../../Auth/auth.guards';
import { MerchantWhatsAppService } from './merchant-whatsapp.service';

@Controller('merchant/businesses/:businessId/whatsapp')
@UseGuards(MerchantSessionGuard)
export class MerchantWhatsAppController {
  constructor(private readonly service: MerchantWhatsAppService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  status(@Req() request: MerchantRequest, @Param('businessId') id: string) {
    return this.service.status(principal(request), id);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  connect(
    @Req() request: MerchantRequest,
    @Param('businessId') id: string,
    @Body() body: unknown,
  ) {
    return this.service.connect(principal(request), id, body);
  }

  @Patch('credential')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  rotate(
    @Req() request: MerchantRequest,
    @Param('businessId') id: string,
    @Body() body: unknown,
  ) {
    return this.service.connect(principal(request), id, body, true);
  }

  @Delete()
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  disconnect(@Req() request: MerchantRequest, @Param('businessId') id: string) {
    return this.service.disconnect(principal(request), id);
  }
}
