import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { OutboxStore } from './outbox.store';
import { Delivery, enqueue } from './queue';

export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;

  constructor(
    private readonly outbox: OutboxStore,
    private readonly queue: Queue<Delivery>,
  ) {}

  start(): void {
    if (this.timer) return;
    const tick = () => {
      this.active ??= this.dispatch()
        .catch(() =>
          this.logger.error('Outbox relay could not update PostgreSQL.'),
        )
        .finally(() => {
          this.active = undefined;
        });
    };
    this.timer = setInterval(tick, 1000);
    tick();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.active;
  }

  async dispatch(): Promise<void> {
    const claims = await this.outbox.claimDue();
    const results = await Promise.allSettled(
      claims.map(async (claim) => {
        try {
          await enqueue(this.queue, claim);
        } catch {
          await this.outbox.dispatchFailed(claim);
          this.logger.warn(
            'Outbox dispatch deferred because Redis enqueue failed.',
          );
          return;
        }
        await this.outbox.dispatched(claim);
      }),
    );
    if (results.some(({ status }) => status === 'rejected')) {
      throw new Error('One or more outbox claims could not be updated.');
    }
  }
}
