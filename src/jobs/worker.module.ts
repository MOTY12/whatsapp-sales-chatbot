import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { writeFile, unlink } from 'node:fs/promises';
import {
  handoffWhatsAppReceipt,
  whatsappReceiptOperation,
} from '../whatsapp/webhook-receipt.handler';
import { workerConfig } from '../config/env';
import { OutboxProcessor } from './outbox.processor';
import { OutboxRelay } from './outbox.relay';
import { OutboxHandler, OutboxStore } from './outbox.store';
import { createQueue, createWorker } from './queue';
import { UsageModule } from '../metering/usage.module';
import { AssistantModule } from '../assistant/assistant.module';
import {
  AiResponseService,
  whatsappAiResponseOperation,
} from '../assistant/ai-response.service';
import { OutboxModule } from './outbox.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { EmailModule } from '../Email/email.module';
import { EmailService } from '../Email/email.service';
import {
  OutboundMessageService,
  whatsappOutboundOperation,
} from '../whatsapp/outbound-message.service';
import {
  WhatsAppResponseIntentDispatcher,
  whatsappResponseOperation,
} from '../whatsapp/response-intent.dispatcher';
import { WebsiteChatModule } from '../website-chat/website-chat.module';
import {
  WebsiteChatService,
  websiteAiResponseOperation,
  websiteDeliveryOperation,
} from '../website-chat/website-chat.service';

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
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private redisReady = false;
  private healthProbeFailed = false;
  private heartbeatTask?: Promise<void>;
  private readonly heartbeatPath = '/tmp/kleva-worker-heartbeat';

  constructor(
    outbox: OutboxStore,
    @Inject(OUTBOX_HANDLERS) handlers: ReadonlyMap<string, OutboxHandler>,
    @InjectDataSource() private readonly database: DataSource,
  ) {
    this.queue.on('error', () =>
      this.logger.warn('Outbox producer Redis connection error.'),
    );
    this.relay = new OutboxRelay(outbox, this.queue);
    const processor = new OutboxProcessor(outbox, handlers);
    this.worker = createWorker(this.config, (data, id) =>
      processor.process(data, id),
    );
    this.worker.on('ready', () => {
      this.redisReady = true;
    });
    this.worker.on('error', () => {
      this.redisReady = false;
      this.logger.warn('Outbox worker connection or processing error.');
    });
    this.worker.on('failed', () => this.logger.warn('BullMQ delivery failed.'));
  }

  async onApplicationBootstrap(): Promise<void> {
    await Promise.all([
      this.worker.waitUntilReady(),
      this.queue.waitUntilReady(),
    ]);
    this.redisReady = true;
    this.heartbeatTimer = setInterval(() => {
      this.heartbeatTask ??= this.writeHeartbeat().finally(() => {
        this.heartbeatTask = undefined;
      });
    }, 10000);
    this.heartbeatTimer.unref();
    await this.writeHeartbeat();
    void this.worker.run().catch(() => {
      this.logger.error('Outbox consumer stopped unexpectedly.');
      process.kill(process.pid, 'SIGTERM');
    });
    this.relay.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    const results = await Promise.allSettled([
      this.relay.stop(),
      this.worker.close(),
      this.heartbeatTask,
    ]);
    const queueResult = await Promise.allSettled([this.queue.close()]);
    await unlink(this.heartbeatPath).catch(() => undefined);
    if (
      [...results, ...queueResult].some(({ status }) => status === 'rejected')
    ) {
      throw new Error('Outbox runtime shutdown failed.');
    }
  }

  private async writeHeartbeat(): Promise<void> {
    try {
      if (!this.redisReady || !this.worker.isRunning()) {
        await unlink(this.heartbeatPath).catch(() => undefined);
        return;
      }
      await this.database.query('SELECT 1');
      await this.queue.getJobCounts();
      await writeFile(this.heartbeatPath, `${Date.now()}\n`, { mode: 0o600 });
      this.healthProbeFailed = false;
    } catch {
      await unlink(this.heartbeatPath).catch(() => undefined);
      if (!this.healthProbeFailed) {
        this.logger.warn('Worker health probe failed.');
        this.healthProbeFailed = true;
      }
    }
  }
}

@Module({
  imports: [
    OutboxModule,
    UsageModule,
    WhatsAppModule,
    AssistantModule,
    EmailModule,
    WebsiteChatModule,
  ],
  providers: [
    WorkerRuntime,
    WhatsAppResponseIntentDispatcher,
    {
      provide: OUTBOX_HANDLERS,
      useFactory: (
        responses: WhatsAppResponseIntentDispatcher,
        outbound: OutboundMessageService,
        ai: AiResponseService,
        email: EmailService,
        website: WebsiteChatService,
      ) =>
        new Map<string, OutboxHandler>([
          [whatsappReceiptOperation, handoffWhatsAppReceipt],
          [
            'merchant.email',
            { execute: (operation) => email.execute(operation) },
          ],
          [
            whatsappResponseOperation,
            { execute: (operation) => responses.execute(operation) },
          ],
          [
            whatsappOutboundOperation,
            { execute: (operation) => outbound.execute(operation) },
          ],
          [
            whatsappAiResponseOperation,
            { execute: (operation) => ai.execute(operation) },
          ],
          [
            websiteAiResponseOperation,
            { execute: (operation) => ai.execute(operation) },
          ],
          [
            websiteDeliveryOperation,
            {
              execute: (operation) =>
                website.executeDelivery(
                  String(operation.metadata.messageId),
                  operation.businessId!,
                ),
            },
          ],
        ]),
      inject: [
        WhatsAppResponseIntentDispatcher,
        OutboundMessageService,
        AiResponseService,
        EmailService,
        WebsiteChatService,
      ],
    },
  ],
})
export class WorkerModule {}
