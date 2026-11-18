import { NestFactory } from '@nestjs/core';
import { AuthModule } from '../../src/Auth/auth.module';
import { EmailService } from '../../src/Email/email.service';
import { OutboxStore } from '../../src/jobs/outbox.store';
import { OutboxProcessor } from '../../src/jobs/outbox.processor';

type FixtureFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

async function main() {
  const upstreamFetch: FixtureFetch = globalThis.fetch;
  const fixtureFetch: FixtureFetch = (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url !== 'https://api.mailjet.com/v3.1/send')
      return upstreamFetch(input, init);
    const rawBody = typeof init?.body === 'string' ? init.body : '{}';
    const request = JSON.parse(rawBody) as unknown as {
      Messages?: Array<{ Subject?: string; TextPart?: string }>;
    };
    process.send?.({
      type: 'mailjet_message',
      message: `${request.Messages?.[0]?.Subject ?? ''}\n${request.Messages?.[0]?.TextPart ?? ''}`,
    });
    return Promise.resolve(
      new Response(
        JSON.stringify({
          Messages: [{ Status: 'success', To: [{ MessageID: 123 }] }],
        }),
        { status: 200 },
      ),
    );
  };
  globalThis.fetch = fixtureFetch;
  const app = await NestFactory.create(AuthModule, { abortOnError: false });
  const outbox = app.get(OutboxStore);
  const email = app.get(EmailService);
  const processor = new OutboxProcessor(
    outbox,
    new Map([
      ['merchant.email', { execute: (operation) => email.execute(operation) }],
    ]),
  );
  let polling = false;
  const pollTimer = setInterval(() => {
    if (polling) return;
    polling = true;
    void (async () => {
      for (const claim of await outbox.claimDue()) {
        await outbox.dispatched(claim);
        await processor.process(
          { id: claim.id },
          `${claim.id}-${claim.attempts}`,
        );
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        polling = false;
      });
  }, 20);
  process.once('disconnect', () => {
    clearInterval(pollTimer);
    void app.close().catch(() => {
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
