import { Module } from '@nestjs/common';
import { AuthModule } from './Auth/auth.module';
import {
  DatabaseReadiness,
  HealthController,
} from './health/health.controller';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { MetaEmbeddedSignupModule } from './meta-embedded-signup/meta-embedded-signup.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { CatalogModule } from './catalog/catalog.module';
import { WebsiteChatModule } from './website-chat/website-chat.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    WhatsAppModule,
    OnboardingModule,
    MetaEmbeddedSignupModule,
    KnowledgeModule,
    CatalogModule,
    WebsiteChatModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService, DatabaseReadiness],
})
export class AppModule {}
