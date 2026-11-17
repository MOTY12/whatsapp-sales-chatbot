import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Redirect,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import {
  cookie,
  cookieNames,
  MerchantCsrfGuard,
  MerchantSessionGuard,
  principal,
  type MerchantRequest,
} from './auth.guards';
import { MerchantAuthService } from './auth.service';
import { MerchantAccess } from './merchant-access.service';
import { MerchantBusinessService } from './merchant-business.service';
import { MerchantPasswordAuthService } from './merchant-password-auth.service';

const minutes = 60_000;

@Controller('auth')
export class MerchantAuthController {
  constructor(
    private readonly auth: MerchantAuthService,
    private readonly access: MerchantAccess,
    private readonly merchantBusinesses: MerchantBusinessService,
    private readonly passwordAuth: MerchantPasswordAuthService,
  ) {}

  private cookies() {
    const secure = this.auth.settings().secureCookies;
    const options: CookieOptions = {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
    };
    return { names: cookieNames(secure), options };
  }

  @Post('register')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  register(@Req() request: MerchantRequest, @Body() body: unknown) {
    const input = this.objectBody(body);
    return this.passwordAuth.register(
      input.fullName,
      input.email,
      input.password,
      request.ip ?? 'unknown',
    );
  }

  @Post('login/password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async passwordLogin(
    @Req() request: MerchantRequest,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ) {
    const input = this.objectBody(body);
    const { session, csrf, nextPath } = await this.passwordAuth.login(
      input.email,
      input.password,
      request.ip ?? 'unknown',
      cookie(request, cookieNames(this.auth.settings().secureCookies).session),
    );
    const { names, options } = this.cookies();
    response.cookie(names.session, session, {
      ...options,
      maxAge: 8 * 60 * minutes,
    });
    response.cookie(names.csrf, csrf, {
      ...options,
      httpOnly: false,
      maxAge: 8 * 60 * minutes,
    });
    return { nextPath };
  }

  @Post('verify-email')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  verifyEmail(@Req() request: MerchantRequest, @Body() body: unknown) {
    const input = this.objectBody(body);
    return this.passwordAuth.verifyEmail(input.token, request.ip ?? 'unknown');
  }

  @Post('resend-verification')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  resendVerification(@Req() request: MerchantRequest, @Body() body: unknown) {
    const input = this.objectBody(body);
    return this.passwordAuth.resendVerification(
      input.email,
      request.ip ?? 'unknown',
    );
  }

  @Post('forgot-password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  forgotPassword(@Req() request: MerchantRequest, @Body() body: unknown) {
    const input = this.objectBody(body);
    return this.passwordAuth.requestPasswordReset(
      input.email,
      request.ip ?? 'unknown',
    );
  }

  @Post('reset-password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  resetPassword(@Req() request: MerchantRequest, @Body() body: unknown) {
    const input = this.objectBody(body);
    return this.passwordAuth.resetPassword(
      input.token,
      input.password,
      request.ip ?? 'unknown',
    );
  }

  @Post('password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantSessionGuard, MerchantCsrfGuard)
  setPassword(@Req() request: MerchantRequest, @Body() body: unknown) {
    const input = this.objectBody(body);
    return this.passwordAuth.setPassword(
      principal(request).sessionDigest,
      input.password,
    );
  }

  private objectBody(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('Invalid request body.');
    return body as Record<string, unknown>;
  }

  @Get('login')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Redirect()
  async login(@Res({ passthrough: true }) response: Response) {
    const { names, options } = this.cookies();
    const { url, binding } = await this.auth.start('login');
    response.cookie(names.binding, binding, {
      ...options,
      maxAge: 10 * minutes,
    });
    return { url };
  }

  @Get('signup')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Redirect()
  async signup(@Res({ passthrough: true }) response: Response) {
    const { names, options } = this.cookies();
    const { url, binding } = await this.auth.start('signup');
    response.cookie(names.binding, binding, {
      ...options,
      maxAge: 10 * minutes,
    });
    return { url };
  }

  @Get('google/link')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @UseGuards(MerchantSessionGuard)
  @Redirect()
  async linkGoogle(
    @Req() request: MerchantRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { names, options } = this.cookies();
    const identity = principal(request);
    const { url, binding } = await this.auth.start('link', {
      accountId: identity.accountId,
      sessionDigest: identity.sessionDigest,
    });
    response.cookie(names.binding, binding, {
      ...options,
      maxAge: 10 * minutes,
    });
    return { url };
  }

  @Get('callback')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Redirect()
  async callback(
    @Req() request: MerchantRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { names, options } = this.cookies();
    const queryStart = request.originalUrl.indexOf('?');
    const query =
      queryStart < 0 ? '' : request.originalUrl.slice(queryStart + 1);
    const { session, csrf, nextPath } = await this.auth.finish(
      query,
      cookie(request, names.binding),
      cookie(request, names.session),
    );
    response.clearCookie(names.binding, options);
    response.cookie(names.session, session, {
      ...options,
      maxAge: 8 * 60 * minutes,
    });
    response.cookie(names.csrf, csrf, {
      ...options,
      httpOnly: false,
      maxAge: 8 * 60 * minutes,
    });
    return { url: nextPath };
  }

  @Get('onboarding')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantSessionGuard)
  onboarding(@Req() request: MerchantRequest) {
    return this.auth.onboarding(principal(request).sessionDigest);
  }

  @Post('onboarding')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantSessionGuard, MerchantCsrfGuard)
  updateOnboarding(@Req() request: MerchantRequest, @Body() body: unknown) {
    const step =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>).currentStep
        : undefined;
    return this.auth.updateOnboarding(principal(request).sessionDigest, step);
  }

  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantSessionGuard, MerchantCsrfGuard)
  async logout(
    @Req() request: MerchantRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { names, options } = this.cookies();
    await this.auth.logout(
      principal(request).sessionDigest,
      request.get('x-csrf-token') ?? '',
    );
    response.clearCookie(names.session, options);
    response.clearCookie(names.csrf, { ...options, httpOnly: false });
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantSessionGuard)
  async me(@Req() request: MerchantRequest) {
    const identity = principal(request);
    return {
      accountId: identity.accountId,
      memberships: await this.access.memberships(identity),
    };
  }

  @Get('businesses')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantSessionGuard)
  businesses(@Req() request: MerchantRequest) {
    return this.access.memberships(principal(request));
  }

  @Get('businesses/:businessId')
  @Header('Cache-Control', 'no-store')
  @UseGuards(MerchantSessionGuard)
  business(
    @Req() request: MerchantRequest,
    @Param('businessId') businessId: string,
  ) {
    return this.merchantBusinesses.read(principal(request), businessId);
  }
}
