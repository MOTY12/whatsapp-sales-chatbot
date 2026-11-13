import {
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

const minutes = 60_000;

@Controller('auth')
export class MerchantAuthController {
  constructor(
    private readonly auth: MerchantAuthService,
    private readonly access: MerchantAccess,
    private readonly merchantBusinesses: MerchantBusinessService,
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

  @Get('login')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Redirect()
  async login(@Res({ passthrough: true }) response: Response) {
    const { names, options } = this.cookies();
    const { url, binding } = await this.auth.start();
    response.cookie(names.binding, binding, {
      ...options,
      maxAge: 10 * minutes,
    });
    return { url };
  }

  @Get('callback')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Redirect('/auth/me')
  async callback(
    @Req() request: MerchantRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { names, options } = this.cookies();
    const queryStart = request.originalUrl.indexOf('?');
    const query =
      queryStart < 0 ? '' : request.originalUrl.slice(queryStart + 1);
    const { session, csrf } = await this.auth.finish(
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
