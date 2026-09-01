import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';

@Injectable()
export class UserRepository {
  constructor(
    @InjectRepository(User)
    private repository: Repository<User>,
  ) {}

  async create(data: Partial<User>): Promise<User> {
    const user = this.repository.create(data);
    return this.repository.save(user);
  }

  async findById(id: string): Promise<User | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repository.findOne({ where: { email } });
  }

  async findByBusinessId(businessId: string): Promise<User[]> {
    return this.repository.find({
      where: { businessId },
      order: { createdAt: 'DESC' },
    });
  }

  async findByBusinessAndEmail(
    businessId: string,
    email: string,
  ): Promise<User | null> {
    return this.repository.findOne({
      where: { businessId, email },
    });
  }

  async update(id: string, data: Partial<User>): Promise<User | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  async countByBusinessId(businessId: string): Promise<number> {
    return this.repository.count({ where: { businessId } });
  }
}
