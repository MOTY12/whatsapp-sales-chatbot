import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OnboardingModule } from './onboarding/onboarding.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [WhatsAppModule, OnboardingModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
