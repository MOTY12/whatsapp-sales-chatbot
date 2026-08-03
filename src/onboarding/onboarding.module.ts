import { Module } from '@nestjs/common';
import { BusinessRegistrationService } from './business-registration.service';
import { ConversationStateService } from './conversation-state.service';
import { OnboardingService } from './onboarding.service';

@Module({
  providers: [ConversationStateService, BusinessRegistrationService, OnboardingService],
  exports: [ConversationStateService, BusinessRegistrationService, OnboardingService],
})
export class OnboardingModule {}