import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { MerchantPrincipal } from '../Auth/auth.service';
import { MerchantAccess } from '../Auth/merchant-access.service';

const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type FaqRecord = {
  id: string;
  status: 'DRAFT' | 'PUBLISHED';
  revision: number;
  published_revision: number | null;
  has_unpublished_changes: boolean;
  question: string;
  answer: string;
  published_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};
type FaqInput = { question: string; answer: string; expectedRevision?: number };

function content(body: unknown, updating: boolean): FaqInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Expected a FAQ object.');
  }
  const input = body as Record<string, unknown>;
  const allowed = updating
    ? new Set(['question', 'answer', 'expectedRevision'])
    : new Set(['question', 'answer']);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new BadRequestException('Unexpected FAQ field.');
  }
  const question = input.question;
  const answer = input.answer;
  if (typeof question !== 'string' || question.includes('\0')) {
    throw new BadRequestException('Question must be plain text.');
  }
  if (typeof answer !== 'string' || answer.includes('\0')) {
    throw new BadRequestException('Answer must be plain text.');
  }
  const normalized = { question: question.trim(), answer: answer.trim() };
  if (!normalized.question || normalized.question.length > 500) {
    throw new BadRequestException(
      'Question must be between 1 and 500 characters.',
    );
  }
  if (!normalized.answer || normalized.answer.length > 5000) {
    throw new BadRequestException(
      'Answer must be between 1 and 5000 characters.',
    );
  }
  if (!updating) return normalized;
  const expectedRevision = input.expectedRevision;
  if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1) {
    throw new BadRequestException('A valid expected revision is required.');
  }
  return { ...normalized, expectedRevision: Number(expectedRevision) };
}

async function query<T>(
  manager: EntityManager,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  try {
    return await manager.query<T>(sql, params);
  } catch (error) {
    const code = (error as { driverError?: { code?: string } }).driverError
      ?.code;
    if (code === '40001' || code === '23505') {
      throw new ConflictException(
        'This FAQ changed or was submitted already. Refresh and try again.',
      );
    }
    if (code === '42501') throw new ForbiddenException();
    if (code === '22023') throw new BadRequestException('Invalid FAQ content.');
    throw error;
  }
}

@Injectable()
export class KnowledgeFaqService {
  constructor(private readonly access: MerchantAccess) {}

  list(actor: MerchantPrincipal, businessId: string) {
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      (manager) =>
        query<FaqRecord[]>(manager, 'SELECT * FROM public.kleva_faq_list()'),
    );
  }

  detail(actor: MerchantPrincipal, businessId: string, faqId: string) {
    if (!uuid.test(faqId)) throw new NotFoundException();
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      (manager) => this.readDetail(manager, faqId),
    );
  }

  async create(
    actor: MerchantPrincipal,
    businessId: string,
    key: string | undefined,
    body: unknown,
  ) {
    if (!key || !uuidV4.test(key)) {
      throw new BadRequestException(
        'Idempotency-Key must be a version 4 UUID.',
      );
    }
    const fields = content(body, false);
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        const [result] = await query<{ faq_id: string }[]>(
          manager,
          'SELECT public.kleva_faq_create($1,$2,$3) AS faq_id',
          [key, fields.question, fields.answer],
        );
        if (!result?.faq_id) throw new NotFoundException();
        return this.readDetail(manager, result.faq_id);
      },
    );
  }

  async update(
    actor: MerchantPrincipal,
    businessId: string,
    faqId: string,
    body: unknown,
  ) {
    if (!uuid.test(faqId)) throw new NotFoundException();
    const fields = content(body, true);
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        const [result] = await query<{ updated: boolean | null }[]>(
          manager,
          'SELECT public.kleva_faq_edit($1,$2,$3,$4) AS updated',
          [faqId, fields.expectedRevision, fields.question, fields.answer],
        );
        if (result?.updated === null || result?.updated === undefined)
          throw new NotFoundException();
        return this.readDetail(manager, faqId);
      },
    );
  }

  publish(actor: MerchantPrincipal, businessId: string, faqId: string) {
    return this.changePublication(actor, businessId, faqId, true);
  }

  unpublish(actor: MerchantPrincipal, businessId: string, faqId: string) {
    return this.changePublication(actor, businessId, faqId, false);
  }

  private async changePublication(
    actor: MerchantPrincipal,
    businessId: string,
    faqId: string,
    publish: boolean,
  ) {
    if (!uuid.test(faqId)) throw new NotFoundException();
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        const fn = publish ? 'kleva_faq_publish' : 'kleva_faq_unpublish';
        const [result] = await query<{ changed: boolean | null }[]>(
          manager,
          `SELECT public.${fn}($1) AS changed`,
          [faqId],
        );
        if (result?.changed === null || result?.changed === undefined)
          throw new NotFoundException();
        return this.readDetail(manager, faqId);
      },
    );
  }

  private async readDetail(manager: EntityManager, faqId: string) {
    const [faq] = await query<FaqRecord[]>(
      manager,
      'SELECT * FROM public.kleva_faq_detail($1)',
      [faqId],
    );
    if (!faq) throw new NotFoundException();
    return faq;
  }
}
