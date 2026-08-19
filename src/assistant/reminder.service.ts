import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

export interface Reminder {
  id: string;
  ownerWhatsappId: string;
  text: string;
  when: string; // ISO
  done?: boolean;
}

@Injectable()
export class ReminderService {
  private readonly store = new Map<string, Reminder[]>();

  create(ownerWhatsappId: string, text: string, when: Date): Reminder {
    const r: Reminder = {
      id: uuidv4(),
      ownerWhatsappId,
      text,
      when: when.toISOString(),
      done: false,
    };

    const list = this.store.get(ownerWhatsappId) ?? [];
    list.push(r);
    this.store.set(ownerWhatsappId, list);

    return r;
  }

  listForDate(ownerWhatsappId: string, date: Date): Reminder[] {
    const list = this.store.get(ownerWhatsappId) ?? [];
    const day = date.toISOString().slice(0, 10);
    return list.filter((r) => r.when.slice(0, 10) === day && !r.done);
  }

  listOverdue(ownerWhatsappId: string, now: Date): Reminder[] {
    const list = this.store.get(ownerWhatsappId) ?? [];
    return list.filter((r) => new Date(r.when) < now && !r.done);
  }
}
