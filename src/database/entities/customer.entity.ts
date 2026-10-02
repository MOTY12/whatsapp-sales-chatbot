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
import { User } from './user.entity';
import { Conversation } from './conversation.entity';
import { FollowUp } from './follow-up.entity';

export type CustomerLeadStage =
  | 'New Lead'
  | 'Interested'
  | 'Negotiating'
  | 'Paid'
  | 'Delivered'
  | 'Lost';

@Entity('customers')
@Index(['businessId', 'phone'], { unique: true })
@Index(['businessId', 'whatsappId'], { unique: true })
@Index(['businessId', 'leadStage'])
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  phone: string;

  @Column()
  whatsappId: string;

  @Column({ nullable: true })
  email: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'simple-array', default: '' })
  tags: string[];

  @Column({ nullable: true })
  source: string;

  @Column({ default: 'New Lead' })
  leadStage: CustomerLeadStage;

  @Column()
  businessId: string;

  @Column({ nullable: true })
  ownerId: string;

  @Column({ default: 0 })
  totalOrders: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  lifetimeValue: number;

  @Column({ nullable: true })
  lastInteraction: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Business, (business) => business.customers, { onDelete: 'CASCADE' })
  business: Business;

  @ManyToOne(() => User, (user) => user.customers, { nullable: true, onDelete: 'SET NULL' })
  owner: User;

  @OneToMany(() => Conversation, (conversation) => conversation.customer, { cascade: true })
  conversations: Conversation[];

  @OneToMany(() => FollowUp, (followUp) => followUp.customer, { cascade: true })
  followUps: FollowUp[];
}
