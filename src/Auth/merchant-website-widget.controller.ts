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
import { MerchantWebsiteWidgetService } from './merchant-website-widget.service';

@Controller('merchant/businesses/:businessId/website-widget')
@UseGuards(MerchantSessionGuard)
export class MerchantWebsiteWidgetController {
  constructor(private readonly widgets: MerchantWebsiteWidgetService) {}
  @Header('Cache-Control', 'no-store')
  @Get()
  list(@Req() req: MerchantRequest, @Param('businessId') businessId: string) {
    return this.widgets.list(principal(req), businessId);
  }
  @Header('Cache-Control', 'no-store')
  @Post()
  @UseGuards(MerchantCsrfGuard)
  create(
    @Req() req: MerchantRequest,
    @Param('businessId') businessId: string,
    @Body() body: unknown,
  ) {
    return this.widgets.create(principal(req), businessId, body);
  }
  @Header('Cache-Control', 'no-store')
  @Patch(':widgetId/domains')
  @UseGuards(MerchantCsrfGuard)
  domains(
    @Req() req: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('widgetId') widgetId: string,
    @Body() body: unknown,
  ) {
    return this.widgets.domains(principal(req), businessId, widgetId, body);
  }
  @Header('Cache-Control', 'no-store')
  @Patch(':widgetId')
  @UseGuards(MerchantCsrfGuard)
  update(
    @Req() req: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('widgetId') widgetId: string,
    @Body() body: unknown,
  ) {
    return this.widgets.update(principal(req), businessId, widgetId, body);
  }
  @Header('Cache-Control', 'no-store')
  @Post(':widgetId/rotate')
  @UseGuards(MerchantCsrfGuard)
  rotate(
    @Req() req: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('widgetId') widgetId: string,
  ) {
    return this.widgets.rotate(principal(req), businessId, widgetId);
  }
}
