import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  isOpaque,
  MerchantAuthService,
  type MerchantPrincipal,
} from './auth.service';

export interface MerchantRequest extends Request {
  merchant?: MerchantPrincipal;
}

export function cookie(request: Request, name: string) {
  const matches = (request.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : undefined;
}

export function cookieNames(secure: boolean) {
  const prefix = secure ? '__Host-' : '';
  return {
    binding: `${prefix}kleva_oidc_binding`,
    session: `${prefix}kleva_session`,
    csrf: `${prefix}kleva_csrf`,
  };
}

export function principal(request: MerchantRequest) {
  if (!request.merchant) throw new UnauthorizedException();
  return request.merchant;
}

@Injectable()
export class MerchantSessionGuard implements CanActivate {
  constructor(private readonly auth: MerchantAuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<MerchantRequest>();
    const { session } = cookieNames(this.auth.settings().secureCookies);
    request.merchant = await this.auth.authenticate(cookie(request, session));
    return true;
  }
}

@Injectable()
export class MerchantCsrfGuard implements CanActivate {
  constructor(private readonly auth: MerchantAuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<MerchantRequest>();
    const token = request.get('x-csrf-token');
    if (
      request.get('origin') !== this.auth.settings().redirect.origin ||
      !isOpaque(token) ||
      !(await this.auth.verifyCsrf(principal(request).sessionDigest, token))
    ) {
      throw new ForbiddenException('Invalid CSRF proof.');
    }
    return true;
  }
}
