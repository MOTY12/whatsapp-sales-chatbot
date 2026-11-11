import { Module } from '@nestjs/common';
import { merchantAuthConfig } from '../config/env';
import { MerchantAuthController } from './auth.controller';
import { MerchantCsrfGuard, MerchantSessionGuard } from './auth.guards';
import { MerchantAuthService } from './auth.service';
import { MerchantAccess } from './merchant-access.service';
import { MERCHANT_AUTH_CONFIG, MerchantDatabase } from './merchant-database';
import { MerchantOidcClient } from './oidc-client';

@Module({
  controllers: [MerchantAuthController],
  providers: [
    { provide: MERCHANT_AUTH_CONFIG, useFactory: () => merchantAuthConfig() },
    MerchantDatabase,
    MerchantOidcClient,
    MerchantAuthService,
    MerchantAccess,
    MerchantSessionGuard,
    MerchantCsrfGuard,
  ],
  exports: [MerchantAccess, MerchantSessionGuard, MerchantCsrfGuard],
})
export class AuthModule {}
