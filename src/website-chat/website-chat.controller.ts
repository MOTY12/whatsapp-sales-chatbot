import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  Header,
  HttpException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Response } from 'express';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebsiteChatService } from './website-chat.service';
import {
  WebsiteRealtimeService,
  type WebsiteRealtimeEvent,
} from './website-realtime.service';

@Controller('public')
export class WebsiteChatController {
  constructor(
    private readonly chat: WebsiteChatService,
    private readonly realtime: WebsiteRealtimeService,
  ) {}

  @Get('widget.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  widgetScript() {
    return readFile(join(__dirname, 'assets', 'widget.js'), 'utf8');
  }

  @Get('widget-frame.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  widgetFrame() {
    return readFile(join(__dirname, 'assets', 'widget-frame.html'), 'utf8');
  }

  @Get('widget-frame.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  widgetFrameScript() {
    return readFile(join(__dirname, 'assets', 'widget-frame.js'), 'utf8');
  }

  @Get('widget-frame.css')
  @Header('Content-Type', 'text/css; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  widgetFrameStyles() {
    return readFile(join(__dirname, 'assets', 'widget-frame.css'), 'utf8');
  }

  @Get('widgets/:publicId/config')
  @Header('Cache-Control', 'no-store')
  config(
    @Param('publicId') publicId: string,
    @Headers('origin') origin: string | undefined,
    @Headers('x-kleva-site-origin') siteOrigin: string | undefined,
  ) {
    return this.chat.publicConfiguration(publicId, origin, siteOrigin);
  }

  @Post('widgets/:publicId/sessions')
  @Header('Cache-Control', 'no-store')
  createSession(
    @Param('publicId') publicId: string,
    @Headers('origin') origin: string | undefined,
    @Headers('x-kleva-site-origin') siteOrigin: string | undefined,
    @Req() request: Request,
  ) {
    return this.chat.createSession(
      publicId,
      origin,
      siteOrigin,
      request.socket.remoteAddress,
    );
  }

  @Get('widgets/:publicId/messages')
  @Header('Cache-Control', 'no-store')
  messages(
    @Param('publicId') publicId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('x-kleva-site-origin') siteOrigin: string | undefined,
    @Query('after') after: string | undefined,
  ) {
    return this.chat.messages(
      publicId,
      this.bearer(authorization),
      origin,
      siteOrigin,
      after,
    );
  }

  @Get('widgets/:publicId/events')
  async visitorEvents(
    @Param('publicId') publicId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('x-kleva-site-origin') siteOrigin: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const token = this.bearer(authorization);
    const context = await this.chat.visitorEventContext(
      publicId,
      token,
      origin,
      siteOrigin,
    );
    let release: () => void;
    try {
      release = this.realtime.reserveConnection(
        `visitor:${context.sessionId}`,
        4,
      );
    } catch {
      throw new HttpException('Too many chat connections.', 429);
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
        ...(event.messageId ? { messageId: event.messageId } : {}),
        ...(event.actor ? { actor: event.actor } : {}),
        occurredAt: event.occurredAt,
      };
      writeFrame(
        `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(projection)}\n\n`,
      );
      if (event.type === 'session.revoked') response.end();
    };
    const connect = async (): Promise<boolean> => {
      if (closed) return false;
      if (unsubscribe) return true;
      try {
        unsubscribe = await this.realtime.subscribe(
          {
            businessId: context.businessId,
            conversationId: context.conversationId,
          },
          onEvent,
        );
        return true;
      } catch {
        // Durable history polling remains active during Redis outages.
        return false;
      }
    };
    response.on('close', cleanup);
    request.on('aborted', cleanup);
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
      void this.chat
        .validateVisitorEventContext(publicId, token, origin, siteOrigin)
        .then((valid) => {
          if (!valid && !closed) {
            writeFrame(`event: session.revoked\ndata: {"version":1}\n\n`);
            response.end();
          }
        })
        .finally(() => {
          validating = false;
        });
    }, 30000);
    timers.revalidate.unref();
  }

  @Post('widgets/:publicId/messages')
  @Header('Cache-Control', 'no-store')
  submitMessage(
    @Param('publicId') publicId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('x-kleva-site-origin') siteOrigin: string | undefined,
    @Body() body: unknown,
  ) {
    return this.chat.submitMessage(
      publicId,
      this.bearer(authorization),
      origin,
      siteOrigin,
      body,
    );
  }

  @Post('widgets/:publicId/contact')
  @Header('Cache-Control', 'no-store')
  contact(
    @Param('publicId') publicId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('x-kleva-site-origin') siteOrigin: string | undefined,
    @Body() body: unknown,
  ) {
    return this.chat.submitContact(
      publicId,
      this.bearer(authorization),
      origin,
      siteOrigin,
      body,
    );
  }

  @Post('widgets/:publicId/handoff')
  @Header('Cache-Control', 'no-store')
  handoff(
    @Param('publicId') publicId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('x-kleva-site-origin') siteOrigin: string | undefined,
  ) {
    return this.chat.requestHandoff(
      publicId,
      this.bearer(authorization),
      origin,
      siteOrigin,
    );
  }

  @Post('widgets/:publicId/session/end')
  @Header('Cache-Control', 'no-store')
  end(
    @Param('publicId') publicId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('x-kleva-site-origin') siteOrigin: string | undefined,
  ) {
    return this.chat.endSession(
      publicId,
      this.bearer(authorization),
      origin,
      siteOrigin,
    );
  }

  @Post('widgets/:publicId/typing')
  @Header('Cache-Control', 'no-store')
  visitorTyping(
    @Param('publicId') publicId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('x-kleva-site-origin') siteOrigin: string | undefined,
    @Body() body: unknown,
  ) {
    const active =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as { active?: unknown }).active
        : undefined;
    return this.chat.publishVisitorTyping(
      publicId,
      this.bearer(authorization),
      origin,
      siteOrigin,
      active,
    );
  }

  private bearer(header?: string) {
    return header?.match(/^Bearer ([A-Za-z0-9_-]{40,100})$/)?.[1] ?? '';
  }
}
