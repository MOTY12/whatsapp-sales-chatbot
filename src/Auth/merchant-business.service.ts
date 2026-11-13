import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { MerchantPrincipal } from './auth.service';
import { MerchantAccess } from './merchant-access.service';
import { MerchantDatabase } from './merchant-database';

const limits = {
  name: 120,
  industry: 80,
  phone: 32,
  timezone: 80,
  description: 2000,
  openingHours: 500,
};
type Field = keyof typeof limits;
type ProfileInput = Partial<Record<Field, string | null>>;
type Profile = Record<Field, string | null> & { id: string; status: string };

export function normalizeMerchantProfile(body: unknown, create: boolean) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Expected a profile object.');
  }
  const fields: ProfileInput = {};
  for (const [key, value] of Object.entries(body)) {
    if (!Object.hasOwn(limits, key)) {
      throw new BadRequestException('Unexpected business profile field.');
    }
    const field = key as Field;
    if (
      value === null &&
      (field === 'description' || field === 'openingHours')
    ) {
      fields[field] = null;
      continue;
    }
    if (typeof value !== 'string' || value.includes('\0')) {
      throw new BadRequestException('Invalid ' + field + '.');
    }
    const text = value.trim();
    if (!text || text.length > limits[field]) {
      throw new BadRequestException('Invalid ' + field + '.');
    }
    fields[field] = text;
  }
  if (
    create &&
    (!fields.name || !fields.industry || !fields.phone || !fields.timezone)
  ) {
    throw new BadRequestException(
      'Name, industry, phone and timezone are required.',
    );
  }
  if (!Object.keys(fields).length) {
    throw new BadRequestException('Provide at least one profile field.');
  }
  if (fields.phone) {
    const number = fields.phone.replace(/[ ()-]/g, '');
    if (!/^\+[1-9]\d{6,14}$/.test(number)) {
      throw new BadRequestException(
        'Use an international phone number with a country code.',
      );
    }
    fields.phone = number;
  }
  if (fields.timezone) {
    try {
      if (!/^[a-z][a-z0-9_+/-]*$/i.test(fields.timezone))
        throw new RangeError();
      fields.timezone = new Intl.DateTimeFormat('en', {
        timeZone: fields.timezone,
      }).resolvedOptions().timeZone;
    } catch {
      throw new BadRequestException('Use a named IANA timezone.');
    }
  }
  return create ? { description: null, openingHours: null, ...fields } : fields;
}

// The database logger records the SQLSTATE. Keep query parameters, including
// session digests and profile fields, out of Nest's exception logger.
async function query<T>(
  connection: DataSource | EntityManager,
  statement: string,
  parameters: unknown[] = [],
): Promise<T> {
  try {
    return await connection.query<T>(statement, parameters);
  } catch {
    throw new InternalServerErrorException();
  }
}

@Injectable()
export class MerchantBusinessService {
  constructor(
    private readonly database: MerchantDatabase,
    private readonly access: MerchantAccess,
  ) {}

  async create(
    actor: MerchantPrincipal,
    key: string | undefined,
    body: unknown,
  ) {
    if (
      !key ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      )
    ) {
      throw new BadRequestException(
        'Idempotency-Key must be a version 4 UUID.',
      );
    }
    const fields = normalizeMerchantProfile(body, true);
    const [result] = await query<
      { business_id: string | null; outcome: string }[]
    >(
      this.database.connection(),
      'SELECT * FROM public.kleva_create_merchant_business($1, $2, $3)',
      [actor.sessionDigest, key, JSON.stringify(fields)],
    );
    if (result.outcome === 'unauthorized') throw new UnauthorizedException();
    if (result.outcome === 'conflict') {
      throw new ConflictException(
        'Idempotency key already used for a different profile.',
      );
    }
    if (!result.business_id) throw new NotFoundException();
    return this.read(actor, result.business_id);
  }

  read(actor: MerchantPrincipal, id: string) {
    return this.profile(actor, id);
  }

  update(actor: MerchantPrincipal, id: string, body: unknown) {
    return this.profile(actor, id, normalizeMerchantProfile(body, false));
  }

  private profile(
    actor: MerchantPrincipal,
    id: string,
    changes?: ProfileInput,
  ) {
    return this.access.withBusiness(
      actor,
      id,
      changes ? 'business.update' : 'business.read',
      async (manager, membership) => {
        if (changes) {
          const [result] = await query<{ updated: boolean }[]>(
            manager,
            'SELECT public.kleva_update_merchant_profile($1) AS updated',
            [JSON.stringify(changes)],
          );
          if (!result.updated) throw new NotFoundException();
        }
        const [profile] = await query<Profile[]>(
          manager,
          'SELECT * FROM public.kleva_read_merchant_profile()',
        );
        if (!profile) throw new NotFoundException();
        return { ...profile, role: membership.role };
      },
    );
  }
}
