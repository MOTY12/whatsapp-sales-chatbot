import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  Index,
} from 'typeorm';
import { Business } from './business.entity';
import { Customer } from './customer.entity';
import { User } from './user.entity';

export type ReminderType = 'due_today' | 'tomorrow' | 'overdue' | 'scheduled';
export type ReminderStatus = 'pending' | 'completed' | 'rescheduled' | 'skipped';

@Entity('follow_ups')
@Index(['businessId', 'status', 'dueDate'])
@Index(['customerId', 'status'])
export class FollowUp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  businessId: string;

  @Column()
  customerId: string;

  @Column({ nullable: true })
  ownerId: string;

  @Column()
  dueDate: Date;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: 'pending' })
  status: ReminderStatus;

  @Column({ type: 'text', nullable: true })
  suggestedMessage: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Business, (business) => business.followUps, { onDelete: 'CASCADE' })
  business: Business;

  @ManyToOne(() => Customer, (customer) => customer.followUps, { onDelete: 'CASCADE' })
  customer: Customer;

  @ManyToOne(() => User, (user) => user.followUps, { nullable: true, onDelete: 'SET NULL' })
  owner: User;
}
