import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  MerchantCsrfGuard,
  MerchantSessionGuard,
  principal,
  type MerchantRequest,
} from './auth.guards';
import { MerchantLearningService } from './merchant-learning.service';

@Controller('merchant/businesses/:businessId/learning/gaps')
@UseGuards(MerchantSessionGuard)
export class MerchantLearningController {
  constructor(private readonly learning: MerchantLearningService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.learning.list(principal(request), businessId, status, limit);
  }

  @Patch(':clusterId')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  updateStatus(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('clusterId') clusterId: string,
    @Body() body: unknown,
  ) {
    return this.learning.updateStatus(
      principal(request),
      businessId,
      clusterId,
      body,
    );
  }
}
