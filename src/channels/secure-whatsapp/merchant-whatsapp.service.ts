import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { metaConfig } from '../../config/env';
import { errorCode } from '../../config/logging';
import { MerchantAccess } from '../../Auth/merchant-access.service';
import type { MerchantPrincipal } from '../../Auth/auth.service';
import { randomUUID } from 'node:crypto';
import { CredentialCipher } from './credential-cipher';
import { MetaWhatsAppVerifier } from './meta-verifier';

export interface Status {
  id: string;
  wabaId: string;
  phoneNumberId: string;
  displayName: string | null;
  status: 'active' | 'inactive' | 'pending';
  revision: number;
}

async function query<T>(
  manager: EntityManager,
  sql: string,
  args: unknown[] = [],
) {
  try {
    return await manager.query<T>(sql, args);
  } catch (error) {
    const code = errorCode(error);
    if (code === '23505' || code === '23514') {
      throw new ConflictException(
        'WhatsApp asset is already reserved or conflicts with legacy ownership.',
      );
    }
    throw new InternalServerErrorException();
  }
}

function input(body: unknown, rotate: boolean) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Expected a WhatsApp connection request.');
  }
  const fields = body as Record<string, unknown>;
  const allowed = rotate
    ? ['accessToken']
    : ['accessToken', 'phoneNumberId', 'wabaId'];
  if (Object.keys(fields).some((key) => !allowed.includes(key))) {
    throw new BadRequestException('Unexpected connection field.');
  }
  const { accessToken, phoneNumberId, wabaId } = fields;
  if (
    typeof accessToken !== 'string' ||
    !/^[A-Za-z0-9._|-]{1,4096}$/.test(accessToken) ||
    (!rotate && (!isMetaId(phoneNumberId) || !isMetaId(wabaId)))
  ) {
    throw new BadRequestException('Invalid credential or Meta identifiers.');
  }
  return {
    accessToken,
    phoneNumberId: phoneNumberId as string,
    wabaId: wabaId as string,
  };
}

function isMetaId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{1,32}$/.test(value);
}

@Injectable()
export class MerchantWhatsAppService {
  private readonly platformAsset = metaConfig().phoneNumberId;

  constructor(
    private readonly access: MerchantAccess,
    private readonly cipher: CredentialCipher,
    private readonly meta: MetaWhatsAppVerifier,
  ) {}

  async status(actor: MerchantPrincipal, businessId: string) {
    const result = await this.access.withBusiness(
      actor,
      businessId,
      'business.read',
      (manager) => this.read(manager),
    );
    return result ?? { status: 'pending' };
  }

  async connect(
    actor: MerchantPrincipal,
    businessId: string,
    body: unknown,
    rotate = false,
  ) {
    const values = input(body, rotate);
    const snapshot = await this.access.withBusiness(
      actor,
      businessId,
      'whatsapp.manage',
      async (manager) => {
        const current = await this.read(manager);
        if (rotate && !current) throw new NotFoundException();
        if (
          !rotate &&
          current &&
          (current.status === 'active' ||
            current.phoneNumberId !== values.phoneNumberId ||
            current.wabaId !== values.wabaId)
        ) {
          throw new ConflictException(
            'Use rotation for the existing WhatsApp asset.',
          );
        }
        const [candidate] = !current
          ? await query<{ id: string }[]>(
              manager,
              'SELECT id FROM public.kleva_whatsapp_candidate($1)',
              [values.phoneNumberId],
            )
          : [];
        return {
          current,
          connectionId: current?.id ?? candidate?.id ?? randomUUID(),
        };
      },
    );
    const phoneId = snapshot.current?.phoneNumberId ?? values.phoneNumberId;
    const wabaId = snapshot.current?.wabaId ?? values.wabaId;
    if (phoneId === this.platformAsset) {
      throw new ConflictException(
        'This asset is reserved for platform onboarding.',
      );
    }
    const verified = await this.meta.verify(
      values.accessToken,
      wabaId,
      phoneId,
    );
    const envelope = this.cipher.encrypt(
      values.accessToken,
      businessId.toLowerCase(),
      snapshot.connectionId,
    );
    return this.access.withBusiness(
      actor,
      businessId,
      'whatsapp.manage',
      async (manager) => {
        await this.write(manager, [
          rotate ? 'rotate' : 'connect',
          snapshot.current?.revision ?? null,
          snapshot.connectionId,
          phoneId,
          wabaId,
          verified.displayName,
          JSON.stringify(envelope),
          verified.expiresAt,
        ]);
        return this.read(manager);
      },
    );
  }

  disconnect(actor: MerchantPrincipal, businessId: string) {
    return this.access.withBusiness(
      actor,
      businessId,
      'whatsapp.manage',
      async (manager) => {
        const current = await this.read(manager);
        if (!current) throw new NotFoundException();
        await this.write(manager, [
          'disconnect',
          current.revision,
          null,
          null,
          null,
          null,
          null,
          null,
        ]);
        return this.read(manager);
      },
    );
  }

  private async read(manager: EntityManager) {
    const [status] = await query<Status[]>(
      manager,
      'SELECT * FROM public.kleva_whatsapp_status()',
    );
    return status;
  }

  private async write(manager: EntityManager, args: unknown[]) {
    const [result] = await query<{ ok: boolean }[]>(
      manager,
      'SELECT public.kleva_write_whatsapp($1,$2,$3,$4,$5,$6,$7,$8) AS ok',
      args,
    );
    if (!result.ok)
      throw new ConflictException(
        'WhatsApp connection changed or is unavailable.',
      );
  }
}
