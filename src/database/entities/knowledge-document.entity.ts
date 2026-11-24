import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('knowledge_documents')
export class KnowledgeDocument {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') business_id: string;
  @Column('varchar') title: string;
  @Column('varchar') status: string;
  @Column('uuid', { nullable: true }) draft_revision_id: string | null;
  @Column('uuid', { nullable: true }) published_revision_id: string | null;
  @Column('timestamptz') created_at: Date;
  @Column('timestamptz') updated_at: Date;
}
