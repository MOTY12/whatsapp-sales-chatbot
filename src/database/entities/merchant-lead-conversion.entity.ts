import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'merchant_lead_conversions', schema: 'public' })
@Index(
  'uq_merchant_lead_conversions_business_lead',
  ['business_id', 'lead_id'],
  { unique: true },
)
export class MerchantLeadConversion {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') business_id!: string;
  @Column('uuid') lead_id!: string;
  @Column({ type: 'varchar', length: 8 }) outcome!: 'WON' | 'LOST';
  @Column({ type: 'varchar', length: 120, nullable: true })
  reference!: string | null;
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  conversion_value!: string | null;
  @Column({ type: 'char', length: 3, nullable: true }) currency!: string | null;
  @Column({ type: 'date', nullable: true }) conversion_date!: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true })
  loss_reason!: string | null;
  @Column('uuid') converted_by!: string;
  @Column('uuid') idempotency_key!: string;
  @CreateDateColumn({ type: 'timestamptz' }) created_at!: Date;
}
