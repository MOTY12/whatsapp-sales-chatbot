import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from '../entities/message.entity';

@Injectable()
export class MessageRepository {
  constructor(
    @InjectRepository(Message) private readonly repository: Repository<Message>,
  ) {}

  async findByProviderId(whatsappMessageId: string): Promise<Message | null> {
    return this.repository.findOne({ where: { whatsappMessageId } });
  }

  async create(data: Partial<Message>): Promise<Message> {
    return this.repository.save(this.repository.create(data));
  }
}
