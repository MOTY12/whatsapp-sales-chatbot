import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('merchant_products')
@Index('UQ_merchant_product_creation', ['business_id', 'creation_key'], {
  unique: true,
})
export class MerchantProduct {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') business_id: string;
  @Column('uuid') creation_key: string;
  @Column('text') creation_fingerprint: string;
  @Column('uuid', { nullable: true }) created_by: string | null;
  @Column('uuid', { nullable: true }) updated_by: string | null;
  @Column('uuid', { nullable: true }) draft_revision_id: string | null;
  @Column('uuid', { nullable: true }) published_revision_id: string | null;
  @Column('timestamptz', { nullable: true }) published_at: Date | null;
  @Column('timestamptz') created_at: Date;
  @Column('timestamptz') updated_at: Date;
}
