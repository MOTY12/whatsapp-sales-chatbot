import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('learning_suggestions')
export class LearningSuggestion {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') business_id: string;
  @Column('uuid') gap_cluster_id: string;
  @Column('uuid') create_key: string;
  @Column('char', { length: 64 }) create_fingerprint: string;
  @Column('varchar') status: string;
  @Column('varchar') origin: 'MANUAL' | 'AI_ASSISTED';
  @Column('integer') version: number;
  @Column('varchar') proposed_question: string;
  @Column('varchar') proposed_answer: string;
  @Column('jsonb') supporting_sources: Record<string, string>[];
  @Column('uuid', { nullable: true }) target_faq_id: string | null;
  @Column('uuid', { nullable: true }) expected_target_revision_id:
    string | null;
  @Column('uuid') created_by: string;
  @Column('uuid') updated_by: string;
  @Column('uuid', { nullable: true }) approved_by: string | null;
  @Column('timestamptz', { nullable: true }) approved_at: Date | null;
  @Column('integer', { nullable: true }) approved_version: number | null;
  @Column('uuid', { nullable: true }) approval_key: string | null;
  @Column('uuid', { nullable: true }) approved_faq_id: string | null;
  @Column('uuid', { nullable: true }) approved_revision_id: string | null;
  @Column('uuid', { nullable: true }) generation_id: string | null;
  @Column('varchar') evaluation_status: string;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
}
