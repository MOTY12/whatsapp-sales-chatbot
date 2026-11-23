import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'merchant_lead_qualifications', schema: 'public' })
@Index(
  'uq_merchant_lead_qualifications_revision',
  ['business_id', 'lead_id', 'revision'],
  { unique: true },
)
export class MerchantLeadQualification {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') business_id!: string;
  @Column('uuid') lead_id!: string;
  @Column('integer') revision!: number;
  @Column('integer') policy_version!: number;
  @Column('jsonb') field_values!: Record<string, unknown>;
  @Column('jsonb') consent_evidence!: Record<string, unknown>;
  @Column({ type: 'varchar', length: 16 })
  qualification_status!: 'IN_PROGRESS' | 'QUALIFIED';
  @Column('uuid', { nullable: true }) qualified_by!: string | null;
  @Column('timestamptz', { nullable: true }) qualified_at!: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at!: Date;
}
