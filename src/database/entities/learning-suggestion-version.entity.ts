import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('learning_suggestion_versions')
export class LearningSuggestionVersion {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') business_id: string;
  @Column('uuid') suggestion_id: string;
  @Column('integer') version: number;
  @Column('varchar') proposed_question: string;
  @Column('varchar') proposed_answer: string;
  @Column('varchar') origin: 'MANUAL' | 'AI_ASSISTED';
  @Column('jsonb') supporting_sources: Record<string, string>[];
  @Column('uuid', { nullable: true }) target_faq_id: string | null;
  @Column('uuid', { nullable: true }) expected_target_revision_id:
    string | null;
  @Column('uuid') created_by: string;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
}
