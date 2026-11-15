import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('merchant_product_revisions')
@Index('UQ_merchant_product_revision', ['product_id', 'revision'], {
  unique: true,
})
export class MerchantProductRevision {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') business_id: string;
  @Column('uuid') product_id: string;
  @Column('integer') revision: number;
  @Column('varchar', { length: 160 }) name: string;
  @Column('varchar', { length: 4000 }) description: string;
  @Column('varchar', { length: 100, nullable: true }) sku: string | null;
  @Column('numeric', { precision: 14, scale: 2, nullable: true })
  price: string | null;
  @Column('char', { length: 3, default: 'NGN' }) currency: string;
  @Column('varchar', { length: 16, default: 'UNKNOWN' })
  availability: 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN';
  @Column('uuid', { nullable: true }) created_by: string | null;
  @Column('timestamptz') created_at: Date;
}
