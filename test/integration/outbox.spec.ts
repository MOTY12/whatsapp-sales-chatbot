import { randomUUID } from 'node:crypto';
import { createConnection, createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { DataSource } from 'typeorm';
import { workerConfig } from '../../src/config/env';
import { Business, Notification } from '../../src/database/entities';
import { OutboxOperation } from '../../src/database/entities/outbox-operation.entity';
import { OutboxProcessor } from '../../src/jobs/outbox.processor';
import { OutboxRelay } from '../../src/jobs/outbox.relay';
import {
  JobHandler,
  maxExecutionAttempts,
  OutboxStore,
} from '../../src/jobs/outbox.store';
import { createQueue, createWorker, enqueue } from '../../src/jobs/queue';
import { WorkerRuntime } from '../../src/jobs/worker.module';
import { applyMigrations, createIntegrationDatabase } from './postgres';

async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  throw new Error('Timed out waiting for outbox integration state.');
}

describe('durable outbox with PostgreSQL and Redis', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let source: DataSource;
  let store: OutboxStore;
  let queue: ReturnType<typeof createQueue>;
  let config: ReturnType<typeof workerConfig>;
  let worker: ReturnType<typeof createWorker> | undefined;
  let runtime: WorkerRuntime | undefined;
  let business: Business;

  const operation = 'test.effect';
  const recordEffect: JobHandler = async (manager, job) => {
    await manager.getRepository(Notification).insert({
      businessId: business.id,
      recipientPhone: '2348000000000',
      type: 'update',
      title: job.id,
      body: 'Synthetic transactional effect',
    });
  };

  async function submit(id = randomUUID(), type = operation) {
    await source.transaction((manager) =>
      store.write(manager, {
        id,
        operation: type,
        businessId: business.id,
      }),
    );
    return id;
  }

  function waitFor(id: string, status: OutboxOperation['status']) {
    return until(
      async () => (await store.status(business.id, id))?.status === status,
    );
  }

  async function expire(id: string) {
    await source.query(
      `UPDATE outbox_operations SET "dueAt" = now() - interval '1 second' WHERE id = $1`,
      [id],
    );
  }

  function effectCount(id: string) {
    return source.getRepository(Notification).countBy({ title: id });
  }

  async function startConsumer(handler = recordEffect) {
    const processor = new OutboxProcessor(
      store,
      new Map([[operation, handler]]),
    );
    worker = createWorker(config, (data, id) => processor.process(data, id));
    worker.on('error', () => undefined);
    void worker.run().catch(() => undefined);
    await worker.waitUntilReady();
  }

  beforeAll(async () => {
    const testUrl = process.env.KLEVA_TEST_REDIS_URL;
    if (!testUrl)
      throw new Error(
        'Set KLEVA_TEST_REDIS_URL to the disposable loopback Redis service.',
      );
    const url = new URL(testUrl);
    if (
      url.protocol !== 'redis:' ||
      url.hostname !== '127.0.0.1' ||
      !url.port
    ) {
      throw new Error(
        'KLEVA_TEST_REDIS_URL must be a redis://127.0.0.1 URL with an explicit port.',
      );
    }
    config = workerConfig({
      NODE_ENV: 'test',
      REDIS_URL: testUrl,
      JOBS_QUEUE_PREFIX: `kleva-test-${randomUUID()}`,
      JOBS_CONCURRENCY: '1',
    });
    database = await createIntegrationDatabase();
    const migrator = await database.migrator();
    await applyMigrations(migrator);
    await database.grantRuntimeAccess(migrator);
    await migrator.destroy();
    source = await database.runtime();
    store = new OutboxStore(source);
    business = await source.getRepository(Business).save({
      name: 'Outbox fixture',
      phone: '2348111111111',
      whatsappNumber: '2348111111111',
    });
    queue = createQueue(config);
    queue.on('error', () => undefined);
    await until(async () => {
      try {
        await queue.getJobCounts();
        return true;
      } catch {
        return false;
      }
    });
  });

  afterEach(async () => {
    try {
      await runtime?.beforeApplicationShutdown();
      runtime = undefined;
      await worker?.close();
      worker = undefined;
      if (queue) await queue.obliterate({ force: true });
      if (source?.isInitialized)
        await source.query('DELETE FROM outbox_operations');
    } finally {
      jest.restoreAllMocks();
    }
  });

  afterAll(async () => {
    try {
      await queue?.close();
    } finally {
      await database?.close();
    }
  });

  it('rolls back intent with the business transaction and deduplicates by logical ID', async () => {
    const id = randomUUID();
    const intent = { id, operation, businessId: business.id };
    await expect(store.write(source.manager, intent)).rejects.toThrow(
      'transaction manager',
    );
    await expect(
      source.transaction(async (manager) => {
        await store.write(manager, intent);
        await manager
          .getRepository(Business)
          .update(business.id, { name: 'Rolled back' });
        throw new Error('Rollback fixture');
      }),
    ).rejects.toThrow('Rollback fixture');
    await expect(store.status(business.id, id)).resolves.toBeNull();
    await expect(
      source.getRepository(Business).findOneBy({ id: business.id }),
    ).resolves.toMatchObject({ name: 'Outbox fixture' });

    await Promise.all([submit(id), submit(id)]);
    await expect(store.status(business.id, id)).resolves.toMatchObject({
      status: 'PENDING',
      attempts: 0,
    });
    await expect(store.status(randomUUID(), id)).resolves.toBeNull();
    await expect(store.status(null, id)).resolves.toBeNull();
    await expect(submit(id, 'other.effect')).rejects.toThrow('already bound');
    await expect(
      source.transaction((manager) =>
        store.write(manager, {
          ...intent,
          id: randomUUID(),
          metadata: { messageId: 'synthetic customer content' },
        }),
      ),
    ).rejects.toThrow('UUID references');
  });

  it('keeps committed work when Redis is unreachable and dispatches after the same endpoint recovers', async () => {
    const upstream = new URL(config.redis.url!);
    const sockets = new Set<ReturnType<typeof createConnection>>();
    const proxy = createServer((socket) => {
      const backend = createConnection({
        host: upstream.hostname,
        port: Number(upstream.port),
      });
      for (const connection of [socket, backend]) {
        sockets.add(connection);
        connection.on('error', () => connection.destroy());
        connection.once('close', () => sockets.delete(connection));
      }
      socket.once('close', () => backend.destroy());
      backend.once('close', () => socket.destroy());
      socket.pipe(backend).pipe(socket);
    });
    const listen = (port: number) =>
      new Promise<void>((resolve, reject) => {
        proxy.once('error', reject);
        proxy.listen(port, '127.0.0.1', () => {
          proxy.removeListener('error', reject);
          resolve();
        });
      });
    const stop = () =>
      new Promise<void>((resolve) => proxy.close(() => resolve()));
    await listen(0);
    const address = proxy.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected a TCP port.');
    await stop();

    const relayUrl = new URL(upstream);
    relayUrl.port = String(address.port);
    const producer = createQueue({
      ...config,
      redis: { ...config.redis, url: relayUrl.toString() },
    });
    producer.on('error', () => undefined);
    const relay = new OutboxRelay(store, producer);
    try {
      const id = await submit();
      await relay.dispatch();
      await expect(store.status(business.id, id)).resolves.toMatchObject({
        status: 'RETRY_PENDING',
        attempts: 0,
        lastError: 'REDIS_UNAVAILABLE',
      });

      await listen(address.port);
      await until(async () => {
        try {
          await producer.getJobCounts();
          return true;
        } catch {
          return false;
        }
      });
      await expire(id);
      await relay.dispatch();
      await startConsumer();
      await waitFor(id, 'COMPLETED');
      await expect(effectCount(id)).resolves.toBe(1);
    } finally {
      await producer.close();
      for (const socket of sockets) socket.destroy();
      if (proxy.listening) await stop();
    }
  });

  it('recovers a relay crash after enqueue and fences duplicate deliveries', async () => {
    const id = await submit();
    const claims = (
      await Promise.all([store.claimDue(), store.claimDue()])
    ).flat();
    expect(claims).toHaveLength(1);
    await enqueue(queue, claims[0]);

    // No acknowledgement reached PostgreSQL before the relay stopped.
    await expire(id);
    const firstRelay = new OutboxRelay(store, queue);
    await Promise.all([
      firstRelay.dispatch(),
      new OutboxRelay(store, queue).dispatch(),
    ]);
    await expect(queue.getWaitingCount()).resolves.toBe(1);
    await expect(store.status(business.id, id)).resolves.toMatchObject({
      status: 'DISPATCHED',
    });
    await expect(queue.getJob(`${id}-0`)).resolves.toMatchObject({
      data: { id },
    });

    await startConsumer();
    await waitFor(id, 'COMPLETED');
    await until(async () => (await queue.getJob(`${id}-0`)) === undefined);
    await enqueue(queue, claims[0]);
    await until(async () => (await queue.getJob(`${id}-0`)) === undefined);
    await expect(effectCount(id)).resolves.toBe(1);
  });

  it('redelivers a dispatched job missing from Redis and reclaims an expired execution lease', async () => {
    const id = await submit();
    const relay = new OutboxRelay(store, queue);
    await relay.dispatch();
    await queue.remove(`${id}-0`);
    await expire(id);
    await relay.dispatch();
    expect(await queue.getJob(`${id}-0`)).toBeDefined();
    const abandoned = await store.begin(id, 0);
    if (!abandoned) throw new Error('Expected execution lease.');

    await expire(id);
    await relay.dispatch();
    await store.complete(abandoned, recordEffect);
    await expect(effectCount(id)).resolves.toBe(0);
    await startConsumer();
    await waitFor(id, 'COMPLETED');
    await expect(store.status(business.id, id)).resolves.toMatchObject({
      attempts: 2,
    });
    await expect(effectCount(id)).resolves.toBe(1);
  });

  it('rolls back failed handler writes and parks the operation after bounded retries', async () => {
    const id = await submit();
    await startConsumer(async (manager, job) => {
      await recordEffect(manager, job);
      throw new Error('Sensitive handler details');
    });
    const relay = new OutboxRelay(store, queue);
    for (let attempt = 1; attempt <= maxExecutionAttempts; attempt++) {
      await relay.dispatch();
      await waitFor(
        id,
        attempt === maxExecutionAttempts ? 'FAILED' : 'RETRY_PENDING',
      );
      const row = await source
        .getRepository(OutboxOperation)
        .findOneByOrFail({ id });
      expect(row).toMatchObject({
        attempts: attempt,
        lastError: 'HANDLER_FAILED',
        leaseToken: null,
      });
      if (attempt < maxExecutionAttempts) {
        expect(row.dueAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
        await expire(id);
      }
    }
    await expect(effectCount(id)).resolves.toBe(0);
    await expect(store.claimDue()).resolves.toEqual([]);
  });

  it('drains an active handler and stops claiming work during graceful shutdown', async () => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      NODE_ENV: 'test',
      REDIS_URL: config.redis.url,
      JOBS_QUEUE_PREFIX: config.prefix,
      JOBS_CONCURRENCY: '1',
    });
    let release!: () => void;
    let entered = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const id = await submit();
    runtime = new WorkerRuntime(
      store,
      new Map([
        [
          operation,
          async (manager, job) => {
            entered = true;
            await gate;
            await recordEffect(manager, job);
          },
        ],
      ]),
    );
    runtime.onApplicationBootstrap();
    try {
      await until(() => Promise.resolve(entered));
      const stopping = runtime.beforeApplicationShutdown();
      let stopped = false;
      void stopping.then(
        () => {
          stopped = true;
        },
        () => undefined,
      );
      const next = await submit();
      expect(stopped).toBe(false);
      release();
      await stopping;
      runtime = undefined;
      await expect(effectCount(id)).resolves.toBe(1);
      await expect(store.status(business.id, next)).resolves.toMatchObject({
        status: 'PENDING',
      });
    } finally {
      release();
    }
  });
});
