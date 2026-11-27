import { randomUUID } from 'node:crypto';
import { WebsiteRateLimitException } from '../../src/website-chat/website-abuse.exception';
import { WebsiteRealtimeService } from '../../src/website-chat/website-realtime.service';

describe('distributed website abuse protection', () => {
  let first: WebsiteRealtimeService;
  let second: WebsiteRealtimeService;
  let previousRedisUrl: string | undefined;

  beforeAll(() => {
    if (!process.env.KLEVA_TEST_REDIS_URL)
      throw new Error('Set KLEVA_TEST_REDIS_URL to disposable loopback Redis.');
    previousRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = process.env.KLEVA_TEST_REDIS_URL;
    first = new WebsiteRealtimeService();
    second = new WebsiteRealtimeService();
  });

  afterAll(() => {
    first?.beforeApplicationShutdown();
    second?.beforeApplicationShutdown();
    if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousRedisUrl;
  });

  it('shares an atomic request limit across independent API service instances', async () => {
    const operation = randomUUID();
    await first.consumeRateLimit('test', [operation], 2);
    await second.consumeRateLimit('test', [operation], 2);
    await expect(
      first.consumeRateLimit('test', [operation], 2),
    ).rejects.toBeInstanceOf(WebsiteRateLimitException);
  });

  it('enforces each identity dimension independently without incrementing partial buckets', async () => {
    const sharedIp = randomUUID();
    await first.consumeRateLimit('dimension-test', ['widget-a', sharedIp], 1);
    await expect(
      second.consumeRateLimit('dimension-test', ['widget-b', sharedIp], 1),
    ).rejects.toBeInstanceOf(WebsiteRateLimitException);
    await second.consumeRateLimit(
      'dimension-test',
      ['widget-b', 'other-ip'],
      1,
    );
  });

  it('enforces a session connection cap across instances and releases leases idempotently', async () => {
    const sessionId = randomUUID();
    const leases = await Promise.all([
      first.acquireConnectionLease(sessionId, 2, 30),
      second.acquireConnectionLease(sessionId, 2, 30),
    ]);
    await expect(
      first.acquireConnectionLease(sessionId, 2, 30),
    ).rejects.toBeInstanceOf(WebsiteRateLimitException);
    expect(await leases[0].renew()).toBe(true);
    await leases[0].release();
    await leases[0].release();
    const replacement = await first.acquireConnectionLease(sessionId, 2, 30);
    await Promise.all([leases[1].release(), replacement.release()]);
  });

  it('recovers a lease after its owning API process disappears and the lease expires', async () => {
    const sessionId = randomUUID();
    await first.acquireConnectionLease(sessionId, 1, 1);
    first.beforeApplicationShutdown();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const recovered = await second.acquireConnectionLease(sessionId, 1, 30);
    await recovered.release();
    first = new WebsiteRealtimeService();
  });
});
