import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

const purgeIntervalMs = 6 * 60 * 60 * 1000;

@Injectable()
export class KnowledgeGapRetentionService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(KnowledgeGapRetentionService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(@InjectDataSource() private readonly database: DataSource) {}

  onApplicationBootstrap() {
    void this.purge().catch(() => undefined);
    this.timer = setInterval(() => {
      void this.purge().catch(() => undefined);
    }, purgeIntervalMs);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async purge() {
    try {
      const [result] = await this.database.query<{ removed: number }[]>(
        'SELECT public.kleva_learning_gap_purge_expired() AS removed',
      );
      if (Number(result?.removed ?? 0) > 0) {
        this.logger.log({
          event: 'learning.knowledge_gap_retention_applied',
          removedOccurrences: Number(result.removed),
        });
      }
    } catch {
      this.logger.warn({
        event: 'learning.knowledge_gap_retention_unavailable',
      });
    }
  }
}
