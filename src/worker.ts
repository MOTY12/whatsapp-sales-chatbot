import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { databaseConfig, logLevelsConfig, workerConfig } from './config/env';
import { ApplicationLogger } from './config/logging';
import { redisOptions } from './jobs/queue';
import { WorkerModule } from './jobs/worker.module';

async function bootstrap() {
  let levels: ReturnType<typeof logLevelsConfig>;
  try {
    databaseConfig();
    redisOptions(workerConfig().redis);
    levels = logLevelsConfig();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Invalid worker configuration.',
    );
    process.exitCode = 1;
    return;
  }

  const logger = new ApplicationLogger(levels);
  try {
    const worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger,
      abortOnError: false,
    });
    worker.enableShutdownHooks();
  } catch (error) {
    logger.error(error, 'WorkerBootstrap');
    process.exitCode = 1;
  }
}

void bootstrap();
