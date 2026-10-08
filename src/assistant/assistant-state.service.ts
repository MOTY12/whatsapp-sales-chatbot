import { Injectable } from '@nestjs/common';
import { AssistantPendingFlow } from './types/assistant.types';
import { AssistantSessionRepository } from '../database/repositories/assistant-session.repository';

@Injectable()
export class AssistantStateService {
  constructor(private readonly sessions: AssistantSessionRepository) {}

  async get(
    businessId: string,
    ownerId: string,
  ): Promise<AssistantPendingFlow | undefined> {
    const session = await this.sessions.findByBusinessAndOwner(
      businessId,
      ownerId,
    );
    return session
      ? {
          type: session.flow as AssistantPendingFlow['type'],
          step: session.step,
          draft: session.draft,
        }
      : undefined;
  }

  async set(businessId: string, ownerId: string, flow: AssistantPendingFlow) {
    await this.sessions.save({
      businessId,
      ownerId,
      flow: flow.type,
      step: flow.step,
      draft: flow.draft,
    });
  }

  async clear(businessId: string, ownerId: string) {
    await this.sessions.clear(businessId, ownerId);
  }
}
