import {
  Body,
  Controller,
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
} from './auth.guards';
import { MerchantAssistantService } from './merchant-assistant.service';

@Controller('merchant/businesses/:businessId/assistant')
@UseGuards(MerchantSessionGuard)
export class MerchantAssistantController {
  constructor(private readonly assistant: MerchantAssistantService) {}

  @Get('configuration')
  @Header('Cache-Control', 'no-store')
  configuration(
    @Req() req: MerchantRequest,
    @Param('businessId') businessId: string,
  ) {
    return this.assistant.getConfiguration(principal(req), businessId);
  }

  @Patch('configuration')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  updateConfiguration(
    @Req() req: MerchantRequest,
    @Param('businessId') businessId: string,
    @Body() body: unknown,
  ) {
    return this.assistant.updateConfiguration(principal(req), businessId, body);
  }

  @Post('playground')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  testMessage(
    @Req() req: MerchantRequest,
    @Param('businessId') businessId: string,
    @Body() body: unknown,
  ) {
    return this.assistant.testMessage(principal(req), businessId, body);
  }
}
