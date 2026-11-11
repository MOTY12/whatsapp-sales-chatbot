import { Queue, Worker } from 'bullmq';
import { Redis, type RedisOptions } from 'ioredis';
import type { workerConfig } from '../config/env';
import type { DispatchClaim } from './outbox.store';

type WorkerConfig = ReturnType<typeof workerConfig>;

export type Delivery = { id: string };
const queueName = 'outbox';

export function redisOptions(config: WorkerConfig['redis']): RedisOptions {
  if (!config.url)
    return { host: config.host, port: config.port, password: config.password };

  const url = new URL(config.url);
  const database = url.pathname.slice(1);
  if (
    url.search ||
    url.hash ||
    (database &&
      (!/^\d+$/.test(database) || !Number.isSafeInteger(Number(database))))
  ) {
    throw new Error(
      'REDIS_URL must have an optional numeric database path and no query or fragment.',
    );
  }
  try {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    return {
      host,
      port: Number(url.port || 6379),
      username: decodeURIComponent(url.username) || undefined,
      password: decodeURIComponent(url.password) || undefined,
      db: Number(database),
      tls:
        url.protocol === 'rediss:'
          ? { servername: host, rejectUnauthorized: true }
          : undefined,
    };
  } catch {
    throw new Error('REDIS_URL contains invalid credentials encoding.');
  }
}

class OutboxQueue extends Queue<Delivery> {
  private readonly redis: Redis;

  constructor(config: WorkerConfig) {
    const redis = new Redis({
      ...redisOptions(config.redis),
      enableReadyCheck: false,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      connectTimeout: 2000,
      commandTimeout: 2000,
    });
    // BullMQ forwards connection errors to the queue while it owns listeners.
    redis.on('error', () => undefined);
    super(queueName, {
      prefix: config.prefix,
      // The worker checks the Redis version. Producers can start offline.
      skipWaitingForReady: true,
      skipVersionCheck: true,
      skipMetasUpdate: true,
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000, jitter: 0.5 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
    this.redis = redis;
  }

  override async close(): Promise<void> {
    try {
      await super.close();
    } finally {
      this.redis.disconnect();
    }
  }
}

export function createQueue(config: WorkerConfig): Queue<Delivery> {
  return new OutboxQueue(config);
}

export function createWorker(
  config: WorkerConfig,
  processDelivery: (data: Delivery, jobId: string | undefined) => Promise<void>,
) {
  return new Worker<Delivery>(
    queueName,
    async (job) => {
      try {
        await processDelivery(job.data, job.id);
      } catch {
        // BullMQ persists thrown errors in Redis.
        throw new Error('Outbox delivery could not update PostgreSQL.');
      }
    },
    {
      prefix: config.prefix,
      connection: { ...redisOptions(config.redis), maxRetriesPerRequest: null },
      concurrency: config.concurrency,
      autorun: false,
    },
  );
}

export function enqueue(queue: Queue<Delivery>, claim: DispatchClaim) {
  return queue.add(
    'execute',
    { id: claim.id },
    { jobId: `${claim.id}-${claim.attempts}` },
  );
}
