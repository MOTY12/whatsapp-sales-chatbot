import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Sale } from '../entities/sale.entity';

@Injectable()
export class SaleRepository {
  constructor(
    @InjectRepository(Sale)
    private readonly repository: Repository<Sale>,
  ) {}

  async create(data: Partial<Sale>): Promise<Sale> {
    return this.repository.save(this.repository.create(data));
  }

  async findByBusinessAndOwnerForDateRange(
    businessId: string,
    ownerId: string,
    start: Date,
    end: Date,
  ): Promise<Sale[]> {
    return this.repository.find({
      where: { businessId, ownerId, createdAt: Between(start, end) },
      order: { createdAt: 'ASC' },
    });
  }
}
