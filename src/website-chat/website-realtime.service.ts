import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import {
  applicationEnvironment,
  redisConfig,
  websiteAbuseConfig,
} from '../config/env';
import { redisOptions } from '../jobs/queue';
import { WebsiteRateLimitException } from './website-abuse.exception';

export const websiteEventTypes = [
  'message.created',
  'message.updated',
  'conversation.updated',
  'conversation.resolved',
  'conversation.reopened',
  'conversation.control.changed',
  'typing.started',
  'typing.stopped',
  'session.revoked',
] as const;

export type WebsiteEventType = (typeof websiteEventTypes)[number];
export type WebsiteTypingActor = 'visitor' | 'human' | 'assistant';
export type WebsiteRealtimeEvent = {
  version: 1;
  id: string;
  type: WebsiteEventType;
  businessId: string;
  conversationId: string;
  messageId?: string;
  targetSessionId?: string;
  actor?: WebsiteTypingActor;
  occurredAt: string;
};
export type WebsiteEventScope = {
  businessId: string;
  conversationId?: string;
  visitorSessionId?: string;
};

const topic = 'kleva:website:events:v1';
const abuseNamespace = () =>
  `kleva:${applicationEnvironment()}:website:abuse:v1`;
const rateLimitScript = `
  local limit = tonumber(ARGV[2])
  local retryAfter = 0
  for i = 1, #KEYS do
    local count = tonumber(redis.call('GET', KEYS[i]) or '0')
    if count >= limit then
      local ttl = redis.call('PTTL', KEYS[i])
      if ttl > retryAfter then retryAfter = ttl end
    end
  end
  if retryAfter > 0 then return {0, retryAfter} end
  for i = 1, #KEYS do
    local count = redis.call('INCR', KEYS[i])
    if count == 1 then redis.call('PEXPIRE', KEYS[i], ARGV[1]) end
  end
  return {1, 0}
`;
const acquireLeaseScript = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
  redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
  if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[4])
  redis.call('ZADD', KEYS[2], ARGV[2], ARGV[4])
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[5]))
  redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[5]))
  return 1
`;
const renewLeaseScript = `
  if not redis.call('ZSCORE', KEYS[1], ARGV[1]) then return 0 end
  redis.call('ZADD', KEYS[1], 'XX', ARGV[3], ARGV[1])
  redis.call('ZADD', KEYS[2], 'XX', ARGV[3], ARGV[1])
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[4]))
  redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[4]))
  return 1
`;
const releaseLeaseScript = `
  redis.call('ZREM', KEYS[1], ARGV[1])
  return redis.call('ZREM', KEYS[2], ARGV[1])
