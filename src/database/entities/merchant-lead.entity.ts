import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
export type MerchantLeadStatus =
  'NEW' | 'CONTACTED' | 'QUALIFIED' | 'WON' | 'LOST';
@Entity({ name: 'merchant_leads', schema: 'public' })
@Index('uq_merchant_leads_conversation', ['business_id', 'conversation_id'], {
  unique: true,
})
@Index('idx_merchant_leads_activity', ['business_id', 'last_activity_at', 'id'])
export class MerchantLead {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') business_id!: string;
  @Column('uuid') customer_id!: string;
  @Column('uuid') conversation_id!: string;
  @Column({ type: 'varchar', length: 16, default: 'WHATSAPP' })
  source!: 'WHATSAPP';
  @Column({ type: 'varchar', length: 16, default: 'NEW' })
  status!: MerchantLeadStatus;
  @Column('timestamptz') first_contact_at!: Date;
  @Column('timestamptz') last_activity_at!: Date;
  @Column('bigint', { default: 1 }) version!: string;
  @CreateDateColumn({ type: 'timestamptz' }) created_at!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at!: Date;
}
