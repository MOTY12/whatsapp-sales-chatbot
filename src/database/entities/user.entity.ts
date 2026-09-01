import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  Index,
} from 'typeorm';
import { Business } from './business.entity';
import { Customer } from './customer.entity';
import { FollowUp } from './follow-up.entity';
import { Task } from './task.entity';
import { AuditLog } from './audit-log.entity';

@Entity('users')
@Index(['businessId', 'email'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  email: string;

  @Column()
  password: string;

  @Column()
  firstName: string;

  @Column({ nullable: true })
  lastName: string;

  @Column()
  businessId: string;

  @Column({ default: 'active' })
  status: 'active' | 'inactive';

  @Column({ type: 'simple-array', default: 'user' })
  roles: string[];

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Business, (business) => business.users, { onDelete: 'CASCADE' })
  business: Business;

  @OneToMany(() => Customer, (customer) => customer.owner)
  customers: Customer[];

  @OneToMany(() => FollowUp, (followUp) => followUp.owner)
  followUps: FollowUp[];

  @OneToMany(() => Task, (task) => task.owner)
  tasks: Task[];

  @OneToMany(() => AuditLog, (auditLog) => auditLog.user)
  auditLogs: AuditLog[];
}
