import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MetaEmbeddedSignupModule } from './meta-embedded-signup/meta-embedded-signup.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [WhatsAppModule, OnboardingModule, MetaEmbeddedSignupModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
