import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'sales_qualification_policies', schema: 'public' })
export class SalesQualificationPolicy {
  @PrimaryColumn('uuid') business_id!: string;
  @PrimaryColumn('integer') version!: number;
  @Column('jsonb') fields!: Record<string, unknown>[];
  @Column('uuid') changed_by!: string;
  @CreateDateColumn({ type: 'timestamptz' }) created_at!: Date;
}
