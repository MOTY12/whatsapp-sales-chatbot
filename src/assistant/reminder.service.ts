import { Injectable } from '@nestjs/common';
import { Customer } from '../database/entities/customer.entity';
import { FollowUp } from '../database/entities/follow-up.entity';
import { FollowUpRepository } from '../database/repositories/follow-up.repository';
import { businessDayRange } from './business-date-range';

@Injectable()
export class ReminderService {
  constructor(private readonly followUps: FollowUpRepository) {}

  async create(
    businessId: string,
    ownerId: string,
    customer: Customer,
    title: string,
    dueDate: Date,
  ): Promise<FollowUp> {
    return this.followUps.create({
      businessId,
      ownerId,
      customerId: customer.id,
      title: title.trim(),
      dueDate,
      status: 'pending',
    });
  }

  async listForToday(
    businessId: string,
    ownerId: string,
    timezone: string,
    now: Date = new Date(),
  ): Promise<FollowUp[]> {
    const { start, end } = businessDayRange(now, timezone);
    return this.followUps.findDueForBusinessAndOwnerInRange(
      businessId,
      ownerId,
      start,
      end,
    );
  }

  async listOverdue(
    businessId: string,
    ownerId: string,
    timezone: string,
    now: Date = new Date(),
  ): Promise<FollowUp[]> {
    const { start } = businessDayRange(now, timezone);
    return this.followUps.findOverdueForBusinessAndOwner(
      businessId,
      ownerId,
      start,
    );
  }
}
