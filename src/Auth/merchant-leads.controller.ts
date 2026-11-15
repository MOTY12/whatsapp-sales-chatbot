import { Body, Controller, Get, Header, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { MerchantCsrfGuard, MerchantSessionGuard, principal, type MerchantRequest } from './auth.guards';
import { MerchantLeadsService } from './merchant-leads.service';
@Controller('merchant/businesses/:businessId/leads')
@UseGuards(MerchantSessionGuard)
export class MerchantLeadsController {
  constructor(private readonly leads:MerchantLeadsService){}
  @Get() @Header('Cache-Control','no-store') list(@Req() req:MerchantRequest,@Param('businessId') businessId:string,@Query('limit') limit?:string,@Query('cursor') cursor?:string,@Query('status') status?:string){return this.leads.list(principal(req),businessId,limit,cursor,status);}
  @Get(':leadId') @Header('Cache-Control','no-store') detail(@Req() req:MerchantRequest,@Param('businessId') businessId:string,@Param('leadId') leadId:string){return this.leads.detail(principal(req),businessId,leadId);}
  @Patch(':leadId') @UseGuards(MerchantCsrfGuard) @Header('Cache-Control','no-store') update(@Req() req:MerchantRequest,@Param('businessId') businessId:string,@Param('leadId') leadId:string,@Body() body:unknown){return this.leads.update(principal(req),businessId,leadId,body);}
}
