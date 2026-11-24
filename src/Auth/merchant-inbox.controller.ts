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
  Res,
  UseGuards,
  HttpException,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  MerchantCsrfGuard,
  MerchantSessionGuard,
  principal,
  type MerchantRequest,
} from './auth.guards';
import { MerchantInboxService } from './merchant-inbox.service';
import {
  WebsiteRealtimeService,
  type WebsiteRealtimeEvent,
} from '../website-chat/website-realtime.service';

@Controller('merchant/businesses/:businessId/conversations')
@UseGuards(MerchantSessionGuard)
export class MerchantInboxController {
  constructor(
    private readonly inbox: MerchantInboxService,
    private readonly realtime: WebsiteRealtimeService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('channel') channel?: string,
  ) {
    return this.inbox.list(
      principal(request),
      businessId,
      limit,
      cursor,
      status,
      search,
      channel,
    );
  }

  @Get('events')
  @Header('Cache-Control', 'no-cache, no-transform')
  async events(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Res() response: Response,
  ) {
    const actor = principal(request);
    await this.inbox.authorizeRealtime(actor, businessId);
    let release: () => void;
    try {
      release = this.realtime.reserveConnection(
        `merchant:${actor.accountId}`,
        6,
      );
    } catch {
      throw new HttpException('Too many realtime connections.', 429);
    }
    response.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    let closed = false;
    let unsubscribe: (() => void) | undefined;
    const timers: {
      heartbeat?: ReturnType<typeof setInterval>;
      revalidate?: ReturnType<typeof setInterval>;
    } = {};
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(timers.heartbeat);
      clearInterval(timers.revalidate);
      unsubscribe?.();
      release();
    };
    const writeFrame = (frame: string) => {
      if (!closed && !response.write(frame)) response.end();
    };
    const onEvent = (event: WebsiteRealtimeEvent) => {
      const projection = {
        version: event.version,
        id: event.id,
        type: event.type,
        conversationId: event.conversationId,
        ...(event.messageId ? { messageId: event.messageId } : {}),
        ...(event.actor ? { actor: event.actor } : {}),
        occurredAt: event.occurredAt,
      };
      writeFrame(
        `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(projection)}\n\n`,
      );
    };
    const connect = async (): Promise<boolean> => {
      if (closed) return false;
      if (unsubscribe) return true;
      try {
        unsubscribe = await this.realtime.subscribe({ businessId }, onEvent);
        return true;
      } catch {
        // The existing inbox polling loop recovers durable updates.
        return false;
      }
    };
    response.on('close', cleanup);
    const realtimeReady = await connect();
    if (closed) return;
    writeFrame(
      `event: ready\ndata: ${JSON.stringify({ version: 1, realtime: realtimeReady })}\n\n`,
    );
    timers.heartbeat = setInterval(() => {
      if (!closed) {
        writeFrame(': keepalive\n\n');
        if (!unsubscribe)
          void connect().then((ready) => {
            if (ready && !closed)
              writeFrame(
                'event: ready\ndata: {"version":1,"realtime":true}\n\n',
              );
          });
      }
    }, 15000);
    timers.heartbeat.unref();
    let validating = false;
    timers.revalidate = setInterval(() => {
      if (closed || validating) return;
      validating = true;
      void this.inbox
        .authorizeRealtime(actor, businessId)
        .catch(() => {
          if (!closed) response.end();
        })
        .finally(() => {
          validating = false;
        });
    }, 30000);
    timers.revalidate.unref();
  }

  @Get('members')
  @Header('Cache-Control', 'no-store')
  members(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
  ) {
    return this.inbox.members(principal(request), businessId);
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

  @Post(':conversationId/typing')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  typing(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('conversationId') conversationId: string,
    @Body() body: unknown,
  ) {
    const active =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as { active?: unknown }).active
        : undefined;
    if (typeof active !== 'boolean')
      throw new BadRequestException('Typing status must be true or false.');
    return this.inbox.publishAgentTyping(
      principal(request),
      businessId,
      conversationId,
      active,
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

  @Post(':conversationId/read')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  markRead(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.inbox.markRead(principal(request), businessId, conversationId);
  }

  @Post(':conversationId/assignee')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  assign(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('conversationId') conversationId: string,
    @Body() body: unknown,
  ) {
    return this.inbox.assign(
      principal(request),
      businessId,
      conversationId,
      body,
    );
  }

  @Get(':conversationId/notes')
  @Header('Cache-Control', 'no-store')
  notes(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.inbox.notes(principal(request), businessId, conversationId);
  }

  @Post(':conversationId/notes')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  addNote(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('conversationId') conversationId: string,
    @Body() body: unknown,
  ) {
    return this.inbox.addNote(
      principal(request),
      businessId,
      conversationId,
      body,
    );
  }

  @Post(':conversationId/status')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantCsrfGuard)
  setStatus(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
    @Param('conversationId') conversationId: string,
    @Body() body: unknown,
  ) {
    return this.inbox.setStatus(
      principal(request),
      businessId,
      conversationId,
      body,
    );
  }
}
