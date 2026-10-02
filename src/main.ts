import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { assertRequiredEnv } from './config/env';

async function bootstrap() {
  assertRequiredEnv();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
