import { Injectable } from '@nestjs/common';
import { ConversationState } from '../whatsapp/types/whatsapp.types';
import { OnboardingSessionRepository } from '../database/repositories/onboarding-session.repository';

@Injectable()
export class ConversationStateService {
  constructor(private readonly sessions: OnboardingSessionRepository) {}

  async getOrCreate(whatsappId: string): Promise<ConversationState> {
    const existingState = await this.sessions.findByWhatsappId(whatsappId);

    if (existingState) {
      return this.toState(existingState);
    }

    const state: ConversationState = {
      whatsappId,
      step: 'IDLE',
      draftBusiness: {},
      profile: {},
    };

    return this.save(state);
  }

  async save(state: ConversationState): Promise<ConversationState> {
    const session = await this.sessions.save({
      whatsappId: state.whatsappId,
      step: state.step,
      draftBusiness: state.draftBusiness,
      profile: state.profile,
      businessId: state.businessId ?? null,
      ownerId: state.ownerId ?? null,
      connectionChoice: state.connectionChoice ?? null,
    });
    return this.toState(session);
  }

  async reset(whatsappId: string): Promise<ConversationState> {
    const state: ConversationState = {
      whatsappId,
      step: 'IDLE',
      draftBusiness: {},
      profile: {},
    };

    return this.save(state);
  }

  async get(whatsappId: string): Promise<ConversationState | undefined> {
    const session = await this.sessions.findByWhatsappId(whatsappId);
    return session ? this.toState(session) : undefined;
  }

  private toState(session: {
    whatsappId: string;
    step: ConversationState['step'];
    draftBusiness: Record<string, unknown>;
    profile: Record<string, unknown>;
    businessId: string | null;
    ownerId: string | null;
    connectionChoice: 'connect' | 'current' | null;
  }): ConversationState {
    return {
      whatsappId: session.whatsappId,
      step: session.step,
      draftBusiness:
        session.draftBusiness as ConversationState['draftBusiness'],
      profile: session.profile as ConversationState['profile'],
      businessId: session.businessId ?? undefined,
      ownerId: session.ownerId ?? undefined,
      connectionChoice: session.connectionChoice ?? undefined,
    };
  }
}
