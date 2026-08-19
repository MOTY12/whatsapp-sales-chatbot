import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  ownerWhatsappId: string;
  stage: string;
  notes: string[];
  paid?: boolean;
  createdAt: string;
}

@Injectable()
export class CustomerService {
  private readonly store = new Map<string, Customer[]>();

  create(ownerWhatsappId: string, name: string, phone?: string): Customer {
    const customer: Customer = {
      id: uuidv4(),
      name,
      phone,
      ownerWhatsappId,
      stage: 'New',
      notes: [],
      paid: false,
      createdAt: new Date().toISOString(),
    };

    const list = this.store.get(ownerWhatsappId) ?? [];
    list.push(customer);
    this.store.set(ownerWhatsappId, list);

    return customer;
  }

  findByName(ownerWhatsappId: string, name: string): Customer | undefined {
    const list = this.store.get(ownerWhatsappId) ?? [];
    return list.find((c) => c.name.toLowerCase() === name.toLowerCase());
  }

  findByPhone(ownerWhatsappId: string, phone: string): Customer | undefined {
    const list = this.store.get(ownerWhatsappId) ?? [];
    return list.find((c) => c.phone === phone || c.phone === phone.replace(/[^\d+]/g, ''));
  }

  list(ownerWhatsappId: string): Customer[] {
    return this.store.get(ownerWhatsappId) ?? [];
  }

  addNote(ownerWhatsappId: string, customerId: string, note: string) {
    const list = this.store.get(ownerWhatsappId) ?? [];
    const cust = list.find((c) => c.id === customerId);
    if (cust) {
      cust.notes.push(note);
    }
  }

  markPaid(ownerWhatsappId: string, customerId: string) {
    const list = this.store.get(ownerWhatsappId) ?? [];
    const cust = list.find((c) => c.id === customerId);
    if (cust) {
      cust.paid = true;
    }
  }

  moveStage(ownerWhatsappId: string, customerId: string, stage: string) {
    const list = this.store.get(ownerWhatsappId) ?? [];
    const cust = list.find((c) => c.id === customerId);
    if (cust) {
      cust.stage = stage;
    }
  }
}
