import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Customer } from './customer.entity';
import { Conversation } from './conversation.entity';
import { FollowUp } from './follow-up.entity';
import { Task } from './task.entity';
import { AuditLog } from './audit-log.entity';
import { Sale } from './sale.entity';

@Entity('businesses')
@Index(['whatsappNumber'], { unique: true })
@Index(['phoneNumberId'], { unique: true })
export class Business {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  industry: string;

  @Column()
  phone: string;

  @Column()
  whatsappNumber: string;

  @Column({ type: 'varchar', nullable: true, unique: true })
  phoneNumberId: string | null;

  @Column({ type: 'text', nullable: true })
  accessToken: string | null;

  @Column({ type: 'varchar', nullable: true })
  wabaId: string | null;

  @Column({ type: 'varchar', nullable: true })
  displayPhoneNumber: string | null;

  @Column({ type: 'timestamp', nullable: true })
  connectedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  timezone: string | null;

  @Column({ default: 'active' })
  status: 'active' | 'inactive' | 'suspended';

  @Column({ type: 'jsonb', nullable: true })
  config: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => User, (user) => user.business, { cascade: true })
  users: User[];

  @OneToMany(() => Customer, (customer) => customer.business, { cascade: true })
  customers: Customer[];

  @OneToMany(() => Conversation, (conversation) => conversation.business, {
    cascade: true,
  })
  conversations: Conversation[];

  @OneToMany(() => FollowUp, (followUp) => followUp.business, { cascade: true })
  followUps: FollowUp[];

  @OneToMany(() => Task, (task) => task.business, { cascade: true })
  tasks: Task[];

  @OneToMany(() => AuditLog, (auditLog) => auditLog.business, { cascade: true })
  auditLogs: AuditLog[];

  @OneToMany(() => Sale, (sale) => sale.business, { cascade: true })
  sales: Sale[];
}
