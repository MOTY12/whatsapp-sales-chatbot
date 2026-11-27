import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';

const recentMessageLimit = 8;
const databaseWindowLimit = 64;
const historyCharacterLimit = 1800;
const summaryCharacterLimit = 900;
const perMessageCharacterLimit = 420;

type RunContextRow = {
  business_id: string;
  conversation_id: string;
  inbound_message_id: string;
  authorized_control_version: string | number;
  control_mode: string;
  control_version: string | number;
  current_created_at: Date | string;
};

type MessageRow = {
  id: string;
  direction: 'inbound' | 'outbound';
  content: string;
  created_at: Date | string;
};

type SummaryRow = {
  summary: string;
  covered_through_created_at: Date | string;
  covered_through_message_id: string;
  revision: number;
};

export type ConversationMemoryContext = {
  history: Array<{ role: 'customer' | 'assistant'; content: string }>;
  summary?: string;
  conversationVersion: string;
};

@Injectable()
export class ConversationMemoryService {
  constructor(@InjectDataSource() private readonly database: DataSource) {}

  async prepare(aiRunId: string): Promise<ConversationMemoryContext> {
    return this.database.transaction(async (manager) => {
      await manager.query("SET LOCAL statement_timeout = '1500ms'");
      const [run] = await manager.query<RunContextRow[]>(
        `SELECT a.business_id,a.conversation_id,a.inbound_message_id,
            a.authorized_control_version,c.control_mode,c.control_version,
            current_message."createdAt" AS current_created_at
          FROM public.ai_response_runs a
          JOIN public.conversations c ON c.id=a.conversation_id AND c."businessId"=a.business_id
          JOIN public.messages current_message ON current_message.id=a.inbound_message_id
            AND current_message."businessId"=a.business_id
            AND current_message."conversationId"=a.conversation_id
          WHERE a.id=$1 AND a.status IN ('PENDING','PROCESSING','GENERATED')
            AND current_message.direction='inbound'
            AND c.control_mode='AUTO'
            AND c.control_version=a.authorized_control_version
            AND NOT EXISTS (
              SELECT 1 FROM public.messages newer
              WHERE newer."businessId"=a.business_id AND newer."conversationId"=a.conversation_id
                AND newer.direction='inbound'
                AND (newer."createdAt",newer.id)>(current_message."createdAt",current_message.id)
            )
          FOR SHARE OF c`,
        [aiRunId],
      );
      if (!run) throw new Error('Conversation memory is stale.');

      const messages = await manager.query<MessageRow[]>(
        `SELECT id,direction,content,"createdAt" AS created_at
          FROM public.messages
          WHERE "businessId"=$1 AND "conversationId"=$2
            AND direction IN ('inbound','outbound')
            AND ("createdAt",id)<($3::timestamp,$4::uuid)
          ORDER BY "createdAt" DESC,id DESC LIMIT $5`,
        [
          run.business_id,
          run.conversation_id,
          run.current_created_at,
          run.inbound_message_id,
          databaseWindowLimit,
        ],
      );
      const chronological = messages.reverse();
      const recent = chronological.slice(-recentMessageLimit);
      const older = chronological.slice(0, -recentMessageLimit);
      const history = this.boundHistory(recent);

      const [saved] = await manager.query<SummaryRow[]>(
        `SELECT summary,covered_through_created_at,covered_through_message_id,revision
          FROM public.conversation_summaries
          WHERE business_id=$1 AND conversation_id=$2`,
        [run.business_id, run.conversation_id],
      );
      let summary = saved?.summary ?? '';
      if (older.length) {
        const watermark = older.at(-1)!;
        const delta = older.filter((message) =>
          this.isAfterWatermark(message, saved),
        );
        if (!saved || delta.length) {
          const priorText = saved ? [saved.summary] : [];
          summary = this.boundSummary([
            ...priorText,
            ...delta.map((message) => this.summaryLine(message)),
          ]);
          if (summary)
            await this.persistSummary(
              manager,
              aiRunId,
              run,
              summary,
              watermark,
              saved?.revision ?? 0,
            );
        }
      }

      return {
        history,
        ...(summary ? { summary } : {}),
        conversationVersion: String(run.control_version),
      };
    });
  }

