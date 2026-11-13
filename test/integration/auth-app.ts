import { NestFactory } from '@nestjs/core';
import { AuthModule } from '../../src/Auth/auth.module';

async function main() {
  const app = await NestFactory.create(AuthModule, { abortOnError: false });
  process.once('disconnect', () => {
    void app.close().catch(() => {
      process.exitCode = 1;
    });
  });
  await app.listen(0, '127.0.0.1');
  const url = new URL(await app.getUrl());
  process.send?.(Number(url.port));
}

void main().catch(() => {
  console.error('Merchant auth integration fixture could not start.');
  process.exit(1);
});
