import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'agent_tool_executions', schema: 'public' })
@Index(
  'uq_agent_tool_execution_idempotency',
  ['business_id', 'idempotency_key'],
  {
    unique: true,
  },
)
export class AgentToolExecution {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') business_id!: string;
  @Column('uuid') conversation_id!: string;
  @Column('uuid') ai_run_id!: string;
  @Column({ type: 'varchar', length: 48 }) tool_name!: string;
  @Column('integer') tool_version!: number;
  @Column('uuid') idempotency_key!: string;
  @Column({ type: 'char', length: 64 }) arguments_sha256!: string;
  @Column({ type: 'varchar', length: 12 }) status!:
    'STARTED' | 'COMPLETED' | 'FAILED';
  @Column({ type: 'varchar', length: 32, nullable: true })
  result_classification!: string | null;
  @Column('jsonb') safe_result!: Record<string, unknown>;
  @CreateDateColumn({ type: 'timestamptz' }) started_at!: Date;
  @Column({ type: 'timestamptz', nullable: true }) completed_at!: Date | null;
  @Column({ type: 'integer', nullable: true }) duration_ms!: number | null;
}
