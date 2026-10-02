import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  Index,
} from 'typeorm';
import { Business } from './business.entity';
import { User } from './user.entity';

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'MOVE_STAGE'
  | 'SCHEDULE_FOLLOWUP'
  | 'COMPLETE_FOLLOWUP';

@Entity('audit_logs')
@Index(['businessId', 'createdAt'])
@Index(['userId', 'createdAt'])
@Index(['entityType', 'entityId'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  businessId: string;

  @Column({ nullable: true })
  userId: string;

  @Column()
  entityType: string;

  @Column()
  entityId: string;

  @Column()
  action: AuditAction;

  @Column({ type: 'jsonb', nullable: true })
  oldValue: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  newValue: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  reason: string;

  @Column({ nullable: true })
  ipAddress: string;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Business, (business) => business.auditLogs, { onDelete: 'CASCADE' })
  business: Business;

  @ManyToOne(() => User, (user) => user.auditLogs, { nullable: true, onDelete: 'SET NULL' })
  user: User;
}
