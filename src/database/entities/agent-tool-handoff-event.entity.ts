import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'agent_tool_handoff_events', schema: 'public' })
export class AgentToolHandoffEvent {
  @PrimaryColumn('uuid') execution_id!: string;
  @Column('uuid') business_id!: string;
  @Column('uuid') conversation_id!: string;
  @Column('uuid') ai_run_id!: string;
  @Column({ type: 'varchar', length: 32 }) reason_code!: string;
  @Column('bigint') previous_control_version!: string;
  @Column('bigint') new_control_version!: string;
  @CreateDateColumn({ type: 'timestamptz' }) occurred_at!: Date;
}
