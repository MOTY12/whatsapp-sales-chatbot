import { Injectable } from '@nestjs/common';
import { Sale } from '../database/entities/sale.entity';
import { SaleRepository } from '../database/repositories/sale.repository';
import { businessDayRange } from './business-date-range';

@Injectable()
export class SalesService {
  constructor(private readonly sales: SaleRepository) {}

  async recordSale(
    businessId: string,
    ownerId: string,
    sale: Pick<Sale, 'amount' | 'product' | 'customerId'>,
  ): Promise<Sale> {
    return this.sales.create({ ...sale, businessId, ownerId });
  }

  async listForToday(
    businessId: string,
    ownerId: string,
    timezone: string,
    now: Date = new Date(),
  ): Promise<Sale[]> {
    const { start, end } = businessDayRange(now, timezone);
    return this.sales.findByBusinessAndOwnerForDateRange(
      businessId,
      ownerId,
      start,
      end,
    );
  }
}
