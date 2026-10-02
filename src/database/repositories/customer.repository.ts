import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { Customer, CustomerLeadStage } from '../entities/customer.entity';

@Injectable()
export class CustomerRepository {
  constructor(
    @InjectRepository(Customer)
    private repository: Repository<Customer>,
  ) {}

  async create(data: Partial<Customer>): Promise<Customer> {
    const customer = this.repository.create(data);
    return this.repository.save(customer);
  }

  async findById(id: string): Promise<Customer | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByPhoneAndBusiness(phone: string, businessId: string): Promise<Customer | null> {
    return this.repository.findOne({
      where: { phone, businessId },
    });
  }

  async findByWhatsappIdAndBusiness(whatsappId: string, businessId: string): Promise<Customer | null> {
    return this.repository.findOne({
      where: { whatsappId, businessId },
    });
  }

  async findByNameAndBusiness(name: string, businessId: string): Promise<Customer | null> {
    return this.repository.findOne({
      where: { name, businessId },
    });
  }

  async findByBusinessId(businessId: string): Promise<Customer[]> {
    return this.repository.find({
      where: { businessId },
      order: { createdAt: 'DESC' },
    });
  }

  async findByStageAndBusiness(
    stage: CustomerLeadStage,
    businessId: string,
  ): Promise<Customer[]> {
    return this.repository.find({
      where: { leadStage: stage, businessId },
      order: { createdAt: 'DESC' },
    });
  }

  async findByOwnerAndBusiness(ownerId: string, businessId: string): Promise<Customer[]> {
    return this.repository.find({
      where: { ownerId, businessId },
      order: { createdAt: 'DESC' },
    });
  }

  async findRecentByBusiness(businessId: string, limit: number = 10): Promise<Customer[]> {
    return this.repository.find({
      where: { businessId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async update(id: string, data: Partial<Customer>): Promise<Customer | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async updateStage(
    customerId: string,
    newStage: CustomerLeadStage,
  ): Promise<Customer | null> {
    return this.update(customerId, { leadStage: newStage });
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  async countByBusinessId(businessId: string): Promise<number> {
    return this.repository.count({ where: { businessId } });
  }

  async countByStageAndBusiness(
    stage: CustomerLeadStage,
    businessId: string,
  ): Promise<number> {
    return this.repository.count({
      where: { leadStage: stage, businessId },
    });
  }

  async getTotalLifetimeValue(businessId: string): Promise<number> {
    const result = await this.repository
      .createQueryBuilder('customer')
      .select('SUM(customer.lifetimeValue)', 'total')
      .where('customer.businessId = :businessId', { businessId })
      .getRawOne();
    return parseFloat(result?.total || 0);
  }
}
