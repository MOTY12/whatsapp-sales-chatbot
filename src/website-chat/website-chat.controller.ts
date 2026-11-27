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
  UseFilters,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Response } from 'express';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { websiteAbuseConfig } from '../config/env';
import { WebsiteChatService } from './website-chat.service';
import {
  WebsiteRealtimeService,
  type WebsiteRealtimeEvent,
} from './website-realtime.service';
import {
  WebsiteRateLimitException,
  WebsiteRateLimitFilter,
} from './website-abuse.exception';
import { websiteClientIp } from './website-client-ip';

@Controller('public')
@UseFilters(WebsiteRateLimitFilter)
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
  async config(
    @Param('publicId') publicId: string,
    @Headers('origin') origin: string | undefined,
    @Headers('x-kleva-site-origin') siteOrigin: string | undefined,
    @Req() request: Request,
  ) {
    const abuse = websiteAbuseConfig();
    const identity = await this.chat.publicWidgetAbuseIdentity(
      publicId,
      origin,
      siteOrigin,
    );
    const clientIp = websiteClientIp(
      request.socket.remoteAddress,
      request.get('x-forwarded-for'),
    );
    await this.realtime.consumeRateLimit(
      'config',
      [identity.widgetId, clientIp],
      abuse.configRateLimitPerMinute,
    );
    await this.limitBusiness(identity.businessId);
    return this.chat.publicConfiguration(publicId, origin, siteOrigin);
  }

  @Post('widgets/:publicId/sessions')
  @Header('Cache-Control', 'no-store')
  async createSession(
    @Param('publicId') publicId: string,
    @Headers('origin') origin: string | undefined,
    @Headers('x-kleva-site-origin') siteOrigin: string | undefined,
    @Req() request: Request,
  ) {
    const abuse = websiteAbuseConfig();
    const clientIp = websiteClientIp(
      request.socket.remoteAddress,
      request.get('x-forwarded-for'),
    );
    const identity = await this.chat.publicWidgetAbuseIdentity(
      publicId,
      origin,
      siteOrigin,
    );
    await this.realtime.consumeRateLimit(
      'session',
      [identity.businessId, identity.widgetId, clientIp],
      abuse.sessionRateLimitPerMinute,
    );
    await this.limitBusiness(identity.businessId);
    return this.chat.createSession(publicId, origin, siteOrigin, clientIp);
  }

  @Get('widgets/:publicId/messages')
  @Header('Cache-Control', 'no-store')
  async messages(
    @Param('publicId') publicId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('x-kleva-site-origin') siteOrigin: string | undefined,
    @Query('after') after: string | undefined,
  ) {
    const token = this.bearer(authorization);
    await this.limitVisitorRequest(
      publicId,
      token,
      origin,
      siteOrigin,
      'read',
      websiteAbuseConfig().readRateLimitPerMinute,
    );
    return this.chat.messages(publicId, token, origin, siteOrigin, after);
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
    let releaseLocal: () => void;
    try {
      releaseLocal = this.realtime.reserveConnection(
        `visitor:${context.sessionId}`,
        websiteAbuseConfig().sseMaxConnectionsPerSession,
      );
    } catch {
      throw new WebsiteRateLimitException(30);
    }
    let lease: Awaited<
      ReturnType<WebsiteRealtimeService['acquireConnectionLease']>
    >;
    try {
      const abuse = websiteAbuseConfig();
      await this.realtime.consumeRateLimit(
        'sse_reconnect',
        [context.businessId, context.sessionId],
        abuse.reconnectRateLimitPerMinute,
      );
      await this.limitBusiness(context.businessId);
      lease = await this.realtime.acquireConnectionLease(
        context.sessionId,
        abuse.sseMaxConnectionsPerSession,
        abuse.sseLeaseTtlSeconds,
      );
    } catch (error) {
      releaseLocal();
      throw error;
    }
    if (request.aborted || response.destroyed) {
      releaseLocal();
      await lease.release();
      return;
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
      leaseRenewal?: ReturnType<typeof setInterval>;
    } = {};
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(timers.heartbeat);
      clearInterval(timers.revalidate);
      clearInterval(timers.leaseRenewal);
      unsubscribe?.();
      releaseLocal();
      void lease.release();
    };
    const writeFrame = (frame: string) => {
      if (!closed && !response.destroyed && !response.writableEnded) {
        try {
          response.write(frame);
        } catch {
          cleanup();
          response.destroy();
        }
      }
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
    let subscribing: Promise<boolean> | undefined;
    const connect = async (): Promise<boolean> => {
      if (closed) return false;
      if (unsubscribe) return true;
      if (subscribing) return subscribing;
      subscribing = this.realtime
        .subscribe(
          {
            businessId: context.businessId,
            conversationId: context.conversationId,
            visitorSessionId: context.sessionId,
          },
          onEvent,
        )
        .then((createdUnsubscribe) => {
          if (closed) createdUnsubscribe();
          else unsubscribe = createdUnsubscribe;
          return !closed;
        })
        .catch(() => false)
        .finally(() => {
          subscribing = undefined;
        });
      return subscribing;
    };
    response.on('close', cleanup);
    response.on('finish', cleanup);
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
    timers.leaseRenewal = setInterval(() => {
      void lease.renew().then((renewed) => {
        if (!renewed && !closed) response.end();
      });
    }, websiteAbuseConfig().sseLeaseRenewSeconds * 1000);
    timers.leaseRenewal.unref();
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
        .catch(() => {
          if (!closed) response.end();
        })
        .finally(() => {
          validating = false;
        });
    }, 30000);
    timers.revalidate.unref();
  }

  @Post('widgets/:publicId/messages')
  @Header('Cache-Control', 'no-store')
  async submitMessage(
    @Param('publicId') publicId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('x-kleva-site-origin') siteOrigin: string | undefined,
    @Body() body: unknown,
  ) {
    const token = this.bearer(authorization);
    await this.limitVisitorRequest(
      publicId,
      token,
      origin,
      siteOrigin,
      'message',
      websiteAbuseConfig().messageRateLimitPerMinute,
    );
    return this.chat.submitMessage(publicId, token, origin, siteOrigin, body);
  }

  @Post('widgets/:publicId/contact')
  @Header('Cache-Control', 'no-store')
  async contact(
    @Param('publicId') publicId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('x-kleva-site-origin') siteOrigin: string | undefined,
    @Body() body: unknown,
  ) {
    const token = this.bearer(authorization);
    await this.limitVisitorRequest(
      publicId,
      token,
      origin,
      siteOrigin,
      'contact',
      websiteAbuseConfig().contactRateLimitPerMinute,
    );
    return this.chat.submitContact(publicId, token, origin, siteOrigin, body);
  }

  @Post('widgets/:publicId/handoff')
  @Header('Cache-Control', 'no-store')
  async handoff(
    @Param('publicId') publicId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('x-kleva-site-origin') siteOrigin: string | undefined,
  ) {
    const token = this.bearer(authorization);
    await this.limitVisitorRequest(
      publicId,
      token,
      origin,
      siteOrigin,
      'handoff',
      websiteAbuseConfig().handoffRateLimitPerMinute,
    );
    return this.chat.requestHandoff(publicId, token, origin, siteOrigin);
  }

  @Post('widgets/:publicId/session/end')
  @Header('Cache-Control', 'no-store')
  async end(
    @Param('publicId') publicId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('x-kleva-site-origin') siteOrigin: string | undefined,
  ) {
    const token = this.bearer(authorization);
    await this.limitVisitorRequest(
      publicId,
      token,
      origin,
      siteOrigin,
      'session_end',
      websiteAbuseConfig().sessionEndRateLimitPerMinute,
    );
    return this.chat.endSession(publicId, token, origin, siteOrigin);
  }

  @Post('widgets/:publicId/typing')
  @Header('Cache-Control', 'no-store')
  async visitorTyping(
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
    const token = this.bearer(authorization);
    await this.limitVisitorRequest(
      publicId,
      token,
      origin,
      siteOrigin,
      'typing',
      websiteAbuseConfig().typingRateLimitPerMinute,
    );
    return this.chat.publishVisitorTyping(
      publicId,
      token,
      origin,
      siteOrigin,
      active,
    );
  }

  private async limitVisitorRequest(
    publicId: string,
    token: string,
    origin: string | undefined,
    siteOrigin: string | undefined,
    category: string,
    limit: number,
  ) {
    const identity = await this.chat.visitorEventContext(
      publicId,
      token,
      origin,
      siteOrigin,
    );
    await this.realtime.consumeRateLimit(
      category,
      [identity.businessId, identity.sessionId],
      limit,
    );
    await this.limitBusiness(identity.businessId);
    return identity;
  }

  private limitBusiness(businessId: string) {
    return this.realtime.consumeRateLimit(
      'business_traffic',
      [businessId],
      websiteAbuseConfig().businessRateLimitPerMinute,
    );
  }

  private bearer(header?: string) {
    return header?.match(/^Bearer ([A-Za-z0-9_-]{40,100})$/)?.[1] ?? '';
  }
}
