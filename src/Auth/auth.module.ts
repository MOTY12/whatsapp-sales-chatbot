import { Module } from '@nestjs/common';
import { merchantAuthConfig, merchantEmailAuthConfig } from '../config/env';
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
import { OutboundModule } from '../whatsapp/outbound.module';
import { MerchantInboxController } from './merchant-inbox.controller';
import { MerchantInboxService } from './merchant-inbox.service';
import { KnowledgeController } from '../knowledge/knowledge.controller';
import { KnowledgeFaqService } from '../knowledge/knowledge-faq.service';
import { ProductController } from '../catalog/product.controller';
import { ProductService } from '../catalog/product.service';
import { MerchantLeadsController } from './merchant-leads.controller';
import { MerchantLeadsService } from './merchant-leads.service';
import { MerchantPilotController } from './merchant-pilot.controller';
import { MerchantPilotService } from './merchant-pilot.service';
import {
  MERCHANT_EMAIL_AUTH_CONFIG,
  MerchantEmailDeliveryService,
} from './merchant-email-delivery.service';
import { MerchantPasswordAuthService } from './merchant-password-auth.service';

@Module({
  imports: [CredentialCipherModule, OutboundModule],
  controllers: [
    MerchantAuthController,
    MerchantBusinessController,
    MerchantWhatsAppController,
    MerchantInboxController,
    KnowledgeController,
    ProductController,
    MerchantLeadsController,
    MerchantPilotController,
  ],
  providers: [
    { provide: MERCHANT_AUTH_CONFIG, useFactory: () => merchantAuthConfig() },
    {
      provide: MERCHANT_EMAIL_AUTH_CONFIG,
      useFactory: () => merchantEmailAuthConfig(),
    },
    MerchantDatabase,
    MerchantOidcClient,
    MerchantAuthService,
    MerchantPasswordAuthService,
    MerchantEmailDeliveryService,
    MerchantAccess,
    MerchantBusinessService,
    MerchantWhatsAppService,
    MerchantInboxService,
    KnowledgeFaqService,
    ProductService,
    MerchantLeadsService,
    MerchantPilotService,
    MetaWhatsAppVerifier,
    MerchantSessionGuard,
    MerchantCsrfGuard,
  ],
  exports: [MerchantAccess, MerchantSessionGuard, MerchantCsrfGuard],
})
export class AuthModule {}
