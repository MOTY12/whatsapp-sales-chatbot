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
const currencies = new Set([
  'NGN',
  'USD',
  'GBP',
  'EUR',
  'GHS',
  'KES',
  'ZAR',
  'CAD',
  'AUD',
]);
const availabilities = new Set(['IN_STOCK', 'OUT_OF_STOCK', 'UNKNOWN']);

export type ProductRecord = {
  id: string;
  status: 'DRAFT' | 'PUBLISHED';
  revision: number;
  published_revision: number | null;
  has_unpublished_changes: boolean;
  name: string;
  description: string;
  sku: string | null;
  price: string | null;
  currency: string;
  availability: 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN';
  published_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};
export type PublishedProduct = {
  business_id: string;
  product_id: string;
  published_revision_id: string;
  name: string;
  description: string;
  sku: string | null;
  price: string | null;
  currency: string;
  availability: 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN';
  published_at: Date | string;
};
type ProductInput = {
  name: string;
  description: string;
  sku: string | null;
  price: string | null;
  currency: string;
  availability: 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN';
  expectedRevision?: number;
};

function productInput(body: unknown, updating: boolean): ProductInput {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Expected a product object.');
  const input = body as Record<string, unknown>;
  const allowed = new Set([
    'name',
    'description',
    'sku',
    'price',
    'currency',
    'availability',
    ...(updating ? ['expectedRevision'] : []),
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new BadRequestException('Unexpected product field.');
  if (typeof input.name !== 'string' || input.name.includes('\0'))
    throw new BadRequestException('Product name must be plain text.');
  const name = input.name.trim();
  if (!name || name.length > 160)
    throw new BadRequestException('Product name must be 1–160 characters.');
  if (input.description !== undefined && typeof input.description !== 'string')
    throw new BadRequestException('Description must be plain text.');
  const description =
    typeof input.description === 'string' ? input.description.trim() : '';
  if (description.includes('\0') || description.length > 4000)
    throw new BadRequestException(
      'Description must be at most 4,000 characters.',
    );
  if (
    input.sku !== undefined &&
    input.sku !== null &&
    typeof input.sku !== 'string'
  )
    throw new BadRequestException('SKU must be plain text.');
  const sku = typeof input.sku === 'string' ? input.sku.trim() || null : null;
  if (sku && (sku.length > 100 || sku.includes('\0')))
    throw new BadRequestException('SKU must be at most 100 characters.');
  if (
    input.price !== undefined &&
    input.price !== null &&
    typeof input.price !== 'string'
  )
    throw new BadRequestException('Price must be a decimal string or null.');
  const rawPrice = typeof input.price === 'string' ? input.price.trim() : '';
  let price: string | null = null;
  if (rawPrice) {
    if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(rawPrice))
      throw new BadRequestException(
        'Price must be non-negative with up to two decimal places.',
      );
    const [whole, fractional = ''] = rawPrice.split('.');
    price = `${whole}.${fractional.padEnd(2, '0')}`;
  }
  const currency =
    typeof input.currency === 'string'
      ? input.currency.trim().toUpperCase()
      : 'NGN';
  if (!currencies.has(currency))
    throw new BadRequestException('Choose a supported currency.');
  const availability =
    typeof input.availability === 'string' ? input.availability : 'UNKNOWN';
  if (!availabilities.has(availability))
    throw new BadRequestException('Choose a supported availability.');
  const result: ProductInput = {
    name,
    description,
    sku,
    price,
    currency,
    availability: availability as ProductInput['availability'],
  };
  if (updating) {
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      Number(input.expectedRevision) < 1
    )
      throw new BadRequestException('A valid expected revision is required.');
    result.expectedRevision = Number(input.expectedRevision);
  }
  return result;
}

async function query<T>(
  manager: EntityManager,
  sql: string,
  params: unknown[] = [],
) {
  try {
    return await manager.query<T>(sql, params);
  } catch (error) {
    const code = (error as { driverError?: { code?: string } }).driverError
      ?.code;
    if (code === '40001' || code === '23505')
      throw new ConflictException(
        'This product changed or was submitted already. Refresh and try again.',
      );
    if (code === '42501') throw new ForbiddenException();
    if (code === '22023')
      throw new BadRequestException('Invalid product information.');
    throw error;
  }
}