`;
const eventIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidPattern = eventIdPattern;

function validEvent(value: unknown): value is WebsiteRealtimeEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    event.version === 1 &&
    typeof event.id === 'string' &&
    eventIdPattern.test(event.id) &&
    typeof event.type === 'string' &&
    websiteEventTypes.includes(event.type as WebsiteEventType) &&
    typeof event.businessId === 'string' &&
    uuidPattern.test(event.businessId) &&
    typeof event.conversationId === 'string' &&
    uuidPattern.test(event.conversationId) &&
    (event.messageId === undefined ||
      (typeof event.messageId === 'string' &&
        uuidPattern.test(event.messageId))) &&
    (event.targetSessionId === undefined ||
      (typeof event.targetSessionId === 'string' &&
        uuidPattern.test(event.targetSessionId))) &&
    (event.actor === undefined ||
      event.actor === 'visitor' ||
      event.actor === 'human' ||
      event.actor === 'assistant') &&
    typeof event.occurredAt === 'string' &&
    Number.isFinite(Date.parse(event.occurredAt))
  );
}

@Injectable()
export class WebsiteRealtimeService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(WebsiteRealtimeService.name);
  private publisher?: Redis;
  private subscriber?: Redis;
  private subscriberReady?: Promise<void>;
  private readonly listeners = new Map<
    symbol,
    { scope: WebsiteEventScope; handler: (event: WebsiteRealtimeEvent) => void }
  >();
  private readonly recentEventIds = new Set<string>();
  private readonly recentEventOrder: string[] = [];
  private readonly connectionCounts = new Map<string, number>();
  private publicationFailures = 0;
  private receivedEvents = 0;
  private suppressedDuplicates = 0;
  private subscriberErrors = 0;
  private subscriberReconnects = 0;
  private subscriberConnected = false;
  private publishedEvents = 0;
  private publishLatencyMs = 0;
  private rateLimitedRequests = 0;
  private rejectedConnections = 0;
  private leaseRenewalFailures = 0;
  private abuseProtectionFailures = 0;
  private distributedActiveLeases = 0;
  private metricsTimer?: ReturnType<typeof setInterval>;

  onApplicationBootstrap() {
    void this.sampleDistributedLeases();
    this.metricsTimer = setInterval(() => {
      if (
        this.listeners.size ||
        this.publicationFailures ||
        this.receivedEvents
      )
        this.logger.log({
          event: 'website.realtime.metrics',
          ...this.metrics(),
        });
      void this.sampleDistributedLeases();
    }, 60000);
    this.metricsTimer.unref();
  }

  async publish(
    input: Omit<WebsiteRealtimeEvent, 'version' | 'id' | 'occurredAt'>,
  ): Promise<boolean> {
    if (
      !uuidPattern.test(input.businessId) ||
      !uuidPattern.test(input.conversationId) ||
      (input.messageId !== undefined && !uuidPattern.test(input.messageId))
    )
      return false;
    const event: WebsiteRealtimeEvent = {
      ...input,
      version: 1,
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
    };
    const startedAt = Date.now();
    try {
      await this.ensurePublisher();
      await this.publisher!.publish(topic, JSON.stringify(event));
      this.publishedEvents += 1;
      this.publishLatencyMs += Date.now() - startedAt;
      return true;
    } catch {
      this.abuseProtectionFailures += 1;
      this.logger.warn(
        'Website event publication failed; history remains authoritative.',
      );
      return false;
    }
  }

  async publishTyping(
    input: Omit<
      WebsiteRealtimeEvent,
      'version' | 'id' | 'occurredAt' | 'type'
    > & {
      actor: WebsiteTypingActor;
      active: boolean;
    },
  ): Promise<boolean> {
    if (
      !uuidPattern.test(input.businessId) ||
      !uuidPattern.test(input.conversationId) ||
      !['visitor', 'human', 'assistant'].includes(input.actor)
    )
      return false;
    const stateKey = `kleva:website:typing:v1:${input.businessId}:${input.conversationId}:${input.actor}`;
    try {
      await this.ensurePublisher();
      if (input.active) {
        const throttleKey = `${stateKey}:throttle`;
        const accepted = await this.publisher!.set(
          throttleKey,
          '1',
          'PX',
          900,
          'NX',
        );
        if (accepted !== 'OK') return false;
        await this.publisher!.set(stateKey, '1', 'EX', 6);
      } else {
        const wasActive = await this.publisher!.del(stateKey);
        if (wasActive !== 1) return false;
      }
      return this.publish({
        type: input.active ? 'typing.started' : 'typing.stopped',
        businessId: input.businessId,
        conversationId: input.conversationId,
        actor: input.actor,
      });
    } catch {
      this.publicationFailures += 1;
      this.logger.warn('Website typing notification unavailable.');
      return false;
    }
  }

  async subscribe(
    scope: WebsiteEventScope,
    handler: (event: WebsiteRealtimeEvent) => void,
  ): Promise<() => void> {
    if (
      !uuidPattern.test(scope.businessId) ||
      (scope.conversationId !== undefined &&
        !uuidPattern.test(scope.conversationId)) ||
      (scope.visitorSessionId !== undefined &&
        !uuidPattern.test(scope.visitorSessionId))
    )
      throw new Error('Invalid website event scope.');
    await this.ensureSubscriber();
    const key = Symbol('website-event-listener');
    this.listeners.set(key, { scope, handler });
    return () => this.listeners.delete(key);
  }

  async consumeRateLimit(
    category: string,
    identities: string[],
    limit: number,
    windowSeconds = 60,
  ) {
    const config = websiteAbuseConfig();
    if (!config.rateLimitEnabled) return;
    if (!identities.length || !Number.isInteger(limit) || limit < 1)
      throw new Error('Invalid website rate-limit scope.');
    try {
      await this.ensurePublisher();
      const result = (await this.publisher!.eval(
        rateLimitScript,
        identities.length,
        ...identities.map((identity) => {
          const digest = createHash('sha256').update(identity).digest('hex');
          return `${abuseNamespace()}:limit:${category}:${digest}`;
        }),
        String(windowSeconds * 1000),
        String(limit),
      )) as [number, number];
      if (Number(result[0]) !== 1) {
        this.rateLimitedRequests += 1;
        throw new WebsiteRateLimitException(
          Math.max(1, Math.ceil(Number(result[1]) / 1000)),
        );
      }
    } catch (error) {
      if (error instanceof WebsiteRateLimitException) throw error;
      this.publicationFailures += 1;
      this.logger.warn({ event: 'website.abuse.redis_unavailable', category });
      throw new ServiceUnavailableException(
        'Website chat is temporarily unavailable.',
      );
    }
  }

  async acquireConnectionLease(
    sessionId: string,
    maxConnections: number,
    ttlSeconds = websiteAbuseConfig().sseLeaseTtlSeconds,
  ): Promise<{ renew: () => Promise<boolean>; release: () => Promise<void> }> {
    const key = `${abuseNamespace()}:sse:${createHash('sha256').update(sessionId).digest('hex')}`;
    const leaseId = randomUUID();
    const now = Date.now();
    try {
      await this.ensurePublisher();
      const acquired = await this.publisher!.eval(
        acquireLeaseScript,
        2,
        key,
        `${abuseNamespace()}:sse:active`,
        String(now),
        String(now + ttlSeconds * 1000),
        String(maxConnections),
        leaseId,
        String((ttlSeconds + 5) * 1000),
      );
      if (Number(acquired) !== 1) {
        this.rejectedConnections += 1;
        throw new WebsiteRateLimitException(ttlSeconds);
      }
    } catch (error) {
      if (error instanceof WebsiteRateLimitException) throw error;
      this.logger.warn({ event: 'website.sse.lease_unavailable' });
      this.abuseProtectionFailures += 1;
      throw new ServiceUnavailableException(
        'Website chat is temporarily unavailable.',
      );
    }
    let released = false;
    return {
      renew: async () => {
        if (released) return false;
        try {
          const now = Date.now();
          const renewed = await this.publisher!.eval(
            renewLeaseScript,
            2,
            key,
            `${abuseNamespace()}:sse:active`,
            leaseId,
            String(now),
            String(now + ttlSeconds * 1000),
            String((ttlSeconds + 5) * 1000),
          );
          if (Number(renewed) !== 1) this.leaseRenewalFailures += 1;
          return Number(renewed) === 1;
        } catch {
          this.leaseRenewalFailures += 1;
          return false;
        }
      },
      release: async () => {
        if (released) return;
        released = true;
        try {
          await this.publisher!.eval(
            releaseLeaseScript,
            2,
            key,
            `${abuseNamespace()}:sse:active`,
            leaseId,
          );
        } catch {
          // Lease expiry recovers connections if Redis is unavailable.
        }
      },
    };
  }

  reserveConnection(key: string, maxConnections: number): () => void {
    const count = this.connectionCounts.get(key) ?? 0;
    if (count >= maxConnections)
      throw new Error('Realtime connection limit reached.');
    this.connectionCounts.set(key, count + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.connectionCounts.get(key) ?? 1) - 1;
      if (remaining <= 0) this.connectionCounts.delete(key);
      else this.connectionCounts.set(key, remaining);
    };
  }

  metrics() {
    return {
      activeConnections: [...this.connectionCounts.values()].reduce(
        (sum, count) => sum + count,
        0,
      ),
      localSubscriptions: this.listeners.size,
      publicationFailures: this.publicationFailures,
      receivedEvents: this.receivedEvents,
      suppressedDuplicates: this.suppressedDuplicates,
      subscriberErrors: this.subscriberErrors,
      subscriberReconnects: this.subscriberReconnects,
      publishedEvents: this.publishedEvents,
      averagePublishLatencyMs: this.publishedEvents
        ? Math.round(this.publishLatencyMs / this.publishedEvents)
        : 0,
      rateLimitedRequests: this.rateLimitedRequests,
      rejectedConnections: this.rejectedConnections,
      leaseRenewalFailures: this.leaseRenewalFailures,
      abuseProtectionFailures: this.abuseProtectionFailures,
      distributedActiveLeases: this.distributedActiveLeases,
      redisPublisherReady: this.publisher?.status === 'ready',
      redisSubscriberReady: this.subscriber?.status === 'ready',
    };
  }

  beforeApplicationShutdown() {
    clearInterval(this.metricsTimer);
    this.metricsTimer = undefined;
    this.publisher?.disconnect();
    this.subscriber?.disconnect();
    this.listeners.clear();
    this.connectionCounts.clear();
  }

  private async ensurePublisher() {
    if (!this.publisher) {
      this.publisher = new Redis({
        ...redisOptions(redisConfig()),
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        connectTimeout: 2000,
        commandTimeout: 2000,
        retryStrategy: (attempt) => Math.min(500 + attempt * 250, 5000),
      });
      this.publisher.on('error', () => undefined);
    }
    if (this.publisher.status === 'wait') await this.publisher.connect();
  }

  private async sampleDistributedLeases() {
    try {
      await this.ensurePublisher();
      const key = `${abuseNamespace()}:sse:active`;
      await this.publisher!.zremrangebyscore(key, '-inf', Date.now());
      this.distributedActiveLeases = await this.publisher!.zcard(key);
    } catch {
      this.abuseProtectionFailures += 1;
    }
  }

  private async ensureSubscriber() {
    if (!this.subscriber) {
      this.subscriber = new Redis({
        ...redisOptions(redisConfig()),
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        connectTimeout: 2000,
        retryStrategy: (attempt) => Math.min(500 + attempt * 250, 5000),
      });
      this.subscriber.on('error', () => {
        this.subscriberErrors += 1;
        this.logger.warn('Website realtime subscription is reconnecting.');
      });
      this.subscriber.on('ready', () => {
        if (this.subscriberConnected) this.subscriberReconnects += 1;
        this.subscriberConnected = true;
      });
      this.subscriber.on('message', (_channel, message) =>
        this.receive(message),
      );
    }
    if (!this.subscriberReady) {
      this.subscriberReady = (async () => {
        if (this.subscriber!.status === 'wait')
          await this.subscriber!.connect();
        await this.subscriber!.subscribe(topic);
      })().catch((error: unknown) => {
        this.subscriberReady = undefined;
        throw error;
      });
    }
    await this.subscriberReady;
  }

  private receive(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!validEvent(parsed)) return;
    if (this.recentEventIds.has(parsed.id)) {
      this.suppressedDuplicates += 1;
      return;
    }
    this.recentEventIds.add(parsed.id);
    this.recentEventOrder.push(parsed.id);
    if (this.recentEventIds.size > 2000) {
      const oldest = this.recentEventOrder.shift();
      if (oldest) this.recentEventIds.delete(oldest);
    }
    this.receivedEvents += 1;
    for (const { scope, handler } of this.listeners.values()) {
      if (
        scope.businessId === parsed.businessId &&
        (!scope.conversationId ||
          scope.conversationId === parsed.conversationId) &&
        (parsed.type !== 'session.revoked' ||
          !scope.visitorSessionId ||
          parsed.targetSessionId === scope.visitorSessionId)
      ) {
        try {
          handler(parsed);
        } catch {
          this.logger.warn('Website realtime event listener failed.');
        }
      }
    }
  }
}
