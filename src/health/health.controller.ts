import {
  Controller,
  Get,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseReadiness {
  private pending?: Promise<boolean>;

  constructor(private readonly database: DataSource) {}

  async check(): Promise<boolean> {
    // Share one probe while the pool or server is unresponsive.
    this.pending ??= this.database
      .query('SELECT 1')
      .then(
        () => true,
        () => false,
      )
      .finally(() => {
        this.pending = undefined;
      });

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.pending,
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 1000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

@Controller('health')
export class HealthController {
  constructor(private readonly readiness: DatabaseReadiness) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    if (!(await this.readiness.check())) {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
    return { status: 'ok' };
  }
}
