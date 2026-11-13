import { Module } from '@nestjs/common';
import { merchantAuthConfig } from '../config/env';
import { MerchantAuthController } from './auth.controller';
import { MerchantCsrfGuard, MerchantSessionGuard } from './auth.guards';
import { MerchantAuthService } from './auth.service';
import { MerchantAccess } from './merchant-access.service';
import { MERCHANT_AUTH_CONFIG, MerchantDatabase } from './merchant-database';
import { MerchantBusinessController } from './merchant-business.controller';
import { MerchantBusinessService } from './merchant-business.service';
import { MerchantOidcClient } from './oidc-client';

@Module({
  controllers: [MerchantAuthController, MerchantBusinessController],
  providers: [
    { provide: MERCHANT_AUTH_CONFIG, useFactory: () => merchantAuthConfig() },
    MerchantDatabase,
    MerchantOidcClient,
    MerchantAuthService,
    MerchantAccess,
    MerchantBusinessService,
    MerchantSessionGuard,
    MerchantCsrfGuard,
  ],
  exports: [MerchantAccess, MerchantSessionGuard, MerchantCsrfGuard],
})
export class AuthModule {}
