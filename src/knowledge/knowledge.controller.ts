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
} from '../Auth/auth.guards';
import { KnowledgeFaqService } from './knowledge-faq.service';

@Controller('merchant/businesses/:businessId/faqs')
@UseGuards(MerchantSessionGuard)
export class KnowledgeController {
  constructor(private readonly faqs: KnowledgeFaqService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
  ) {
    return this.faqs.list(principal(request), businessId);
  }

  @Get(':faqId')
  @Header('Cache-Control', 'no-store')
  detail(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('faqId') faqId: string,
  ) {
    return this.faqs.detail(principal(request), businessId, faqId);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  create(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.faqs.create(principal(request), businessId, key, body);
  }

  @Patch(':faqId')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  update(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('faqId') faqId: string,
    @Body() body: unknown,
  ) {
    return this.faqs.update(principal(request), businessId, faqId, body);
  }

  @Post(':faqId/publish')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  publish(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('faqId') faqId: string,
  ) {
    return this.faqs.publish(principal(request), businessId, faqId);
  }

  @Post(':faqId/unpublish')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  unpublish(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('faqId') faqId: string,
  ) {
    return this.faqs.unpublish(principal(request), businessId, faqId);
  }
}
