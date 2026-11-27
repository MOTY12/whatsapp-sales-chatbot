import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { MerchantPrincipal } from './auth.service';
import { MerchantAccess } from './merchant-access.service';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type CommercialSnapshot = {
  enrollment: Record<string, unknown> | null;
  invoices: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  entitlement_events: Array<Record<string, unknown>>;
};

async function queryRow<T>(
  manager: EntityManager,
  sql: string,
  parameters?: unknown[],
): Promise<T | undefined> {
  const rows: unknown = await manager.query(sql, parameters);
  if (!Array.isArray(rows)) return undefined;
  const row: unknown = rows[0];
  return typeof row === 'object' && row !== null ? (row as T) : undefined;
}

function safeFailure(error: unknown): never {
  const code =
    (error as { code?: string; driverError?: { code?: string } })?.code ??
    (error as { driverError?: { code?: string } })?.driverError?.code;
  if (code === '42501') throw new ForbiddenException();
  if (code === '22023')
    throw new ConflictException(
      'This commercial offer is no longer available.',
    );
  if (code === '23505')
    throw new ConflictException('This commercial action was already recorded.');
  throw new ServiceUnavailableException(
    'Commercial account information is temporarily unavailable.',
  );
}

async function snapshot(manager: EntityManager): Promise<CommercialSnapshot> {
  const row = await queryRow<{ commercial: CommercialSnapshot }>(
    manager,
    'SELECT public.kleva_commercial_read() AS commercial',
  );
  return (
    row?.commercial ?? {
      enrollment: null,
      invoices: [],
      payments: [],
      entitlement_events: [],
    }
  );
}

@Injectable()
export class MerchantCommercialService {
  constructor(private readonly access: MerchantAccess) {}

  read(actor: MerchantPrincipal, businessId: string) {
    return this.access.withBusiness(
      actor,
      businessId,
      'business.read',
      async (manager) => {
        try {
          return await snapshot(manager);
        } catch (error) {
          safeFailure(error);
        }
      },
    );
  }

  async readiness(actor: MerchantPrincipal, businessId: string) {
    return this.access.withBusiness(
      actor,
      businessId,
      'business.read',
      async (manager) => {
        try {
          const row = await queryRow<{ readiness: unknown }>(
            manager,
            'SELECT public.kleva_commercial_readiness() AS readiness',
          );
          return row?.readiness ?? {};
        } catch (error) {
          safeFailure(error);
        }
      },
    );
  }

  accept(
    actor: MerchantPrincipal,
    businessId: string,
    offerId: string,
    body: unknown,
  ) {
    if (!uuid.test(offerId)) throw new BadRequestException('Invalid offer.');
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      typeof (body as Record<string, unknown>).requestKey !== 'string' ||
      !uuid.test((body as Record<string, string>).requestKey)
    ) {
      throw new BadRequestException(
        'A valid acceptance request key is required.',
      );
    }
    return this.access.withBusiness(
      actor,
      businessId,
      'business.update',
      async (manager) => {
        try {
          const row = await queryRow<{ enrollment: unknown }>(
            manager,
            'SELECT public.kleva_commercial_offer_accept($1,$2) AS enrollment',
            [offerId, (body as Record<string, string>).requestKey],
          );
          return row?.enrollment;
        } catch (error) {
          safeFailure(error);
        }
      },
    );
  }
}
