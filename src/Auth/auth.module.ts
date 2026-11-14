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

import { CredentialCipherModule } from '../channels/secure-whatsapp/credential-cipher.module';
import { MerchantWhatsAppController } from '../channels/secure-whatsapp/merchant-whatsapp.controller';
import { MerchantWhatsAppService } from '../channels/secure-whatsapp/merchant-whatsapp.service';
import { MetaWhatsAppVerifier } from '../channels/secure-whatsapp/meta-verifier';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { MerchantInboxController } from './merchant-inbox.controller';
import { MerchantInboxService } from './merchant-inbox.service';

@Module({
  imports: [CredentialCipherModule, WhatsAppModule],
  controllers: [
    MerchantAuthController,
    MerchantBusinessController,
    MerchantWhatsAppController,
    MerchantInboxController,
  ],
  providers: [
    { provide: MERCHANT_AUTH_CONFIG, useFactory: () => merchantAuthConfig() },
    MerchantDatabase,
    MerchantOidcClient,
    MerchantAuthService,
    MerchantAccess,
    MerchantBusinessService,
    MerchantWhatsAppService,
    MerchantInboxService,
    MetaWhatsAppVerifier,
    MerchantSessionGuard,
    MerchantCsrfGuard,
  ],
  exports: [MerchantAccess, MerchantSessionGuard, MerchantCsrfGuard],
})
export class AuthModule {}
