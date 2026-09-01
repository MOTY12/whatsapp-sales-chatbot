import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  Index,
} from 'typeorm';
import { Conversation } from './conversation.entity';

export type MessageDirection = 'inbound' | 'outbound';
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

@Entity('messages')
@Index(['conversationId', 'createdAt'])
@Index(['businessId'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  conversationId: string;

  @Column()
  businessId: string;

  @Column()
  direction: MessageDirection;

  @Column({ type: 'text' })
  content: string;

  @Column({ default: 'sent' })
  status: MessageStatus;

  @Column({ nullable: true })
  whatsappMessageId: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages, {
    onDelete: 'CASCADE',
  })
  conversation: Conversation;
}
