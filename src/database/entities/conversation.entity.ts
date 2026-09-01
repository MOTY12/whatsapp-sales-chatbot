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
import { Message } from './message.entity';

@Entity('conversations')
@Index(['businessId', 'customerId'])
@Index(['businessId', 'createdAt'])
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  businessId: string;

  @Column()
  customerId: string;

  @Column({ nullable: true })
  status: string;

  @Column({ type: 'text', nullable: true })
  summary: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Business, (business) => business.conversations, { onDelete: 'CASCADE' })
  business: Business;

  @ManyToOne(() => Customer, (customer) => customer.conversations, { onDelete: 'CASCADE' })
  customer: Customer;

  @OneToMany(() => Message, (message) => message.conversation, { cascade: true })
  messages: Message[];
}
