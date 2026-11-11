import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { appConfig } from './config/env';
import { ApplicationLogger, correlateRequest } from './config/logging';

async function bootstrap() {
  let config: ReturnType<typeof appConfig>;
  try {
    config = appConfig();
  } catch (error) {
    // Configuration errors report variable names and expected formats.
    console.error(
      error instanceof Error
        ? error.message
        : 'Invalid application configuration.',
    );
    process.exitCode = 1;
    return;
  }

  const logger = new ApplicationLogger(config.logLevels);
  let app: INestApplication | undefined;
  try {
    app = await NestFactory.create(AppModule, {
      rawBody: true,
      abortOnError: false,
      logger,
    });
    app.use(correlateRequest);
    await app.listen(config.port);
  } catch (error) {
    logger.error(error, 'Bootstrap');
    process.exitCode = 1;
    await app?.close().catch((closeError: unknown) => {
      logger.error(closeError, 'Shutdown');
    });
  }
}
void bootstrap();
