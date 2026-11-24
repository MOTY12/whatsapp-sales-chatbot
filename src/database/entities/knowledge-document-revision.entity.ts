import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('knowledge_document_revisions')
export class KnowledgeDocumentRevision {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') business_id: string;
  @Column('uuid') document_id: string;
  @Column('integer') revision: number;
  @Column('varchar') status: string;
  @Column('varchar') object_key: string;
  @Column('varchar', { nullable: true }) object_version_id: string | null;
  @Column('char', { length: 64 }) checksum_sha256: string;
  @Column('integer') size_bytes: number;
  @Column('integer', { nullable: true }) page_count: number | null;
  @Column('timestamptz') created_at: Date;
  @Column('timestamptz') updated_at: Date;
}
