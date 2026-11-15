import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

@Entity('knowledge_faq_revisions')
@Index('UQ_knowledge_faq_revision', ['faq_id', 'revision'], { unique: true })
export class KnowledgeFaqRevision {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') business_id: string;
  @Column('uuid') faq_id: string;
  @Column('integer') revision: number;
  @Column('varchar', { length: 500 }) question: string;
  @Column('varchar', { length: 5000 }) answer: string;
  @Column('uuid', { nullable: true }) created_by: string | null;
  @Column('timestamptz') created_at: Date;
}