  private async persistSummary(
    manager: EntityManager,
    aiRunId: string,
    run: RunContextRow,
    summary: string,
    watermark: MessageRow,
    expectedRevision: number,
  ) {
    await manager.query(
      `INSERT INTO public.conversation_summaries
        (business_id,conversation_id,summary,covered_through_created_at,
         covered_through_message_id,revision,updated_at)
       SELECT $1,$2,$3,$4,$5,1,now()
       WHERE EXISTS (
         SELECT 1 FROM public.ai_response_runs a
         JOIN public.conversations c ON c.id=a.conversation_id AND c."businessId"=a.business_id
         WHERE a.id=$6 AND a.business_id=$1 AND a.conversation_id=$2
           AND a.authorized_control_version=$7 AND c.control_mode='AUTO'
           AND c.control_version=a.authorized_control_version
           AND NOT EXISTS (
             SELECT 1 FROM public.messages newer JOIN public.messages current_message
               ON current_message.id=a.inbound_message_id AND current_message."businessId"=a.business_id
             WHERE newer."businessId"=a.business_id AND newer."conversationId"=a.conversation_id
               AND newer.direction='inbound'
               AND (newer."createdAt",newer.id)>(current_message."createdAt",current_message.id)
           )
       )
       ON CONFLICT (business_id,conversation_id) DO UPDATE SET
         summary=EXCLUDED.summary,
         covered_through_created_at=EXCLUDED.covered_through_created_at,
         covered_through_message_id=EXCLUDED.covered_through_message_id,
         revision=conversation_summaries.revision+1,updated_at=now()
       WHERE conversation_summaries.revision=$8
         AND (conversation_summaries.covered_through_created_at,conversation_summaries.covered_through_message_id)
           < (EXCLUDED.covered_through_created_at,EXCLUDED.covered_through_message_id)`,
      [
        run.business_id,
        run.conversation_id,
        summary,
        watermark.created_at,
        watermark.id,
        aiRunId,
        run.authorized_control_version,
        expectedRevision,
      ],
    );
  }

  private boundHistory(messages: MessageRow[]) {
    const output: ConversationMemoryContext['history'] = [];
    let remaining = historyCharacterLimit;
    for (const item of [...messages].reverse()) {
      if (remaining <= 0) break;
      const content = this.clean(item.content).slice(
        0,
        Math.min(perMessageCharacterLimit, remaining),
      );
      if (!content) continue;
      output.push({
        role: item.direction === 'inbound' ? 'customer' : 'assistant',
        content,
      });
      remaining -= content.length;
    }
    return output.reverse();
  }

  private boundSummary(lines: string[]) {
    const useful = lines.map((line) => this.clean(line)).filter(Boolean);
    let result = useful.join('\n');
    while (result.length > summaryCharacterLimit && useful.length > 1) {
      useful.shift();
      result = useful.join('\n');
    }
    return result.slice(-summaryCharacterLimit);
  }

  private summaryLine(message: MessageRow) {
    const label = message.direction === 'inbound' ? 'Customer' : 'Assistant';
    return `${label}: ${this.clean(message.content).slice(0, perMessageCharacterLimit)}`;
  }

  private clean(value: string) {
    return Array.from(value)
      .filter((character) => {
        const code = character.charCodeAt(0);
        return !(
          (code >= 0 && code <= 8) ||
          code === 11 ||
          code === 12 ||
          (code >= 14 && code <= 31) ||
          code === 127
        );
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isAfterWatermark(message: MessageRow, watermark?: SummaryRow) {
    if (!watermark) return true;
    const time = new Date(message.created_at).getTime();
    const savedTime = new Date(watermark.covered_through_created_at).getTime();
    return (
      time > savedTime ||
      (time === savedTime &&
        message.id.localeCompare(watermark.covered_through_message_id) > 0)
    );
  }
}
