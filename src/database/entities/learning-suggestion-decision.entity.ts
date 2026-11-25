import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('learning_suggestion_decisions')
export class LearningSuggestionDecision {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') business_id: string;
  @Column('uuid') suggestion_id: string;
  @Column('integer') suggestion_version: number;
  @Column('varchar', { nullable: true }) from_status: string | null;
  @Column('varchar') to_status: string;
  @Column('uuid', { nullable: true }) actor_account_id: string | null;
  @Column('varchar', { nullable: true }) reason_code: string | null;
  @Column('uuid', { nullable: true }) generation_id: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) occurred_at: Date;
}
