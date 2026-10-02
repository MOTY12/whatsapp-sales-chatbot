import { Test } from '@nestjs/testing';
import { EmbeddedSignupConnectionService } from '../meta-embedded-signup/embedded-signup-connection.service';
import { MetaEmbeddedSignupService } from '../meta-embedded-signup/meta-embedded-signup.service';
import { BusinessRepository } from '../database/repositories/business.repository';
import { OnboardingSessionRepository } from '../database/repositories/onboarding-session.repository';
import { UserRepository } from '../database/repositories/user.repository';
import {
  createInMemoryBusinessRepository,
  createInMemoryOnboardingSessionRepository,
  createInMemoryUserRepository,
} from '../testing/in-memory-repositories';
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

  const send = (message: string, type = 'text') =>
    onboardingService.handleIncomingMessage({
      from: sender,
      message,
      type,
    });

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
        {
          provide: BusinessRepository,
          useValue: createInMemoryBusinessRepository(),
        },
        {
          provide: UserRepository,
          useValue: createInMemoryUserRepository(),
        },
        {
          provide: OnboardingSessionRepository,
          useValue: createInMemoryOnboardingSessionRepository(),
        },
      ],
    }).compile();

    onboardingService = moduleRef.get(OnboardingService);
    conversationStateService = moduleRef.get(ConversationStateService);
    businessRegistrationService = moduleRef.get(BusinessRegistrationService);
    embeddedSignupConnectionService = moduleRef.get(
      EmbeddedSignupConnectionService,
    );
    createSignupUrl.mockClear();
  });

  it('Hi starts registration prompt', async () => {
    const response = await send('Hi');

    expect(response).toEqual({
      to: sender,
      message: expect.stringContaining('Welcome to Kleva'),
    });
    expect((await conversationStateService.get(sender))?.step).toBe(
      'ASK_REGISTER',
    );
  });

  it('Yes starts business name step', async () => {
    await send('Hi');

    const response = await send('Yes');

    expect(response.message).toBe('What is your business name?');
    expect((await conversationStateService.get(sender))?.step).toBe(
      'ASK_BUSINESS_NAME',
    );
  });

  it('Connect returns a Meta signup link and waits for callback completion', async () => {
    await send('Hi');
    await send('Yes');
    await send('Kleva Foods');
    await send('1');
    await send('+2348011111111');

    const connectPrompt = await send('Africa/Lagos');

    expect(connectPrompt.message).toContain(
      'Do you want to connect your business WhatsApp number?',
    );

    const connectChoice = await send('Connect');

    expect(connectChoice.message).toContain(
      'To connect your WhatsApp Business number',
    );
    expect(connectChoice.message).toContain('https://facebook.example/signup');
    expect((await conversationStateService.get(sender))?.step).toBe(
      'WAITING_FOR_EMBEDDED_SIGNUP',
    );
    expect(createSignupUrl).toHaveBeenCalledWith({
      ownerWhatsappId: sender,
      businessId: expect.any(String),
    });

    const waitingResponse = await send('done');

    expect(waitingResponse.message).toContain('still waiting for Meta');

    const stateAfterConnect = await conversationStateService.get(sender);
    const businessId = stateAfterConnect?.businessId;

    expect(businessId).toBeDefined();

    if (!businessId) {
      return;
    }

    await embeddedSignupConnectionService.saveEmbeddedSignupConnection({
      businessId,
      ownerWhatsappId: sender,
      wabaId: 'waba_123',
      phoneNumberId: 'phone_123',
      accessToken: 'access-token',
      connectedAt: new Date().toISOString(),
      status: 'connected',
    });

    const doneResponse = await send('done');

    expect(doneResponse.message).toContain('Upload your business logo');
    expect((await conversationStateService.get(sender))?.step).toBe('ASK_LOGO');
  });

  it('Done before callback keeps waiting for Meta confirmation', async () => {
    await send('Hi');
    await send('Yes');
    await send('Kleva Foods');
    await send('Food');
    await send('+2348011111111');
    await send('Africa/Lagos');

    const response = await send('done');

    expect(response.message).toContain('still waiting for Meta');
    expect((await conversationStateService.get(sender))?.step).toBe(
      'WAITING_FOR_EMBEDDED_SIGNUP',
    );
  });

  it('Done after callback continues to logo upload', async () => {
    await send('Hi');
    await send('Yes');
    await send('Kleva Foods');
    await send('Food');
    await send('+2348011111111');
    await send('Africa/Lagos');

    const state = await conversationStateService.get(sender);
    const businessId = state?.businessId;

    expect(businessId).toBeDefined();

    if (!businessId) {
      return;
    }

    await businessRegistrationService.saveEmbeddedSignupConnection({
      businessId,
      ownerWhatsappId: sender,
      wabaId: 'waba_123',
      phoneNumberId: 'phone_123',
      accessToken: 'access-token',
      connectedAt: new Date().toISOString(),
      status: 'connected',
    });

    const response = await send('done');

    expect(response.message).toContain('Upload your business logo');
    expect((await conversationStateService.get(sender))?.step).toBe('ASK_LOGO');
  });

  it('Full successful registration path with current WhatsApp number still works', async () => {
    await send('Hi');
    await send('Yes');
    await send('Kleva Foods');
    await send('1');
    await send('+2348011111111');

    const connectPrompt = await send('Africa/Lagos');

    expect(connectPrompt.message).toContain(
      'Do you want to connect your business WhatsApp number?',
    );

    const connectChoice = await send('2');

    expect(connectChoice.message).toContain(
      'Using your current WhatsApp number for the business.',
    );

    await send('logo-placeholder', 'image');
    await send('We help small businesses sell on WhatsApp');

    const doneResponse = await send('Mon-Fri 9am-5pm');

    expect(doneResponse.message).toContain(
      'Your business is now registered with Kleva',
    );

    const state = await conversationStateService.get(sender);
    expect(state?.step).toBe('DONE');
    expect(state?.profile.logoUploaded).toBe(true);
    expect(state?.profile.description).toBe(
      'We help small businesses sell on WhatsApp',
    );
    expect(state?.profile.openingHours).toBe('Mon-Fri 9am-5pm');

    const businessId = state?.businessId;
    expect(businessId).toBeDefined();

    const business = businessId
      ? await businessRegistrationService.getBusinessById(businessId)
      : undefined;
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

  it('Invalid industry input asks the user to retry', async () => {
    await send('Hi');
    await send('Yes');
    await send('Kleva Foods');

    const response = await send('invalid-industry');

    expect(response.message).toContain('Please choose a valid industry option.');
    expect((await conversationStateService.get(sender))?.step).toBe(
      'ASK_INDUSTRY',
    );
  });

  it('Choosing Continue with this number uses sender WhatsApp number', async () => {
    await send('Hi');
    await send('Yes');
    await send('Kleva Foods');
    await send('Food');
    await send('+2348011111111');
    await send('Africa/Lagos');

    const response = await send('Continue with this number');

    expect(response.message).toContain(
      'Using your current WhatsApp number for the business.',
    );
    expect((await conversationStateService.get(sender))?.connectionChoice).toBe(
      'current',
    );

    const state = await conversationStateService.get(sender);
    const business = state?.businessId
      ? await businessRegistrationService.getBusinessById(state.businessId)
      : undefined;

    expect(business?.whatsapp_number).toBe(sender);
  });
});
