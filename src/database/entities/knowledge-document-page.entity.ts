import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('knowledge_document_pages')
export class KnowledgeDocumentPage {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') business_id: string;
  @Column('uuid') document_id: string;
  @Column('uuid') revision_id: string;
  @Column('integer') page_number: number;
  @Column('text') content: string;
  @Column('timestamptz') created_at: Date;
}
