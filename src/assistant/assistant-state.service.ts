import { Injectable } from '@nestjs/common';
import { AssistantPendingFlow } from './types/assistant.types';

@Injectable()
export class AssistantStateService {
  private readonly pending = new Map<string, AssistantPendingFlow>();

  get(sellerId: string): AssistantPendingFlow | undefined {
    return this.pending.get(sellerId);
  }

  set(sellerId: string, flow: AssistantPendingFlow) {
    this.pending.set(sellerId, flow);
  }

  clear(sellerId: string) {
    this.pending.delete(sellerId);
  }
}
