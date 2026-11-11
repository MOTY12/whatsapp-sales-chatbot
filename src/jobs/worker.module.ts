import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { workerConfig } from '../config/env';
import { DatabaseModule } from '../database/database.module';
import { OutboxProcessor } from './outbox.processor';
import { OutboxRelay } from './outbox.relay';
import { JobHandler, OutboxStore } from './outbox.store';
import { createQueue, createWorker } from './queue';

export const OUTBOX_HANDLERS = Symbol('OUTBOX_HANDLERS');

@Injectable()
export class WorkerRuntime
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(WorkerRuntime.name);
  private readonly config = workerConfig();
  private readonly queue = createQueue(this.config);
  private readonly relay: OutboxRelay;
  private readonly worker: ReturnType<typeof createWorker>;

  constructor(
    outbox: OutboxStore,
    @Inject(OUTBOX_HANDLERS) handlers: ReadonlyMap<string, JobHandler>,
  ) {
    this.queue.on('error', () =>
      this.logger.warn('Outbox producer Redis connection error.'),
    );
    this.relay = new OutboxRelay(outbox, this.queue);
    const processor = new OutboxProcessor(outbox, handlers);
    this.worker = createWorker(this.config, (data, id) =>
      processor.process(data, id),
    );
    this.worker.on('error', () =>
      this.logger.warn('Outbox worker connection or processing error.'),
    );
    this.worker.on('failed', () => this.logger.warn('BullMQ delivery failed.'));
  }

  onApplicationBootstrap(): void {
    void this.worker
      .run()
      .catch(() => this.logger.error('Outbox consumer stopped unexpectedly.'));
    this.relay.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    const results = await Promise.allSettled([
      this.relay.stop(),
      this.worker.close(),
    ]);
    await this.queue.close();
    if (results.some(({ status }) => status === 'rejected')) {
      throw new Error('Outbox runtime shutdown failed.');
    }
  }
}

@Module({
  imports: [DatabaseModule],
  providers: [OutboxStore],
  exports: [OutboxStore],
})
export class OutboxModule {}

@Module({
  imports: [OutboxModule],
  providers: [
    WorkerRuntime,
    {
      provide: OUTBOX_HANDLERS,
      useFactory: () => new Map<string, JobHandler>(),
    },
  ],
})
export class WorkerModule {}
