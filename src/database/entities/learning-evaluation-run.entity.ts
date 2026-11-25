import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('learning_evaluation_runs')
export class LearningEvaluationRun {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') business_id: string;
  @Column('uuid') suggestion_id: string;
  @Column('integer') suggestion_version: number;
  @Column('uuid') approved_revision_id: string;
  @Column('uuid') approved_faq_id: string;
  @Column('uuid', { nullable: true }) previous_revision_id: string | null;
  @Column('varchar') status: string;
  @Column('varchar', { nullable: true }) failure_category: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @Column('timestamptz', { nullable: true }) completed_at: Date | null;
}
