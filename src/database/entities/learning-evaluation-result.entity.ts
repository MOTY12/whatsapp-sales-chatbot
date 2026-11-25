import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('learning_evaluation_results')
export class LearningEvaluationResult {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') business_id: string;
  @Column('uuid') run_id: string;
  @Column('varchar') case_id: string;
  @Column('varchar') question: string;
  @Column('varchar') before_outcome: string;
  @Column('varchar', { nullable: true }) after_outcome: string | null;
  @Column('uuid') expected_source_id: string;
  @Column('jsonb') before_evidence: Array<Record<string, string>>;
  @Column('jsonb') after_evidence: Array<Record<string, string>>;
  @Column('boolean', { nullable: true }) grounded: boolean | null;
  @Column('boolean', { nullable: true }) citations_valid: boolean | null;
  @Column('jsonb') model_configuration: Record<string, string>;
  @Column('varchar', { nullable: true }) failure_category: string | null;
  @Column('timestamptz', { nullable: true }) evaluated_at: Date | null;
}
