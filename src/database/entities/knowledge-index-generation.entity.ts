import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('knowledge_index_generations')
@Index('idx_knowledge_generation_source', [
  'business_id',
  'source_type',
  'source_id',
  'created_at',
])
export class KnowledgeIndexGeneration {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') business_id: string;
  @Column('uuid') request_key: string;
  @Column('varchar') source_type: 'FAQ' | 'PRODUCT' | 'DOCUMENT';
  @Column('uuid') source_id: string;
  @Column('uuid') source_revision_id: string;
  @Column('varchar') embedding_provider: string;
  @Column('varchar') embedding_model: string;
  @Column('integer') embedding_dimensions: number;
  @Column('varchar') chunking_version: string;
  @Column('varchar') status: string;
  @Column('integer') expected_chunk_count: number;
  @Column('integer') indexed_chunk_count: number;
  @Column('varchar', { nullable: true }) failure_category: string | null;
  @Column('timestamptz') created_at: Date;
  @Column('timestamptz', { nullable: true }) activated_at: Date | null;
}
