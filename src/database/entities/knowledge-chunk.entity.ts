import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('knowledge_chunks')
export class KnowledgeChunk {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') business_id: string;
  @Column('uuid') generation_id: string;
  @Column('varchar') source_type: string;
  @Column('uuid') source_id: string;
  @Column('uuid') source_revision_id: string;
  @Column('integer') chunk_index: number;
  @Column('integer', { nullable: true }) page_number: number | null;
  @Column('integer') source_start_offset: number;
  @Column('integer') source_end_offset: number;
  @Column('varchar') title: string;
  @Column('text') content: string;
  @Column('char', { length: 64 }) checksum_sha256: string;
  @Column('integer') token_count: number;
  @Column('vector', { length: 1536 }) embedding: number[];
  @Column('timestamptz') created_at: Date;
}
