import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  MerchantCsrfGuard,
  MerchantSessionGuard,
  principal,
  type MerchantRequest,
} from '../Auth/auth.guards';
import { ProductService } from './product.service';
import { KnowledgeIndexingService } from '../knowledge/knowledge-indexing-api.service';

@Controller('merchant/businesses/:businessId/products')
@UseGuards(MerchantSessionGuard)
export class ProductController {
  constructor(
    private readonly products: ProductService,
    private readonly indexing: KnowledgeIndexingService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.products.list(principal(request), businessId, limit, offset);
  }

  @Get(':productId')
  @Header('Cache-Control', 'no-store')
  detail(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    return this.products.detail(principal(request), businessId, productId);
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
    return this.products.create(principal(request), businessId, key, body);
  }

  @Patch(':productId')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  update(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
    @Body() body: unknown,
  ) {
    return this.products.update(
      principal(request),
      businessId,
      productId,
      body,
    );
  }

  @Post(':productId/publish')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  publish(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    return this.products.publish(principal(request), businessId, productId);
  }

  @Post(':productId/unpublish')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  unpublish(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    return this.products.unpublish(principal(request), businessId, productId);
  }

  @Get(':productId/index-status')
  @Header('Cache-Control', 'no-store')
  indexStatus(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    return this.indexing.status(
      principal(request),
      businessId,
      'PRODUCT',
      productId,
    );
  }

  @Post(':productId/reindex')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  reindex(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.indexing.request(
      principal(request),
      businessId,
      key,
      'PRODUCT',
      productId,
    );
  }
}
