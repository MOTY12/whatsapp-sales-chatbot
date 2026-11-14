import { Logger } from '@nestjs/common';
import { OutboxHandler, OutboxStore, uuidPattern } from './outbox.store';
import type { Delivery } from './queue';

export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(
    private readonly outbox: OutboxStore,
    private readonly handlers: ReadonlyMap<string, OutboxHandler>,
  ) {}

  async process(data: Delivery, jobId: string | undefined): Promise<void> {
    const id = data?.id;
    if (
      typeof id !== 'string' ||
      !uuidPattern.test(id) ||
      !jobId?.startsWith(`${id}-`)
    )
      return;
    const generation = jobId.slice(id.length + 1);
    if (!/^\d$/.test(generation)) return;

    const job = await this.outbox.begin(id, Number(generation));
    if (!job) return;
    const handler = this.handlers.get(job.operation);
    if (!handler) {
      await this.outbox.fail(job, 'UNREGISTERED_OPERATION');
      this.logger.error('Outbox operation has no registered handler.');
      return;
    }

    try {
      if (typeof handler === 'function') {
        await this.outbox.complete(job, handler);
      } else {
        await handler.execute(job);
        await this.outbox.completeExternal(job);
      }
    } catch {
      await this.outbox.fail(job, 'HANDLER_FAILED');
      this.logger.warn({
        event: 'outbox.handler_failed',
        attempt: job.attempts,
      });
    }
  }
}
