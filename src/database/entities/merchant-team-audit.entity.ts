import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('merchant_team_audit')
export class MerchantTeamAudit {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'business_id', type: 'uuid' }) businessId: string;
  @Column({ name: 'actor_account_id', type: 'uuid', nullable: true })
  actorAccountId: string | null;
  @Column({ name: 'target_account_id', type: 'uuid', nullable: true })
  targetAccountId: string | null;
  @Column({ name: 'target_id', type: 'uuid', nullable: true }) targetId:
    string | null;
  @Column({ name: 'event_kind', type: 'text' }) eventKind: string;
  @Column({ name: 'previous_value', type: 'jsonb', nullable: true })
  previousValue: Record<string, unknown> | null;
  @Column({ name: 'next_value', type: 'jsonb', nullable: true })
  nextValue: Record<string, unknown> | null;
  @Column({ name: 'correlation_id', type: 'text', nullable: true })
  correlationId: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
