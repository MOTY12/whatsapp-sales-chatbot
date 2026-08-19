import { Test } from '@nestjs/testing';
import { EmbeddedSignupConnectionService } from '../meta-embedded-signup/embedded-signup-connection.service';
import { MetaEmbeddedSignupService } from '../meta-embedded-signup/meta-embedded-signup.service';
import { BusinessRegistrationService } from './business-registration.service';
import { ConversationStateService } from './conversation-state.service';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  let onboardingService: OnboardingService;
  let conversationStateService: ConversationStateService;
  let businessRegistrationService: BusinessRegistrationService;
  let embeddedSignupConnectionService: EmbeddedSignupConnectionService;
  const createSignupUrl = jest.fn(() => 'https://facebook.example/signup');

  const sender = '+2348012345678';

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConversationStateService,
        EmbeddedSignupConnectionService,
        BusinessRegistrationService,
        OnboardingService,
        {
          provide: MetaEmbeddedSignupService,
          useValue: {
            createSignupUrl,
          },
        },
      ],
    }).compile();

    onboardingService = moduleRef.get(OnboardingService);
    conversationStateService = moduleRef.get(ConversationStateService);
    businessRegistrationService = moduleRef.get(BusinessRegistrationService);
    embeddedSignupConnectionService = moduleRef.get(EmbeddedSignupConnectionService);
    createSignupUrl.mockClear();
  });

  it('Hi starts registration prompt', () => {
    const response = onboardingService.handleIncomingMessage({
      from: sender,
      message: 'Hi',
      type: 'text',
    });

    expect(response).toEqual({
      to: sender,
      message: expect.stringContaining('Welcome to Kleva'),
    });
    expect(conversationStateService.get(sender)?.step).toBe('ASK_REGISTER');
  });

  it('Yes starts business name step', () => {
    onboardingService.handleIncomingMessage({ from: sender, message: 'Hi', type: 'text' });

    const response = onboardingService.handleIncomingMessage({
      from: sender,
      message: 'Yes',
      type: 'text',
    });

    expect(response.message).toBe('What is your business name?');
    expect(conversationStateService.get(sender)?.step).toBe('ASK_BUSINESS_NAME');
  });

  it('Connect returns a Meta signup link and waits for callback completion', async () => {
    onboardingService.handleIncomingMessage({ from: sender, message: 'Hi', type: 'text' });
    onboardingService.handleIncomingMessage({ from: sender, message: 'Yes', type: 'text' });
    onboardingService.handleIncomingMessage({
      from: sender,
      message: 'Kleva Foods',
      type: 'text',
    });
    onboardingService.handleIncomingMessage({ from: sender, message: '1', type: 'text' });
    onboardingService.handleIncomingMessage({
      from: sender,
      message: '+2348011111111',
      type: 'text',
    });

    const connectPrompt = onboardingService.handleIncomingMessage({
      from: sender,
      message: 'Africa/Lagos',
      type: 'text',
    });

    expect(connectPrompt.message).toContain('Do you want to connect your business WhatsApp number?');

    const connectChoice = await onboardingService.handleIncomingMessage({
      from: sender,
      message: 'Connect',
      type: 'text',
    });

    expect(connectChoice.message).toContain('To connect your WhatsApp Business number');
    expect(connectChoice.message).toContain('https://facebook.example/signup');
    expect(conversationStateService.get(sender)?.step).toBe('WAITING_FOR_EMBEDDED_SIGNUP');
    expect(createSignupUrl).toHaveBeenCalledWith({ ownerWhatsappId: sender, businessId: expect.any(String) });

    const waitingResponse = await onboardingService.handleIncomingMessage({
      from: sender,
      message: 'done',
      type: 'text',
    });

    expect(waitingResponse.message).toContain('still waiting for Meta');

    const stateAfterConnect = conversationStateService.get(sender);
    const businessId = stateAfterConnect?.businessId;

    expect(businessId).toBeDefined();

    if (!businessId) {
      return;
    }

    embeddedSignupConnectionService.saveEmbeddedSignupConnection({
      businessId,
      ownerWhatsappId: sender,
      wabaId: 'waba_123',
      phoneNumberId: 'phone_123',
      accessToken: 'access-token',
      connectedAt: new Date().toISOString(),
      status: 'connected',
    });

    const doneResponse = await onboardingService.handleIncomingMessage({
      from: sender,
      message: 'done',
      type: 'text',
    });

    expect(doneResponse.message).toContain('Upload your business logo');
    expect(conversationStateService.get(sender)?.step).toBe('ASK_LOGO');
  });

  it('Done before callback keeps waiting for Meta confirmation', async () => {
    onboardingService.handleIncomingMessage({ from: sender, message: 'Hi', type: 'text' });
    onboardingService.handleIncomingMessage({ from: sender, message: 'Yes', type: 'text' });
    onboardingService.handleIncomingMessage({
      from: sender,
      message: 'Kleva Foods',
      type: 'text',
    });
    onboardingService.handleIncomingMessage({ from: sender, message: 'Food', type: 'text' });
    onboardingService.handleIncomingMessage({
      from: sender,
      message: '+2348011111111',
      type: 'text',
    });

    await onboardingService.handleIncomingMessage({
      from: sender,
      message: 'Africa/Lagos',
      type: 'text',
    });

    const response = await onboardingService.handleIncomingMessage({
      from: sender,
      message: 'done',
      type: 'text',
    });

    expect(response.message).toContain('still waiting for Meta');
    expect(conversationStateService.get(sender)?.step).toBe('WAITING_FOR_EMBEDDED_SIGNUP');
  });

  it('Done after callback continues to logo upload', async () => {
    onboardingService.handleIncomingMessage({ from: sender, message: 'Hi', type: 'text' });
    onboardingService.handleIncomingMessage({ from: sender, message: 'Yes', type: 'text' });
    onboardingService.handleIncomingMessage({
      from: sender,
      message: 'Kleva Foods',
      type: 'text',
    });
    onboardingService.handleIncomingMessage({ from: sender, message: 'Food', type: 'text' });
    onboardingService.handleIncomingMessage({
      from: sender,
      message: '+2348011111111',
      type: 'text',
    });

    await onboardingService.handleIncomingMessage({
      from: sender,
      message: 'Africa/Lagos',
      type: 'text',
    });

    const state = conversationStateService.get(sender);
    const businessId = state?.businessId;

    expect(businessId).toBeDefined();

    if (!businessId) {
      return;
    }

    businessRegistrationService.saveEmbeddedSignupConnection({
      businessId,
      ownerWhatsappId: sender,
      wabaId: 'waba_123',
      phoneNumberId: 'phone_123',
      accessToken: 'access-token',
      connectedAt: new Date().toISOString(),
      status: 'connected',
    });

    const response = await onboardingService.handleIncomingMessage({
      from: sender,
      message: 'done',
      type: 'text',
    });

    expect(response.message).toContain('Upload your business logo');
    expect(conversationStateService.get(sender)?.step).toBe('ASK_LOGO');
  });

  it('Full successful registration path with current WhatsApp number still works', async () => {
    onboardingService.handleIncomingMessage({ from: sender, message: 'Hi', type: 'text' });
    onboardingService.handleIncomingMessage({ from: sender, message: 'Yes', type: 'text' });
    onboardingService.handleIncomingMessage({
      from: sender,
      message: 'Kleva Foods',
      type: 'text',
    });
    onboardingService.handleIncomingMessage({ from: sender, message: '1', type: 'text' });
    onboardingService.handleIncomingMessage({
      from: sender,
      message: '+2348011111111',
      type: 'text',
    });

    const connectPrompt = onboardingService.handleIncomingMessage({
      from: sender,
      message: 'Africa/Lagos',
      type: 'text',
    });

    expect(connectPrompt.message).toContain('Do you want to connect your business WhatsApp number?');

    const connectChoice = await onboardingService.handleIncomingMessage({
      from: sender,
      message: '2',
      type: 'text',
    });

    expect(connectChoice.message).toContain('Using your current WhatsApp number for the business.');

    onboardingService.handleIncomingMessage({ from: sender, message: 'logo-placeholder', type: 'image' });
    onboardingService.handleIncomingMessage({
      from: sender,
      message: 'We help small businesses sell on WhatsApp',
      type: 'text',
    });

    const doneResponse = onboardingService.handleIncomingMessage({
      from: sender,
      message: 'Mon-Fri 9am-5pm',
      type: 'text',
    });

    expect(doneResponse.message).toContain('Your business is now registered with Kleva');

    const state = conversationStateService.get(sender);
    expect(state?.step).toBe('DONE');
    expect(state?.profile.logoUploaded).toBe(true);
    expect(state?.profile.description).toBe('We help small businesses sell on WhatsApp');
    expect(state?.profile.openingHours).toBe('Mon-Fri 9am-5pm');

    const businessId = state?.businessId;
    expect(businessId).toBeDefined();

    const business = businessId ? businessRegistrationService.getBusinessById(businessId) : undefined;
    expect(business).toMatchObject({
      name: 'Kleva Foods',
      industry: 'Food',
      phone: '+2348011111111',
      whatsapp_number: sender,
      timezone: 'Africa/Lagos',
      owner_whatsapp_id: sender,
      status: 'active',
    });
  });

  it('Invalid industry input asks the user to retry', () => {
    onboardingService.handleIncomingMessage({ from: sender, message: 'Hi', type: 'text' });
    onboardingService.handleIncomingMessage({ from: sender, message: 'Yes', type: 'text' });
    onboardingService.handleIncomingMessage({
      from: sender,
      message: 'Kleva Foods',
      type: 'text',
    });

    const response = onboardingService.handleIncomingMessage({
      from: sender,
      message: 'invalid-industry',
      type: 'text',
    });

    expect(response.message).toContain('Please choose a valid industry option.');
    expect(conversationStateService.get(sender)?.step).toBe('ASK_INDUSTRY');
  });

  it('Choosing Continue with this number uses sender WhatsApp number', () => {
    onboardingService.handleIncomingMessage({ from: sender, message: 'Hi', type: 'text' });
    onboardingService.handleIncomingMessage({ from: sender, message: 'Yes', type: 'text' });
    onboardingService.handleIncomingMessage({
      from: sender,
      message: 'Kleva Foods',
      type: 'text',
    });
    onboardingService.handleIncomingMessage({ from: sender, message: 'Food', type: 'text' });
    onboardingService.handleIncomingMessage({
      from: sender,
      message: '+2348011111111',
      type: 'text',
    });
    onboardingService.handleIncomingMessage({ from: sender, message: 'Africa/Lagos', type: 'text' });

    const response = onboardingService.handleIncomingMessage({
      from: sender,
      message: 'Continue with this number',
      type: 'text',
    });

    expect(response.message).toContain('Using your current WhatsApp number for the business.');
    expect(conversationStateService.get(sender)?.connectionChoice).toBe('current');

    const state = conversationStateService.get(sender);
    const business = state?.businessId ? businessRegistrationService.getBusinessById(state.businessId) : undefined;

    expect(business?.whatsapp_number).toBe(sender);
  });
});