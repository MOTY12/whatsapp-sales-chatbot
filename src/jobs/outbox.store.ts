import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import {
  OutboxError,
  OutboxOperation,
} from '../database/entities/outbox-operation.entity';

export const maxExecutionAttempts = 5;
export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OperationIntent {
  id: string;
  operation: string;
  businessId?: string;
  metadata?: Record<string, string>;
}

export type DispatchClaim = Pick<
  OutboxOperation,
  'id' | 'attempts' | 'dispatchFailures'
> & { leaseToken: string };
export type JobHandler = (
  manager: EntityManager,
  operation: Readonly<OutboxOperation>,
) => Promise<void>;
export type ExternalJobHandler = (
  operation: Readonly<OutboxOperation>,
) => Promise<void>;
export type OutboxHandler = JobHandler | { execute: ExternalJobHandler };

function retryDelay(failures: number) {
  const delay = Math.min(60_000, 1000 * 2 ** Math.min(6, failures - 1));
  return Math.round(delay * (0.5 + Math.random() * 0.5));
}

@Injectable()
export class OutboxStore {
  constructor(private readonly database: DataSource) {}

  async write(manager: EntityManager, intent: OperationIntent): Promise<void> {
    if (
      manager.connection !== this.database ||
      !manager.queryRunner?.isTransactionActive
    ) {
      throw new Error(
        'Outbox writes require the application transaction manager.',
      );
    }
    const metadata = Object.entries(intent.metadata ?? {});
    if (
      !uuidPattern.test(intent.id) ||
      (intent.businessId !== undefined &&
        !uuidPattern.test(intent.businessId)) ||
      !/^[a-z][a-z0-9_.-]{0,63}$/.test(intent.operation) ||
      metadata.length > 8 ||
      metadata.some(
        ([key, value]) =>
          !/^[a-z][a-zA-Z0-9]{0,29}Id$/.test(key) ||
          typeof value !== 'string' ||
          !uuidPattern.test(value),
      )
    ) {
      throw new Error(
        'Invalid outbox intent. Metadata may contain up to eight UUID references.',
      );
    }
    const parameters = [
      intent.id,
      intent.businessId ?? null,
      intent.operation,
      JSON.stringify(Object.fromEntries(metadata)),
    ];
    await manager.query(
      `
      INSERT INTO outbox_operations (id, "businessId", operation, metadata)
      VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING
    `,
      parameters,
    );
    const [sameIntent] = await manager.query<{ id: string }[]>(
      `
      SELECT id FROM outbox_operations WHERE id = $1 AND "businessId" IS NOT DISTINCT FROM $2
        AND operation = $3 AND metadata = $4
    `,
      parameters,
    );
    if (!sameIntent)
      throw new Error(
        'Outbox operation ID is already bound to another intent.',
      );
  }

  async status(
    businessId: string | null,
    id: string,
  ): Promise<Pick<
    OutboxOperation,
    'id' | 'status' | 'attempts' | 'lastError' | 'updatedAt'
  > | null> {
    if (
      !uuidPattern.test(id) ||
      (businessId !== null && !uuidPattern.test(businessId))
    )
      return null;
    return this.database.getRepository(OutboxOperation).findOne({
      where:
        businessId === null ? { id, businessId: IsNull() } : { id, businessId },
      select: {
        id: true,
        status: true,
        attempts: true,
        lastError: true,
        updatedAt: true,
      },
    });
  }

  async claimDue(): Promise<DispatchClaim[]> {
    return this.database.query<DispatchClaim[]>(
      `
      WITH due AS (
        SELECT id FROM outbox_operations
        WHERE status NOT IN ('COMPLETED', 'FAILED') AND "dueAt" <= now()
        ORDER BY "dueAt", id LIMIT 20 FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE outbox_operations AS job SET
          status = CASE WHEN attempts >= $2 THEN 'FAILED' ELSE 'CLAIMED' END,
          "leaseToken" = CASE WHEN attempts >= $2 THEN NULL ELSE $1::uuid END,
          "dueAt" = now() + interval '15 seconds',
          "lastError" = CASE WHEN job.status = 'PROCESSING'
            THEN 'EXECUTION_LEASE_EXPIRED' ELSE job."lastError" END,
          "updatedAt" = now()
        FROM due WHERE job.id = due.id
        RETURNING job.id, job.attempts, job."dispatchFailures", job."leaseToken", job.status
      ) SELECT id, attempts, "dispatchFailures", "leaseToken" FROM claimed WHERE status = 'CLAIMED'
    `,
      [randomUUID(), maxExecutionAttempts],
    );
  }

