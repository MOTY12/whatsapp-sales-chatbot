import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type NotificationType = 'reminder' | 'update' | 'alert' | 'summary';
export type NotificationStatus = 'pending' | 'sent' | 'read' | 'failed';

@Entity('notifications')
@Index(['businessId', 'status', 'createdAt'])
@Index(['recipientPhone', 'status'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  businessId: string;

  @Column()
  recipientPhone: string;

  @Column()
  type: NotificationType;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ default: 'pending' })
  status: NotificationStatus;

  @Column({ nullable: true })
  sentAt: Date;

  @Column({ nullable: true })
  readAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
