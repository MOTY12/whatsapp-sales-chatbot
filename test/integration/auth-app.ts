import { NestFactory } from '@nestjs/core';
import { AuthModule } from '../../src/Auth/auth.module';
import { startSmtpFixture } from './smtp-fixture';

async function main() {
  const smtp = await startSmtpFixture((message) => {
    process.send?.({ type: 'smtp_message', message });
  });
  process.env.EMAIL_SMTP_HOST = '127.0.0.1';
  process.env.EMAIL_SMTP_PORT = String(smtp.port);
  process.env.EMAIL_SMTP_SECURE = 'false';
  const app = await NestFactory.create(AuthModule, { abortOnError: false });
  process.once('disconnect', () => {
    void Promise.all([app.close(), smtp.close()]).catch(() => {
      process.exitCode = 1;
    });
  });
  await app.listen(0, '127.0.0.1');
  const url = new URL(await app.getUrl());
  process.send?.({ type: 'ready', port: Number(url.port) });
}

void main().catch(() => {
  console.error('Merchant auth integration fixture could not start.');
  process.exit(1);
});
