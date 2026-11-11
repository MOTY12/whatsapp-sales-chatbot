import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { ConsoleLogger, Logger, type LogLevel } from '@nestjs/common';
import type { RequestHandler } from 'express';
import type { Logger as TypeOrmLogger } from 'typeorm';

const requestContext = new AsyncLocalStorage<string>();
const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const privateKey =
  /authorization|cookie|password|secret|token|credential|dsn|database.?url|connection.?string|api.?key|payload|headers|query|body/i;

export function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return;
  const code = error.code;
  if (typeof code === 'string' && /^[A-Z0-9_]{4,40}$/.test(code)) return code;
}

export class ApplicationLogger extends ConsoleLogger {
  private readonly secrets: string[];

  constructor(levels: LogLevel[], env = process.env) {
    super({ json: true, logLevels: levels });
    this.secrets = Object.entries(env)
      .filter(
        ([key]) =>
          privateKey.test(key) || /^DATABASE_(HOST|USER|NAME)$/.test(key),
      )
      .flatMap(([, value]) =>
        value?.trim() ? [value, encodeURIComponent(value)] : [],
      )
      .sort((a, b) => b.length - a.length);
  }

  private redact(value: unknown, depth = 0): unknown {
    if (typeof value === 'string') {
      let text = value
        .replace(/\b(?:postgres(?:ql)?|rediss?):\/\/[^\s"']+/gi, '[REDACTED]')
        .replace(/\bBearer\s+[^\s,"']+/gi, 'Bearer [REDACTED]')
        .replace(
          /([?&](?:access_token|client_secret|code|hub\.verify_token)=)[^&#\s]+/gi,
          '$1[REDACTED]',
        );
      for (const secret of this.secrets)
        text = text.replaceAll(secret, '[REDACTED]');
      return text;
    }
    if (value instanceof Error)
      return { error: 'Operation failed', code: errorCode(value) };
    if (!value || typeof value !== 'object') return value;
    if (depth >= 5) return '[REDACTED]';
    if (Array.isArray(value))
      return value.map((entry) => this.redact(entry, depth + 1));
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        privateKey.test(key) ? '[REDACTED]' : this.redact(entry, depth + 1),
      ]),
    );
  }

  protected printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: LogLevel,
    writeStreamType?: 'stdout' | 'stderr',
  ) {
    const requestId = requestContext.getStore();
    const safe = messages.map((message) => {
      const value = this.redact(message);
      return requestId ? { requestId, event: value } : value;
    });
    super.printMessages(safe, context, logLevel, writeStreamType);
  }

  protected printStackTrace(): void {
    // Error stacks may include PostgreSQL or provider data.
  }
}

const requestLogger = new Logger('HTTP');

export const correlateRequest: RequestHandler = (request, response, next) => {
  const incoming = request.get('x-request-id');
  const requestId =
    incoming && requestIdPattern.test(incoming) ? incoming : randomUUID();
  response.setHeader('x-request-id', requestId);
  const start = performance.now();
  requestContext.run(requestId, () => {
    response.once('finish', () => {
      requestContext.run(requestId, () => {
        requestLogger.log({
          event: 'request.completed',
          method: request.method,
          status: response.statusCode,
          durationMs: Math.round(performance.now() - start),
        });
      });
    });
    next();
  });
};

export function databaseLogger(logQueries: boolean): TypeOrmLogger {
  const logger = new Logger('PostgreSQL');
  return {
    logQuery() {
      if (logQueries) logger.log('Query executed');
    },
    logQueryError(error) {
      logger.error({ event: 'query.failed', code: errorCode(error) });
    },
    logQuerySlow(time) {
      logger.warn({ event: 'query.slow', durationMs: time });
    },
    logSchemaBuild(message) {
      // Preserve the CLI's migration status and completion output.
      if (
        /^\[(?:X\] \d+| \]) [\w]+\d{13}$/.test(message) ||
        /^Migration \w+\d{13} has been (?:\(fake\) )?(?:executed|reverted) successfully\.$/.test(
          message,
        ) ||
        message === 'No migrations are pending' ||
        message ===
          'No migrations were found in the database. Nothing to revert!'
      ) {
        logger.log(message);
      }
    },
    logMigration(message) {
      const name = /^Migration "(\w+\d{13})" failed,/.exec(message)?.[1];
      logger.error({ event: 'migration.failed', name });
    },
    log(level) {
      if (level === 'warn') logger.warn('Database warning');
    },
  };
}
