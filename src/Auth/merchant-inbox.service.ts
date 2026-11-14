import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MerchantPrincipal } from './auth.service';
import { MerchantAccess } from './merchant-access.service';
import { OutboundMessageService } from '../whatsapp/outbound-message.service';

type Cursor = { at: string; id: string };
type InboxListRow = {
  id: string;
  customer_name: string;
  customer_whatsapp_id: string;
  last_activity: Date | string;
  preview: string | null;
  status: string | null;
  control_mode: 'AUTO' | 'HUMAN';
  control_version: string;
  in_flight: string;
};
type InboxConversationRow = Omit<InboxListRow, 'last_activity' | 'preview'> & {
  control_changed_at: Date | string;
};
type InboxMessageRow = {
  id: string;
  direction: string;
  content: string;
  status: string;
  provider_message_id: string | null;
  created_at: Date | string;
  authorization_kind: string | null;
  error_classification: string | null;
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validateConversationId(value: string) {
  if (!uuid.test(value)) throw new NotFoundException();
}
const cursorEncode = (value: Cursor) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
function cursorDecode(value?: string): Cursor | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString(),
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error();
    const candidate = parsed as { at?: unknown; id?: unknown };
    if (
      typeof candidate.at !== 'string' ||
      !Number.isFinite(Date.parse(candidate.at)) ||
      typeof candidate.id !== 'string' ||
      !uuid.test(candidate.id)
    )
      throw new Error();
    return {
      at: new Date(candidate.at).toISOString(),
      id: candidate.id,
    };
  } catch {
    throw new BadRequestException('Invalid pagination cursor.');
  }
}
function pageLimit(value?: string) {
  if (value === undefined) return 30;
  if (!/^\d{1,3}$/.test(value))
    throw new BadRequestException('Invalid page size.');
  return Math.min(100, Math.max(1, Number(value)));
}

@Injectable()
export class MerchantInboxService {
  constructor(
    private readonly access: MerchantAccess,
    private readonly outbound: OutboundMessageService,
  ) {}

  async list(
    actor: MerchantPrincipal,
    businessId: string,
    limit?: string,
    rawCursor?: string,
  ) {
    const size = pageLimit(limit);
    const cursor = cursorDecode(rawCursor);
    return this.access.withBusiness(
      actor,
      businessId,
      'inbox.operate',
      async (manager) => {
        const rows = await manager.query<InboxListRow[]>(
          'SELECT * FROM public.kleva_inbox_list($1,$2,$3)',
          [size + 1, cursor?.at ?? null, cursor?.id ?? null],
        );
        const hasMore = rows.length > size;
        const items = rows.slice(0, size);
        return {
          items,
          nextCursor:
            hasMore && items.length
              ? cursorEncode({
                  at: new Date(
                    items[items.length - 1].last_activity,
                  ).toISOString(),
                  id: items[items.length - 1].id,
                })
              : null,
        };
      },
    );
  }

  async conversation(
    actor: MerchantPrincipal,
    businessId: string,
    conversationId: string,
  ) {
    validateConversationId(conversationId);
    return this.access.withBusiness(
      actor,
      businessId,
      'inbox.operate',
      async (manager) => {
        const [row] = await manager.query<InboxConversationRow[]>(
          'SELECT * FROM public.kleva_inbox_conversation($1)',
          [conversationId],
        );
        if (!row) throw new NotFoundException();
        return row;
      },
    );
  }

  async messages(
    actor: MerchantPrincipal,
    businessId: string,
    conversationId: string,
    limit?: string,
    rawCursor?: string,
  ) {
    validateConversationId(conversationId);
    const size = pageLimit(limit);
    const cursor = cursorDecode(rawCursor);
    return this.access.withBusiness(
      actor,
      businessId,
      'inbox.operate',
      async (manager) => {
        const rows = await manager.query<InboxMessageRow[]>(
          'SELECT * FROM public.kleva_inbox_messages($1,$2,$3,$4)',
          [conversationId, size + 1, cursor?.at ?? null, cursor?.id ?? null],
        );
        if (!rows.length) {
          const [exists] = await manager.query<InboxConversationRow[]>(
            'SELECT * FROM public.kleva_inbox_conversation($1)',
            [conversationId],
          );
          if (!exists) throw new NotFoundException();
        }
        const hasMore = rows.length > size;
        const page = rows.slice(0, size);
        return {
          items: page.reverse(),
          nextCursor:
            hasMore && page.length
              ? cursorEncode({
                  at: new Date(page[0].created_at).toISOString(),
                  id: page[0].id,
                })
              : null,
        };
      },
    );
  }

  async changeControl(
    actor: MerchantPrincipal,
    businessId: string,
    conversationId: string,
    mode: 'AUTO' | 'HUMAN',
  ) {
    validateConversationId(conversationId);
    return this.access.withBusiness(
      actor,
      businessId,
      'inbox.operate',
      async (manager) => {
        const [result] = await manager.query<
          {
            id: string;
            control_mode: 'AUTO' | 'HUMAN';
            control_version: string;
            control_changed_at: Date | string;
            changed: boolean;
          }[]
        >('SELECT * FROM public.kleva_inbox_change_control($1,$2)', [
          conversationId,
          mode,
        ]);
        if (!result) throw new NotFoundException();
        return {
          conversationId: result.id,
          mode: result.control_mode,
          controlVersion: Number(result.control_version),
          changedAt: result.control_changed_at,
          changed: result.changed,
        };
      },
    );
  }

  async reply(
    actor: MerchantPrincipal,
    businessId: string,
    conversationId: string,
    key: string | undefined,
    body: unknown,
  ) {
    validateConversationId(conversationId);
    if (!key || !uuidV4.test(key)) {
      throw new BadRequestException(
        'Idempotency-Key must be a version 4 UUID.',
      );
    }
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((field) => field !== 'text')
    ) {
      throw new BadRequestException('Provide a text reply.');
    }
    const text = (body as { text?: unknown }).text;
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > 4096 ||
      text.includes('\0')
    ) {
      throw new BadRequestException(
        'Reply text must contain 1 to 4096 characters.',
      );
    }
    const recipient = await this.access.withBusiness(
      actor,
      businessId,
      'inbox.operate',
      async (manager) => {
        const [result] = await manager.query<
          { whatsapp_id: string; control_mode: string }[]
        >('SELECT * FROM public.kleva_inbox_recipient($1)', [conversationId]);
        if (!result) throw new NotFoundException();
        if (result.control_mode !== 'HUMAN')
          throw new BadRequestException(
            'Take over this conversation before replying.',
          );
        return result.whatsapp_id;
      },
    );
    const outboundId = await this.outbound.enqueueTextMessage(
      businessId,
      { to: recipient, message: text.trim() },
      key,
      undefined,
      { conversationId, kind: 'HUMAN' },
    );
    return { outboundMessageId: outboundId, status: 'QUEUED' };
  }
}
