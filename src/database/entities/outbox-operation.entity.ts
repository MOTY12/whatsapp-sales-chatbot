import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type OutboxStatus =
  | 'PENDING'
  | 'CLAIMED'
  | 'DISPATCHED'
  | 'PROCESSING'
  | 'RETRY_PENDING'
  | 'COMPLETED'
  | 'FAILED';

export type OutboxError =
  | 'REDIS_UNAVAILABLE'
  | 'EXECUTION_LEASE_EXPIRED'
  | 'HANDLER_FAILED'
  | 'UNREGISTERED_OPERATION';

@Entity('outbox_operations')
export class OutboxOperation {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  businessId: string | null;

  @Column({ type: 'varchar', length: 64 })
  operation: string;

  @Column({ type: 'jsonb' })
  metadata: Record<string, string>;

  @Column({ type: 'varchar' })
  status: OutboxStatus;

  @Column({ type: 'integer' })
  attempts: number;

  @Column({ type: 'integer' })
  dispatchFailures: number;

  // This is the lease deadline for CLAIMED/PROCESSING, the redelivery
  // deadline for DISPATCHED, and the next dispatch time for pending rows.
  @Column({ type: 'timestamptz' })
  dueAt: Date;

  @Column({ type: 'uuid', nullable: true })
  leaseToken: string | null;

  @Column({ type: 'varchar', nullable: true })
  lastError: OutboxError | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
