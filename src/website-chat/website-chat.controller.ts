import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Header,
} from '@nestjs/common';
import type { Request } from 'express';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebsiteChatService } from './website-chat.service';

@Controller('public')
export class WebsiteChatController {
  constructor(private readonly chat: WebsiteChatService) {}

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

  private bearer(header?: string) {
    return header?.match(/^Bearer ([A-Za-z0-9_-]{40,100})$/)?.[1] ?? '';
  }
}
