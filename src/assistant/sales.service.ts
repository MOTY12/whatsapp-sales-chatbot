import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

export interface Sale {
  id: string;
  ownerWhatsappId: string;
  customerId?: string;
  amount?: number;
  product?: string;
  createdAt: string;
}

@Injectable()
export class SalesService {
  private readonly store = new Map<string, Sale[]>();

  recordSale(ownerWhatsappId: string, sale: Partial<Sale>): Sale {
    const s: Sale = {
      id: uuidv4(),
      ownerWhatsappId,
      customerId: sale.customerId,
      amount: sale.amount,
      product: sale.product,
      createdAt: new Date().toISOString(),
    };

    const list = this.store.get(ownerWhatsappId) ?? [];
    list.push(s);
    this.store.set(ownerWhatsappId, list);

    return s;
  }

  listForDate(ownerWhatsappId: string, date: Date): Sale[] {
    const list = this.store.get(ownerWhatsappId) ?? [];
    const day = date.toISOString().slice(0, 10);
    return list.filter((s) => s.createdAt.slice(0, 10) === day);
  }
}
