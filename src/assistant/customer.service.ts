import { Injectable } from '@nestjs/common';
import {
  Customer,
  CustomerLeadStage,
} from '../database/entities/customer.entity';
import { CustomerRepository } from '../database/repositories/customer.repository';

@Injectable()
export class CustomerService {
  constructor(private readonly customers: CustomerRepository) {}

  async create(
    businessId: string,
    ownerId: string,
    name: string,
    phone: string,
  ): Promise<Customer> {
    const normalizedPhone = phone.replace(/\D/g, '');
    return this.customers.create({
      businessId,
      ownerId,
      name: name.trim(),
      phone: normalizedPhone,
      whatsappId: normalizedPhone,
      source: 'assistant',
      leadStage: 'New Lead',
      lastInteraction: new Date(),
    });
  }

  async findByName(
    businessId: string,
    ownerId: string,
    name: string,
  ): Promise<Customer | null> {
    return this.customers.findByNameForOwner(name.trim(), businessId, ownerId);
  }

  async findByPhone(
    businessId: string,
    ownerId: string,
    phone: string,
  ): Promise<Customer | null> {
    return this.customers.findByPhoneForOwner(
      phone.replace(/\D/g, ''),
      businessId,
      ownerId,
    );
  }

  async list(businessId: string, ownerId: string): Promise<Customer[]> {
    return this.customers.findByBusinessAndOwner(businessId, ownerId);
  }

  async count(businessId: string, ownerId: string): Promise<number> {
    return this.customers.countByBusinessAndOwner(businessId, ownerId);
  }

  async addNote(customer: Customer, note: string): Promise<Customer | null> {
    return this.customers.update(customer.id, {
      notes: [customer.notes, note.trim()].filter(Boolean).join('\n'),
    });
  }

  async markPaid(customer: Customer): Promise<Customer | null> {
    return this.customers.updateStage(customer.id, 'Paid');
  }

  async moveStage(
    customer: Customer,
    stage: CustomerLeadStage,
  ): Promise<Customer | null> {
    return this.customers.updateStage(customer.id, stage);
  }
}