function pageNumber(value: string | undefined, fallback: number, max: number) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value))
    throw new BadRequestException('Invalid product page.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max)
    throw new BadRequestException('Invalid product page.');
  return parsed;
}

@Injectable()
export class ProductService {
  constructor(private readonly access: MerchantAccess) {}

  list(
    actor: MerchantPrincipal,
    businessId: string,
    limitValue?: string,
    offsetValue?: string,
  ) {
    const limit = pageNumber(limitValue, 50, 99);
    if (limit < 1) throw new BadRequestException('Limit must be at least one.');
    const offset = pageNumber(offsetValue, 0, 10000);
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        const rows = await query<ProductRecord[]>(
          manager,
          'SELECT * FROM public.kleva_product_list($1,$2)',
          [limit + 1, offset],
        );
        return {
          items: rows.slice(0, limit),
          limit,
          offset,
          hasMore: rows.length > limit && offset + limit <= 10000,
        };
      },
    );
  }

  detail(actor: MerchantPrincipal, businessId: string, productId: string) {
    if (!uuid.test(productId)) throw new NotFoundException();
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      (manager) => this.readDetail(manager, productId),
    );
  }

  async create(
    actor: MerchantPrincipal,
    businessId: string,
    key: string | undefined,
    body: unknown,
  ) {
    if (!key || !uuidV4.test(key))
      throw new BadRequestException(
        'Idempotency-Key must be a version 4 UUID.',
      );
    const fields = productInput(body, false);
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        const [result] = await query<{ product_id: string }[]>(
          manager,
          'SELECT public.kleva_product_create($1,$2,$3,$4,$5,$6,$7) AS product_id',
          [
            key,
            fields.name,
            fields.description,
            fields.sku,
            fields.price,
            fields.currency,
            fields.availability,
          ],
        );
        if (!result?.product_id) throw new NotFoundException();
        return this.readDetail(manager, result.product_id);
      },
    );
  }

  async update(
    actor: MerchantPrincipal,
    businessId: string,
    productId: string,
    body: unknown,
  ) {
    if (!uuid.test(productId)) throw new NotFoundException();
    const fields = productInput(body, true);
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        const [result] = await query<{ updated: boolean | null }[]>(
          manager,
          'SELECT public.kleva_product_edit($1,$2,$3,$4,$5,$6,$7,$8) AS updated',
          [
            productId,
            fields.expectedRevision,
            fields.name,
            fields.description,
            fields.sku,
            fields.price,
            fields.currency,
            fields.availability,
          ],
        );
        if (result?.updated === null || result?.updated === undefined)
          throw new NotFoundException();
        return this.readDetail(manager, productId);
      },
    );
  }

  publish(actor: MerchantPrincipal, businessId: string, productId: string) {
    return this.changePublication(actor, businessId, productId, true);
  }

  unpublish(actor: MerchantPrincipal, businessId: string, productId: string) {
    return this.changePublication(actor, businessId, productId, false);
  }

  private async changePublication(
    actor: MerchantPrincipal,
    businessId: string,
    productId: string,
    publish: boolean,
  ) {
    if (!uuid.test(productId)) throw new NotFoundException();
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        const fn = publish
          ? 'kleva_product_publish'
          : 'kleva_product_unpublish';
        const [result] = await query<{ changed: boolean | null }[]>(
          manager,
          `SELECT public.${fn}($1) AS changed`,
          [productId],
        );
        if (result?.changed === null || result?.changed === undefined)
          throw new NotFoundException();
        return this.readDetail(manager, productId);
      },
    );
  }

  private async readDetail(manager: EntityManager, productId: string) {
    const [product] = await query<ProductRecord[]>(
      manager,
      'SELECT * FROM public.kleva_product_detail($1)',
      [productId],
    );
    if (!product) throw new NotFoundException();
    return product;
  }
}
