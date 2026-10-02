import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { OnboardingStep } from '../../whatsapp/types/whatsapp.types';

@Entity('onboarding_sessions')
@Index(['whatsappId'], { unique: true })
export class OnboardingSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  whatsappId: string;

  @Column({ default: 'IDLE' })
  step: OnboardingStep;

  @Column({ type: 'jsonb', default: {} })
  draftBusiness: Record<string, unknown>;

  @Column({ type: 'jsonb', default: {} })
  profile: Record<string, unknown>;

  @Column({ type: 'varchar', nullable: true })
  businessId: string | null;

  @Column({ type: 'varchar', nullable: true })
  ownerId: string | null;

  @Column({ type: 'varchar', nullable: true })
  connectionChoice: 'connect' | 'current' | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
