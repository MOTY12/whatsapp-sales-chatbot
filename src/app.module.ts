import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    DatabaseModule,
    WhatsAppModule,
    OnboardingModule,
    MetaEmbeddedSignupModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService, DatabaseReadiness],
})
export class AppModule {}
