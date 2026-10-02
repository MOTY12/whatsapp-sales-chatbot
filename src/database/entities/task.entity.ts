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
import { User } from './user.entity';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high';

@Entity('tasks')
@Index(['businessId', 'status', 'dueDate'])
@Index(['ownerId', 'status'])
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  businessId: string;

  @Column({ nullable: true })
  ownerId: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column()
  dueDate: Date;

  @Column({ default: 'pending' })
  status: TaskStatus;

  @Column({ default: 'medium' })
  priority: TaskPriority;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Business, (business) => business.tasks, { onDelete: 'CASCADE' })
  business: Business;

  @ManyToOne(() => User, (user) => user.tasks, { nullable: true, onDelete: 'SET NULL' })
  owner: User;
}
