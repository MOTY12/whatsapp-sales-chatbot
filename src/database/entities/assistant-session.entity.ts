import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('assistant_sessions')
@Index(['businessId', 'ownerId'], { unique: true })
export class AssistantSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  businessId: string;

  @Column()
  ownerId: string;

  @Column()
  flow: string;

  @Column({ default: 1 })
  step: number;

  @Column({ type: 'jsonb', default: {} })
  draft: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
