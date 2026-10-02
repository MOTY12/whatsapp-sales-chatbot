import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from '../entities/conversation.entity';

@Injectable()
export class ConversationRepository {
  constructor(
    @InjectRepository(Conversation)
    private readonly repository: Repository<Conversation>,
  ) {}

  async findLatestForCustomer(
    businessId: string,
    customerId: string,
  ): Promise<Conversation | null> {
    return this.repository.findOne({
      where: { businessId, customerId },
      order: { updatedAt: 'DESC' },
    });
  }

  async create(data: Partial<Conversation>): Promise<Conversation> {
    return this.repository.save(this.repository.create(data));
  }

  async touch(id: string): Promise<void> {
    await this.repository.update(id, { updatedAt: new Date() });
  }
}
