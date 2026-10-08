import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssistantSession } from '../entities/assistant-session.entity';

@Injectable()
export class AssistantSessionRepository {
  constructor(
    @InjectRepository(AssistantSession)
    private readonly repository: Repository<AssistantSession>,
  ) {}

  async findByBusinessAndOwner(
    businessId: string,
    ownerId: string,
  ): Promise<AssistantSession | null> {
    return this.repository.findOne({ where: { businessId, ownerId } });
  }

  async save(data: Partial<AssistantSession>): Promise<AssistantSession> {
    const existing =
      data.businessId && data.ownerId
        ? await this.findByBusinessAndOwner(data.businessId, data.ownerId)
        : null;
    return this.repository.save(
      this.repository.create({ ...existing, ...data, id: existing?.id }),
    );
  }

  async clear(businessId: string, ownerId: string): Promise<void> {
    await this.repository.delete({ businessId, ownerId });
  }
}
