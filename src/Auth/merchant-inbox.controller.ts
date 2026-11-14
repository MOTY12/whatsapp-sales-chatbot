import {
  Controller,
  Body,
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
  list(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.inbox.list(principal(request), businessId, limit, cursor);
  }

  @Get(':conversationId')
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
