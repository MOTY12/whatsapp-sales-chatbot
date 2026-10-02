import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { BusinessRegistrationService } from './business-registration.service';
import { ConversationStateService } from './conversation-state.service';
import { OnboardingService } from './onboarding.service';
import { MetaEmbeddedSignupModule } from '../meta-embedded-signup/meta-embedded-signup.module';

@Module({
  imports: [DatabaseModule, MetaEmbeddedSignupModule],
  providers: [ConversationStateService, BusinessRegistrationService, OnboardingService],
  exports: [ConversationStateService, BusinessRegistrationService, OnboardingService],
})
export class OnboardingModule {}