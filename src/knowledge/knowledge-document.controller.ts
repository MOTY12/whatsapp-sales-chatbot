import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
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
} from '../Auth/auth.guards';
import { KnowledgeDocumentUploadService } from './knowledge-document-upload.service';

@Controller('merchant/businesses/:businessId/knowledge-documents')
@UseGuards(MerchantSessionGuard)
export class KnowledgeDocumentController {
  constructor(private readonly documents: KnowledgeDocumentUploadService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
  ) {
    return this.documents.list(principal(request), businessId);
  }

  @Post('uploads')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  create(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.documents.create(principal(request), businessId, key, body);
  }

  @Post('uploads/:revisionId/complete')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  complete(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('revisionId') revisionId: string,
  ) {
    return this.documents.complete(principal(request), businessId, revisionId);
  }

  @Post(':documentId/publish')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  publish(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.documents.publish(principal(request), businessId, documentId);
  }

  @Post(':documentId/unpublish')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  unpublish(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.documents.unpublish(principal(request), businessId, documentId);
  }
}
