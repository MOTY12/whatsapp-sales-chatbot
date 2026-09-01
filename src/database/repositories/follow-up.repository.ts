import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FollowUp, ReminderStatus } from '../entities/follow-up.entity';
import { LessThanOrEqual, MoreThanOrEqual } from 'typeorm';

@Injectable()
export class FollowUpRepository {
  constructor(
    @InjectRepository(FollowUp)
    private repository: Repository<FollowUp>,
  ) {}

  async create(data: Partial<FollowUp>): Promise<FollowUp> {
    const followUp = this.repository.create(data);
    return this.repository.save(followUp);
  }

  async findById(id: string): Promise<FollowUp | null> {
    return this.repository.findOne({
      where: { id },
      relations: { customer: true, owner: true },
    });
  }

  async findByBusinessId(businessId: string): Promise<FollowUp[]> {
    return this.repository.find({
      where: { businessId },
      relations: { customer: true, owner: true },
      order: { dueDate: 'ASC' },
    });
  }

  async findByCustomerId(customerId: string): Promise<FollowUp[]> {
    return this.repository.find({
      where: { customerId },
      relations: { owner: true },
      order: { dueDate: 'ASC' },
    });
  }

  async findByOwnerId(ownerId: string): Promise<FollowUp[]> {
    return this.repository.find({
      where: { ownerId },
      relations: { customer: true },
      order: { dueDate: 'ASC' },
    });
  }

  async findPendingByBusinessId(businessId: string): Promise<FollowUp[]> {
    return this.repository.find({
      where: { businessId, status: 'pending' },
      relations: { customer: true, owner: true },
      order: { dueDate: 'ASC' },
    });
  }

  async findDueToday(businessId: string): Promise<FollowUp[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.repository.find({
      where: {
        businessId,
        status: 'pending',
        dueDate: MoreThanOrEqual(today),
      },
      relations: { customer: true, owner: true },
      order: { dueDate: 'ASC' },
    });
  }

  async findOverdue(businessId: string): Promise<FollowUp[]> {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    return this.repository.find({
      where: {
        businessId,
        status: 'pending',
        dueDate: LessThanOrEqual(now),
      },
      relations: { customer: true, owner: true },
      order: { dueDate: 'ASC' },
    });
  }

  async findByDateRange(
    businessId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<FollowUp[]> {
    return this.repository.find({
      where: {
        businessId,
        status: 'pending',
        dueDate: MoreThanOrEqual(startDate),
      },
      relations: { customer: true, owner: true },
      order: { dueDate: 'ASC' },
    });
  }

  async update(id: string, data: Partial<FollowUp>): Promise<FollowUp | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async markComplete(id: string): Promise<FollowUp | null> {
    return this.update(id, { status: 'completed' });
  }

  async markRescheduled(id: string, newDate: Date): Promise<FollowUp | null> {
    return this.update(id, { status: 'rescheduled', dueDate: newDate });
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  async countPendingByBusinessId(businessId: string): Promise<number> {
    return this.repository.count({
      where: { businessId, status: 'pending' },
    });
  }

  async countCompletedByBusinessId(businessId: string): Promise<number> {
    return this.repository.count({
      where: { businessId, status: 'completed' },
    });
  }
}
