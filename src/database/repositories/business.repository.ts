import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Business } from '../entities/business.entity';

@Injectable()
export class BusinessRepository {
  constructor(
    @InjectRepository(Business)
    private repository: Repository<Business>,
  ) {}

  async create(data: Partial<Business>): Promise<Business> {
    const business = this.repository.create(data);
    return this.repository.save(business);
  }

  async findById(id: string): Promise<Business | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByPhoneNumberId(phoneNumberId: string): Promise<Business | null> {
    return this.repository.findOne({ where: { phoneNumberId } });
  }

  async findByWhatsappNumber(whatsappNumber: string): Promise<Business | null> {
    return this.repository.findOne({ where: { whatsappNumber } });
  }

  async findAll(filters?: { status?: string }): Promise<Business[]> {
    const query = this.repository.createQueryBuilder('business');
    if (filters?.status) {
      query.where('business.status = :status', { status: filters.status });
    }
    return query.getMany();
  }

  async update(id: string, data: Partial<Business>): Promise<Business | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  async countAll(): Promise<number> {
    return this.repository.count();
  }
}