  async dispatched(claim: DispatchClaim): Promise<void> {
    await this.database.query(
      `
      UPDATE outbox_operations SET status = 'DISPATCHED', "leaseToken" = NULL,
        "dueAt" = now() + interval '30 seconds', "dispatchFailures" = 0, "updatedAt" = now()
      WHERE id = $1 AND status = 'CLAIMED' AND "leaseToken" = $2
    `,
      [claim.id, claim.leaseToken],
    );
  }

  async dispatchFailed(claim: DispatchClaim): Promise<void> {
    await this.database.query(
      `
      UPDATE outbox_operations SET status = 'RETRY_PENDING', "leaseToken" = NULL,
        "dueAt" = now() + $3::integer * interval '1 millisecond',
        "dispatchFailures" = LEAST("dispatchFailures" + 1, 7),
        "lastError" = 'REDIS_UNAVAILABLE', "updatedAt" = now()
      WHERE id = $1 AND status = 'CLAIMED' AND "leaseToken" = $2
    `,
      [claim.id, claim.leaseToken, retryDelay(claim.dispatchFailures + 1)],
    );
  }

  async begin(
    id: string,
    deliveryAttempt: number,
  ): Promise<OutboxOperation | undefined> {
    const [job] = await this.database.query<OutboxOperation[]>(
      `
      WITH started AS (
        UPDATE outbox_operations SET status = 'PROCESSING', "leaseToken" = $3,
          "dueAt" = now() + interval '60 seconds', attempts = attempts + 1, "updatedAt" = now()
        WHERE id = $1 AND attempts = $2 AND status IN ('CLAIMED', 'DISPATCHED')
          AND attempts < $4
        RETURNING *
      ) SELECT * FROM started
    `,
      [id, deliveryAttempt, randomUUID(), maxExecutionAttempts],
    );
    return job;
  }

  async complete(job: OutboxOperation, handler: JobHandler): Promise<void> {
    await this.database.transaction(async (manager) => {
      const [owned] = await manager.query<{ id: string }[]>(
        `
        SELECT id FROM outbox_operations
        WHERE id = $1 AND status = 'PROCESSING' AND "leaseToken" = $2 AND "dueAt" > now()
        FOR UPDATE
      `,
        [job.id, job.leaseToken],
      );
      if (!owned) return;

      await handler(manager, job);
      await manager.query(
        `
        UPDATE outbox_operations SET status = 'COMPLETED', "leaseToken" = NULL,
          "lastError" = NULL, "updatedAt" = now()
        WHERE id = $1
      `,
        [job.id],
      );
    });
  }

  async fail(job: OutboxOperation, error: OutboxError): Promise<void> {
    const terminal =
      job.attempts >= maxExecutionAttempts ||
      error === 'UNREGISTERED_OPERATION';
    await this.database.query(
      `
      UPDATE outbox_operations SET status = $3, "leaseToken" = NULL,
        "dueAt" = now() + $4::integer * interval '1 millisecond', "lastError" = $5, "updatedAt" = now()
      WHERE id = $1 AND status = 'PROCESSING' AND "leaseToken" = $2
    `,
      [
        job.id,
        job.leaseToken,
        terminal ? 'FAILED' : 'RETRY_PENDING',
        retryDelay(job.attempts),
        error,
      ],
    );
  }

  async completeExternal(job: OutboxOperation): Promise<void> {
    await this.database.query(
      `UPDATE outbox_operations SET status = 'COMPLETED', "leaseToken" = NULL,
          "lastError" = NULL, "updatedAt" = now()
        WHERE id = $1 AND status = 'PROCESSING' AND "leaseToken" = $2 AND "dueAt" > now()`,
      [job.id, job.leaseToken],
    );
  }
}
