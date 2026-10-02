import { Injectable } from '@nestjs/common';
import {
  Business,
  ConversationState,
  IncomingWhatsAppMessage,
  OutgoingWhatsAppMessage,
} from '../whatsapp/types/whatsapp.types';
import { BusinessRegistrationService } from './business-registration.service';
import { ConversationStateService } from './conversation-state.service';
import { MetaEmbeddedSignupService } from '../meta-embedded-signup/meta-embedded-signup.service';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly conversationStateService: ConversationStateService,
    private readonly businessRegistrationService: BusinessRegistrationService,
    private readonly metaEmbeddedSignupService: MetaEmbeddedSignupService,
  ) {}

  async handleIncomingMessage(
    message: IncomingWhatsAppMessage,
  ): Promise<OutgoingWhatsAppMessage> {
    const whatsappId = message.from.trim();
    const normalizedMessage = this.normalizeMessage(message.message);

    if (!normalizedMessage && message.type === 'text') {
      return {
        to: message.from,
        message:
          'Please send a message so I can continue with your Kleva onboarding.',
      };
    }

    const currentState =
      await this.conversationStateService.getOrCreate(whatsappId);

    if (
      this.isHiMessage(normalizedMessage) &&
      this.canRestartFlow(currentState.step)
    ) {
      const nextState = await this.conversationStateService.reset(whatsappId);
      nextState.step = 'ASK_REGISTER';
      await this.conversationStateService.save(nextState);

      return {
        to: message.from,
        message: this.buildWelcomeMessage(),
      };
    }

    switch (currentState.step) {
      case 'IDLE':
        return await this.handleIdleState(
          message,
          normalizedMessage,
          currentState,
        );
      case 'ASK_REGISTER':
        return await this.handleRegisterPrompt(
          whatsappId,
          normalizedMessage,
          message,
        );
      case 'ASK_BUSINESS_NAME':
        return await this.handleBusinessNameStep(
          normalizedMessage,
          message,
          currentState,
        );
      case 'ASK_INDUSTRY':
        return await this.handleIndustryStep(
          normalizedMessage,
          message,
          currentState,
        );
      case 'ASK_PHONE':
        return await this.handlePhoneStep(
          normalizedMessage,
          message,
          currentState,
        );
      case 'ASK_TIMEZONE':
        return await this.handleTimezoneStep(
          whatsappId,
          normalizedMessage,
          message,
          currentState,
        );
      case 'ASK_CONNECT_WHATSAPP':
        return await this.handleConnectionStep(
          whatsappId,
          normalizedMessage,
          message,
          currentState,
        );
      case 'WAITING_FOR_EMBEDDED_SIGNUP':
        return await this.handleEmbeddedSignupWaitingStep(
          whatsappId,
          normalizedMessage,
          message,
          currentState,
        );
      case 'ASK_LOGO':
        return await this.handleLogoStep(
          normalizedMessage,
          message,
          currentState,
        );
      case 'ASK_DESCRIPTION':
        return await this.handleDescriptionStep(
          normalizedMessage,
          message,
          currentState,
        );
      case 'ASK_OPENING_HOURS':
        return await this.handleOpeningHoursStep(
          normalizedMessage,
          message,
          currentState,
        );
      case 'DONE':
      default:
        return await this.handleIdleState(
          message,
          normalizedMessage,
          currentState,
        );
    }
  }

  private async handleIdleState(
    message: IncomingWhatsAppMessage,
    normalizedMessage: string,
    currentState: ConversationState,
  ): Promise<OutgoingWhatsAppMessage> {
    if (this.isHiMessage(normalizedMessage)) {
      const nextState = this.updateState(currentState, {
        step: 'ASK_REGISTER',
      });

      await this.conversationStateService.save(nextState);

      return {
        to: message.from,
        message: this.buildWelcomeMessage(),
      };
    }

    if (this.isAffirmative(normalizedMessage)) {
      const nextState = this.updateState(currentState, {
        step: 'ASK_BUSINESS_NAME',
      });

      await this.conversationStateService.save(nextState);

      return {
        to: message.from,
        message: 'What is your business name?',
      };
    }

    await this.conversationStateService.save(currentState);

    return {
      to: message.from,
      message: 'Please send "Hi" to start your Kleva onboarding.',
    };
  }

  private async handleRegisterPrompt(
    whatsappId: string,
    normalizedMessage: string,
    message: IncomingWhatsAppMessage,
  ): Promise<OutgoingWhatsAppMessage> {
    const currentState =
      await this.conversationStateService.getOrCreate(whatsappId);

    if (this.isAffirmative(normalizedMessage)) {
      const nextState = this.updateState(currentState, {
        step: 'ASK_BUSINESS_NAME',
      });

      await this.conversationStateService.save(nextState);

      return {
        to: message.from,
        message: 'What is your business name?',
      };
    }

    if (this.isNegative(normalizedMessage)) {
      await this.conversationStateService.reset(whatsappId);

      return {
        to: message.from,
        message:
          'No problem. Message me "Hi" whenever you are ready to register your business.',
      };
    }

    return {
      to: message.from,
      message: 'Please reply with 1 for Yes or 2 for No.',
    };
  }

  private async handleBusinessNameStep(
    normalizedMessage: string,
    message: IncomingWhatsAppMessage,
    currentState: ConversationState,
  ): Promise<OutgoingWhatsAppMessage> {
    if (!normalizedMessage) {
      return {
        to: message.from,
        message: 'What is your business name?',
      };
    }

    const nextState = this.updateState(currentState, {
      step: 'ASK_INDUSTRY',
      draftBusiness: {
        ...currentState.draftBusiness,
        name: message.message.trim(),
      },
    });

    await this.conversationStateService.save(nextState);

    return {
      to: message.from,
      message: this.buildIndustryPrompt(),
    };
  }

  private async handleIndustryStep(
    normalizedMessage: string,
    message: IncomingWhatsAppMessage,
    currentState: ConversationState,
  ): Promise<OutgoingWhatsAppMessage> {
    const industry = this.parseIndustryChoice(normalizedMessage);

    if (!industry) {
      return {
        to: message.from,
        message: this.buildIndustryPrompt(true),
      };
    }

    const nextState = this.updateState(currentState, {
      step: 'ASK_PHONE',
      draftBusiness: {
        ...currentState.draftBusiness,
        industry,
      },
    });

    await this.conversationStateService.save(nextState);

    return {
      to: message.from,
      message:
        'What phone number should customers use to contact your business?',
    };
  }

  private async handlePhoneStep(
    normalizedMessage: string,
    message: IncomingWhatsAppMessage,
    currentState: ConversationState,
  ): Promise<OutgoingWhatsAppMessage> {
    if (!normalizedMessage) {
      return {
        to: message.from,
        message:
          'What phone number should customers use to contact your business?',
      };
    }

    const nextState = this.updateState(currentState, {
      step: 'ASK_TIMEZONE',
      draftBusiness: {
        ...currentState.draftBusiness,
        phone: message.message.trim(),
      },
    });

    await this.conversationStateService.save(nextState);

    return {
      to: message.from,
      message:
        'What timezone is your business located in?\n\nExample: Africa/Lagos',
    };
  }

  private async handleTimezoneStep(
    whatsappId: string,
    normalizedMessage: string,
    message: IncomingWhatsAppMessage,
    currentState: ConversationState,
  ): Promise<OutgoingWhatsAppMessage> {
    if (!normalizedMessage) {
      return {
        to: message.from,
        message:
          'What timezone is your business located in?\n\nExample: Africa/Lagos',
      };
    }

    const draftBusiness = {
      name: currentState.draftBusiness.name ?? '',
      industry: currentState.draftBusiness.industry ?? '',
      phone: currentState.draftBusiness.phone ?? '',
      timezone: message.message.trim(),
      whatsapp_number: message.from,
    } satisfies Pick<
      Business,
      'name' | 'industry' | 'phone' | 'timezone' | 'whatsapp_number'
    >;

    const { business, owner } =
      await this.businessRegistrationService.registerBusiness({
        ownerWhatsappId: whatsappId,
        draftBusiness,
      });

    const nextState = this.updateState(currentState, {
      step: 'ASK_CONNECT_WHATSAPP',
      businessId: business.id,
      ownerId: owner.id,
      draftBusiness: {
        ...currentState.draftBusiness,
        timezone: draftBusiness.timezone,
        whatsapp_number: draftBusiness.whatsapp_number,
      },
    });

    await this.conversationStateService.save(nextState);

    return {
      to: message.from,
      message: this.buildConnectPrompt(),
    };
  }

  private async handleConnectionStep(
    whatsappId: string,
    normalizedMessage: string,
    message: IncomingWhatsAppMessage,
    currentState: ConversationState,
  ): Promise<OutgoingWhatsAppMessage> {
    const businessId = currentState.businessId;

    if (!businessId) {
      await this.conversationStateService.reset(whatsappId);

      return {
        to: message.from,
        message:
          'Something went wrong with your onboarding. Please send "Hi" to start again.',
      };
    }

    if (this.isConnectChoice(normalizedMessage)) {
      const signupUrl = this.metaEmbeddedSignupService.createSignupUrl({
        ownerWhatsappId: whatsappId,
        businessId,
      });

      const nextState = this.updateState(currentState, {
        step: 'WAITING_FOR_EMBEDDED_SIGNUP',
        connectionChoice: 'connect',
      });

      await this.conversationStateService.save(nextState);

      return {
        to: message.from,
        message: `To connect your WhatsApp Business number, open this secure Meta signup link:\n\n${signupUrl}\n\nAfter you finish, return here and send "done".`,
      };
    }

    if (this.isCurrentNumberChoice(normalizedMessage)) {
      const nextState = this.updateState(currentState, {
        step: 'ASK_LOGO',
        connectionChoice: 'current',
      });

      await this.conversationStateService.save(nextState);

      return {
        to: message.from,
        message:
          'Using your current WhatsApp number for the business.\n\nUpload your business logo',
      };
    }

    return {
      to: message.from,
      message:
        'Please reply with 1 to Connect or 2 to Continue with this number.',
    };
  }

  private async handleEmbeddedSignupWaitingStep(
    whatsappId: string,
    normalizedMessage: string,
    message: IncomingWhatsAppMessage,
    currentState: ConversationState,
  ): Promise<OutgoingWhatsAppMessage> {
    if (!this.isDoneMessage(normalizedMessage)) {
      return {
        to: message.from,
        message:
          "I'm still waiting for Meta to confirm your WhatsApp connection. Please finish the signup link first.",
      };
    }

    const businessId = currentState.businessId;

    if (!businessId) {
      await this.conversationStateService.reset(whatsappId);

      return {
        to: message.from,
        message:
          'Something went wrong with your onboarding. Please send "Hi" to start again.',
      };
    }

    const embeddedSignupConnection =
      await this.businessRegistrationService.getEmbeddedSignupConnection(
        businessId,
      );

    if (
      !embeddedSignupConnection ||
      embeddedSignupConnection.status !== 'connected'
    ) {
      return {
        to: message.from,
        message:
          "I'm still waiting for Meta to confirm your WhatsApp connection. Please finish the signup link first.",
      };
    }

    const nextState = this.updateState(currentState, {
      step: 'ASK_LOGO',
      connectionChoice: 'connect',
    });

    await this.conversationStateService.save(nextState);

    return {
      to: message.from,
      message: 'Upload your business logo',
    };
  }

  private async handleLogoStep(
    normalizedMessage: string,
    message: IncomingWhatsAppMessage,
    currentState: ConversationState,
  ): Promise<OutgoingWhatsAppMessage> {
    const hasNonTextAttachment = message.type !== 'text';
    const hasTextContent = Boolean(normalizedMessage);

    if (!hasNonTextAttachment && !hasTextContent) {
      return {
        to: message.from,
        message: 'Upload your business logo',
      };
    }

    const nextState = this.updateState(currentState, {
      step: 'ASK_DESCRIPTION',
      profile: {
        ...currentState.profile,
        logoUploaded: true,
      },
    });

    await this.conversationStateService.save(nextState);

    return {
      to: message.from,
      message: 'Describe your business',
    };
  }

  private async handleDescriptionStep(
    normalizedMessage: string,
    message: IncomingWhatsAppMessage,
    currentState: ConversationState,
  ): Promise<OutgoingWhatsAppMessage> {
    if (!normalizedMessage) {
      return {
        to: message.from,
        message: 'Describe your business',
      };
    }

    const nextState = this.updateState(currentState, {
      step: 'ASK_OPENING_HOURS',
      profile: {
        ...currentState.profile,
        logoUploaded: currentState.profile.logoUploaded ?? true,
        description: message.message.trim(),
      },
    });

    await this.conversationStateService.save(nextState);

    return {
      to: message.from,
      message: 'Add opening hours',
    };
  }

  private async handleOpeningHoursStep(
    normalizedMessage: string,
    message: IncomingWhatsAppMessage,
    currentState: ConversationState,
  ): Promise<OutgoingWhatsAppMessage> {
    if (!normalizedMessage) {
      return {
        to: message.from,
        message: 'Add opening hours',
      };
    }

    const nextState = this.updateState(currentState, {
      step: 'DONE',
      profile: {
        ...currentState.profile,
        logoUploaded: currentState.profile.logoUploaded ?? true,
        description: currentState.profile.description ?? '',
        openingHours: message.message.trim(),
      },
    });

    await this.conversationStateService.save(nextState);

    if (nextState.businessId) {
      await this.businessRegistrationService.saveProfile(nextState.businessId, {
        description: nextState.profile.description,
        openingHours: nextState.profile.openingHours,
        logoUploaded: nextState.profile.logoUploaded,
      });
    }

    return {
      to: message.from,
      message: this.buildCompletionMessage(),
    };
  }

  private updateState(
    state: ConversationState,
    patch: Partial<ConversationState>,
  ): ConversationState {
    return {
      ...state,
      ...patch,
      draftBusiness: {
        ...state.draftBusiness,
        ...patch.draftBusiness,
      },
      profile: {
        ...state.profile,
        ...patch.profile,
      },
    };
  }

  private normalizeMessage(message: string): string {
    return message.trim();
  }

  private isHiMessage(message: string): boolean {
    return message.toLowerCase() === 'hi';
  }

  private canRestartFlow(step: string): boolean {
    return step === 'IDLE' || step === 'DONE';
  }

  private isAffirmative(message: string): boolean {
    return ['1', 'yes'].includes(message.toLowerCase());
  }

  private isNegative(message: string): boolean {
    return ['2', 'no'].includes(message.toLowerCase());
  }

  private isConnectChoice(message: string): boolean {
    return message === '1' || message.toLowerCase() === 'connect';
  }

  private isCurrentNumberChoice(message: string): boolean {
    const normalized = message.toLowerCase();

    return normalized === '2' || normalized === 'continue with this number';
  }

  private isDoneMessage(message: string): boolean {
    return message.toLowerCase() === 'done';
  }

  private parseIndustryChoice(message: string): string | undefined {
    const normalized = message.toLowerCase();

    switch (normalized) {
      case '1':
      case 'food':
        return 'Food';
      case '2':
      case 'retail':
        return 'Retail';
      case '3':
      case 'healthcare':
        return 'Healthcare';
      case '4':
      case 'other':
        return 'Other';
      default:
        return undefined;
    }
  }

  private buildWelcomeMessage(): string {
    return [
      'Welcome to Kleva 👋',
      '',
      'I can help you set up your business account.',
      '',
      'Would you like to register your business?',
      '',
      '1. Yes',
      '2. No',
    ].join('\n');
  }

  private buildIndustryPrompt(includeRetryHint = false): string {
    const prompt = [
      'What industry is your business in?',
      '',
      '1. Food',
      '2. Retail',
      '3. Healthcare',
      '4. Other',
    ];

    if (includeRetryHint) {
      prompt.unshift('Please choose a valid industry option.');
      prompt.splice(1, 0, '');
    }

    return prompt.join('\n');
  }

  private buildConnectPrompt(): string {
    return [
      'Do you want to connect your business WhatsApp number?',
      '',
      '1. Connect',
      '2. Continue with this number',
    ].join('\n');
  }

  private buildCompletionMessage(): string {
    return [
      '🎉 Your business is now registered with Kleva.',
      '',
      'You can now:',
      '✅ Manage customers',
      '✅ Reply to messages',
      '✅ Send updates',
      '✅ Track conversations',
    ].join('\n');
  }
}
