import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { Account } from '../../src/database/entities/account.entity';
import { ConversationMemoryService } from '../../src/support-agent/conversation-memory.service';
import { applyMigrations, createIntegrationDatabase } from './postgres';
import { seedTenant } from './fixtures';

describe('bounded tenant conversation memory', () => {
  let database: Awaited<ReturnType<typeof createIntegrationDatabase>>;
  let admin: DataSource;
  let runtime: DataSource;
  let memory: ConversationMemoryService;
  let first: Awaited<ReturnType<typeof seedTenant>>;
  let second: Awaited<ReturnType<typeof seedTenant>>;
  let currentRunId: string;
  let privateNote: string;

  beforeAll(async () => {
    database = await createIntegrationDatabase();
    admin = await database.migrator();
    await applyMigrations(admin);
    first = await seedTenant(admin, 1);
    second = await seedTenant(admin, 2);
    await database.grantRuntimeAccess(admin);
    runtime = await database.runtime();
    memory = new ConversationMemoryService(runtime);
    const actor = await admin.getRepository(Account).save({
      issuer: 'https://memory.integration.test',
      subject: randomUUID(),
    });
    privateNote = `private note ${randomUUID()}`;
    await admin.query(
      `INSERT INTO public.conversation_internal_notes
        (business_id,conversation_id,actor_account_id,body)
       VALUES($1,$2,$3,$4)`,
      [first.business.id, first.conversation.id, actor.id, privateNote],
    );
    const base = new Date('2026-02-01T12:00:00.000Z');
    await admin.query('UPDATE public.messages SET "createdAt"=$2 WHERE id=$1', [
      first.message.id,
      new Date(base.getTime() - 60_000),
    ]);
    await addMessage(first, 'inbound', 'How much is the Samsung A15?', base, 1);
    await addMessage(
      first,
      'outbound',
      'The published price is NGN 180,000.',
      base,
      2,
    );
    const currentId = await addMessage(
      first,
      'inbound',
      'Do you have it in black?',
      base,
      3,
    );
    currentRunId = await createRun(first, currentId);
    await addMessage(
      second,
      'inbound',
      'Other tenant private context.',
      base,
      4,
    );
  });

  afterAll(async () => {
    await runtime?.destroy();
    await database?.close();
  });

  async function addMessage(
    tenant: typeof first,
    direction: 'inbound' | 'outbound',
    content: string,
    base: Date,
    offset: number,
  ) {
    const id = randomUUID();
    const createdAt = new Date(base.getTime() + offset * 1000);
    await admin.query(
      `INSERT INTO public.messages(id,"businessId","conversationId",direction,content,status,"createdAt","whatsappMessageId")
       VALUES($1,$2,$3,$4,$5,'received',$6,$7)`,
      [
        id,
        tenant.business.id,
        tenant.conversation.id,
        direction,
        content,
        createdAt,
        `memory-${id}`,
      ],
    );
    return id;
  }

  async function createRun(tenant: typeof first, messageId: string) {
    const [conversation] = await admin.query<
      { control_version: string | number }[]
    >('SELECT control_version FROM public.conversations WHERE id=$1', [
      tenant.conversation.id,
    ]);
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.ai_response_runs(id,business_id,inbound_message_id,conversation_id,authorized_control_version)
       VALUES($1,$2,$3,$4,$5)`,
      [
        id,
        tenant.business.id,
        messageId,
        tenant.conversation.id,
        conversation.control_version,
      ],
    );
    return id;
  }

  it('resolves an English follow-up from prior customer and assistant turns', async () => {
    const context = await memory.prepare(currentRunId);
    expect(context.history).toEqual([
      { role: 'customer', content: 'Tenant 1 text' },
      { role: 'customer', content: 'How much is the Samsung A15?' },
      { role: 'assistant', content: 'The published price is NGN 180,000.' },
    ]);
    expect(context.summary).toBeUndefined();
    expect(context.conversationVersion).toBe('1');
  });

  it('keeps summary and recent context bounded, tenant scoped and free of private notes', async () => {
    const base = new Date('2026-03-01T12:00:00.000Z');
    await admin.query('UPDATE public.messages SET "createdAt"=$2 WHERE id=$1', [
      first.message.id,
      new Date(base.getTime() - 60_000),
    ]);
    const priorMessages: string[] = [];
    for (let index = 1; index <= 14; index += 1) {
      const direction = index % 2 ? 'inbound' : 'outbound';
      const text =
        index === 1
          ? 'Pidgin: How much be Samsung A15?'
          : index === 2
            ? 'E cost NGN 180,000.'
            : index < 8
              ? `Turn ${index}: short conversation detail.`
              : `Turn ${index}: ${'context '.repeat(80)}`;
      priorMessages.push(await addMessage(first, direction, text, base, index));
    }
    const currentId = await addMessage(
      first,
      'inbound',
      'E get am for black?',
      base,
      15,
    );
    const runId = await createRun(first, currentId);
    const context = await memory.prepare(runId);
    expect(context.history.length).toBeLessThanOrEqual(8);
    expect(context.history.at(-1)?.content).toContain('Turn 14:');
    expect(context.summary).toContain('Pidgin: How much be Samsung A15?');
    expect(context.summary).toContain('E cost NGN 180,000.');
    expect(context.summary).not.toContain(privateNote);
    expect(context.summary).not.toContain('Other tenant private context');
    expect(context.summary!.length).toBeLessThanOrEqual(900);
    expect(
      context.history.reduce((sum, item) => sum + item.content.length, 0),
    ).toBeLessThanOrEqual(1800);
    expect(
      context.history.some((item) =>
        item.content.includes('E get am for black?'),
      ),
    ).toBe(false);
    const [saved] = await admin.query<
      { revision: number; covered_through_message_id: string }[]
    >(
      'SELECT revision,covered_through_message_id FROM public.conversation_summaries WHERE business_id=$1 AND conversation_id=$2',
      [first.business.id, first.conversation.id],
    );
    expect(saved.revision).toBe(1);
    expect(priorMessages).toContain(saved.covered_through_message_id);
    await memory.prepare(runId);
    const [again] = await admin.query<{ revision: number }[]>(
      'SELECT revision FROM public.conversation_summaries WHERE business_id=$1 AND conversation_id=$2',
      [first.business.id, first.conversation.id],
    );
    expect(again.revision).toBe(1);
  });

  it('rejects memory for a stale run after a newer customer message arrives', async () => {
    const base = new Date('2026-04-01T12:00:00.000Z');
    await addMessage(first, 'inbound', 'A newer question.', base, 100);
    await expect(memory.prepare(currentRunId)).rejects.toThrow(
      'Conversation memory is stale.',
    );
  });
});
