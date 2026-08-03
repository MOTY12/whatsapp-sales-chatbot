import { Injectable } from '@nestjs/common';
import { ConversationState } from '../whatsapp/types/whatsapp.types';

@Injectable()
export class ConversationStateService {
  private readonly states = new Map<string, ConversationState>();

  getOrCreate(whatsappId: string): ConversationState {
    const existingState = this.states.get(whatsappId);

    if (existingState) {
      return existingState;
    }

    const state: ConversationState = {
      whatsappId,
      step: 'IDLE',
      draftBusiness: {},
      profile: {},
    };

    this.states.set(whatsappId, state);

    return state;
  }

  save(state: ConversationState): ConversationState {
    this.states.set(state.whatsappId, state);

    return state;
  }

  reset(whatsappId: string): ConversationState {
    const state: ConversationState = {
      whatsappId,
      step: 'IDLE',
      draftBusiness: {},
      profile: {},
    };

    this.states.set(whatsappId, state);

    return state;
  }

  get(whatsappId: string): ConversationState | undefined {
    return this.states.get(whatsappId);
  }
}