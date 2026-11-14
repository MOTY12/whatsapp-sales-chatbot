import {
  Controller,
  Body,
  Header,
  Get,
  Headers,
  Param,
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
} from './auth.guards';
import { MerchantInboxService } from './merchant-inbox.service';

@Controller('merchant/businesses/:businessId/conversations')
@UseGuards(MerchantSessionGuard)
export class MerchantInboxController {
  constructor(private readonly inbox: MerchantInboxService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.inbox.list(principal(request), businessId, limit, cursor);
  }

  @Get(':conversationId')
  @Header('Cache-Control', 'no-store')
  conversation(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.inbox.conversation(
      principal(request),
      businessId,
      conversationId,
    );
  }

  @Get(':conversationId/messages')
  @Header('Cache-Control', 'no-store')
  messages(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.inbox.messages(
      principal(request),
      businessId,
      conversationId,
      limit,
      cursor,
    );
  }

  @Post(':conversationId/takeover')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  takeover(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.inbox.changeControl(
      principal(request),
      businessId,
      conversationId,
      'HUMAN',
    );
  }

  @Post(':conversationId/release')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  release(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.inbox.changeControl(
      principal(request),
      businessId,
      conversationId,
      'AUTO',
    );
  }

  @Post(':conversationId/replies')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  reply(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('conversationId') conversationId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.inbox.reply(
      principal(request),
      businessId,
      conversationId,
      key,
      body,
    );
  }
}
