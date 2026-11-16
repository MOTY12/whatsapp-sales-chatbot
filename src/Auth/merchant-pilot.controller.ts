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
import { MerchantPilotService } from './merchant-pilot.service';

@Controller('merchant/businesses/:businessId/pilot')
@UseGuards(MerchantSessionGuard)
export class MerchantPilotController {
  constructor(private readonly pilot: MerchantPilotService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  status(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
  ) {
    return this.pilot.status(principal(request), businessId);
  }

  @Post('enroll')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  enroll(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Body() body: unknown,
  ) {
    return this.pilot.enroll(principal(request), businessId, body);
  }

  @Post(':enrollmentId/revoke')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  revoke(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    return this.pilot.revoke(principal(request), businessId, enrollmentId);
  }
}
