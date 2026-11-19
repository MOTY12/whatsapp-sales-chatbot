import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
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
  displayPhoneNumber: string | null;
  status: 'active' | 'inactive' | 'pending';
  revision: number;
  connectionState?:
    'not_connected' | 'connecting' | 'action_required' | 'failed' | 'connected';
  signupFailure?: string | null;
  signupExpiresAt?: string | null;
}

type SignupInput = {
  attemptId: string;
  code: string;
  wabaId: string;
  phoneNumberId: string;
  registrationPin: string;
};

const safeFailureClasses = [
  'SIGNUP_EXPIRED',
  'META_CODE_EXCHANGE_FAILED',
  'WEBHOOK_SUBSCRIPTION_FAILED',
  'PHONE_REGISTRATION_FAILED',
  'ASSET_VERIFICATION_FAILED',
  'CONNECTION_PERSIST_FAILED',
  'META_REPORTED_ERROR',
] as const;
const uuidV4Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function signupInput(body: unknown): SignupInput {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Invalid WhatsApp signup response.');
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).length !== 5 ||
    typeof value.attemptId !== 'string' ||
    !uuidV4Pattern.test(value.attemptId) ||
    typeof value.code !== 'string' ||
    value.code.length < 1 ||
    value.code.length > 4096 ||
    typeof value.registrationPin !== 'string' ||
    !/^\d{6}$/.test(value.registrationPin) ||
    !isMetaId(value.wabaId) ||
    !isMetaId(value.phoneNumberId)
  )
    throw new BadRequestException('Invalid WhatsApp signup response.');
  return value as SignupInput;
}

function signupReport(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Invalid WhatsApp signup status.');
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => !['attemptId', 'outcome'].includes(key)) ||
    typeof value.attemptId !== 'string' ||
    !uuidV4Pattern.test(value.attemptId) ||
    !['action_required', 'failed', 'cancelled'].includes(String(value.outcome))
  )
    throw new BadRequestException('Invalid WhatsApp signup status.');
  return { attemptId: value.attemptId, outcome: value.outcome as string };
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
  private readonly logger = new Logger(MerchantWhatsAppService.name);

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
      async (manager) => {
        const connection = await this.read(manager);
        const [signup] = await query<
          {
            status: string;
            failure_class: string | null;
            expires_at: string;
          }[]
        >(manager, 'SELECT * FROM public.kleva_whatsapp_signup_status()');
        const connectionState =
          connection?.status === 'active'
            ? 'connected'
            : connection?.status === 'inactive'
              ? 'action_required'
              : signup?.status === 'CONNECTING' ||
                  signup?.status === 'PROCESSING'
                ? 'connecting'
                : signup?.status === 'ACTION_REQUIRED'
                  ? 'action_required'
                  : signup?.status === 'FAILED'
                    ? 'failed'
                    : 'not_connected';
        return {
          ...(connection ?? { status: 'pending' as const }),
          connectionState,
          signupFailure: signup?.failure_class ?? null,
          signupExpiresAt: signup?.expires_at ?? null,
        };
      },
    );
    return result ?? { status: 'pending' };
  }

  async startEmbeddedSignup(actor: MerchantPrincipal, businessId: string) {
    const settings = this.meta.embeddedSignupSettings();
    const attemptId = randomUUID();
    const [created] = await this.access.withBusiness(
      actor,
      businessId,
      'whatsapp.manage',
      (manager) =>
        query<{ id: string }[]>(
          manager,
          "SELECT public.kleva_whatsapp_signup_start($1, now() + interval '15 minutes') AS id",
          [attemptId],
        ),
    );
    if (!created?.id)
      throw new ConflictException(
        'A WhatsApp signup is already in progress or this business is unavailable.',
      );
    return { attemptId: created.id, ...settings };
  }

  async reportEmbeddedSignup(
    actor: MerchantPrincipal,
    businessId: string,
    body: unknown,
  ) {
    const report = signupReport(body);
    const mapping = {
      action_required: ['ACTION_REQUIRED', 'META_REPORTED_ERROR'],
      failed: ['FAILED', 'META_REPORTED_ERROR'],
      cancelled: ['CANCELLED', null],
    } as const;
    const [status, failure] = mapping[report.outcome as keyof typeof mapping];
    const [updated] = await this.access.withBusiness(
      actor,
      businessId,
      'whatsapp.manage',
      (manager) =>
        query<{ ok: boolean }[]>(
          manager,
          'SELECT public.kleva_whatsapp_signup_update($1,$2,$3) AS ok',
          [report.attemptId, status, failure],
        ),
    );
    if (!updated?.ok)
      throw new ConflictException(
        'WhatsApp signup attempt is no longer available.',
      );
    return { ok: true };
  }

  async completeEmbeddedSignup(
    actor: MerchantPrincipal,
    businessId: string,
    body: unknown,
  ) {
    const value = signupInput(body);
    const snapshot = await this.access.withBusiness(
      actor,
      businessId,
      'whatsapp.manage',
      async (manager) => {
        const [claimed] = await query<{ ok: boolean }[]>(
          manager,
          'SELECT public.kleva_whatsapp_signup_claim($1) AS ok',
          [value.attemptId],
        );
        if (!claimed?.ok)
          throw new ConflictException(
            'This WhatsApp signup has expired or was already used. Start again.',
          );
        const current = await this.read(manager);
        if (
          current &&
          (current.phoneNumberId !== value.phoneNumberId ||
            current.wabaId !== value.wabaId)
        ) {
          throw new ConflictException(
            'Disconnect the current WhatsApp account before connecting a different account.',
          );
        }
        const [candidate] = await query<{ id: string }[]>(
          manager,
          'SELECT id FROM public.kleva_whatsapp_candidate($1)',
          [value.phoneNumberId],
        );
        return {
          current,
          connectionId: current?.id ?? candidate?.id ?? randomUUID(),
        };
      },
    );

    let stage = 'META_CODE_EXCHANGE_FAILED';
    try {
      if (value.phoneNumberId === this.platformAsset)
        throw new ConflictException(
          'This phone number is reserved for platform onboarding.',
        );
      const exchanged = await this.meta.exchangeCode(value.code);
      stage = 'WEBHOOK_SUBSCRIPTION_FAILED';
      await this.meta.subscribeToWebhooks(exchanged.accessToken, value.wabaId);
      stage = 'PHONE_REGISTRATION_FAILED';
      await this.meta.registerPhoneNumber(
        exchanged.accessToken,
        value.phoneNumberId,
        value.registrationPin,
      );
      stage = 'ASSET_VERIFICATION_FAILED';
      const verified = await this.meta.verify(
        exchanged.accessToken,
        value.wabaId,
        value.phoneNumberId,
      );
      if (!verified.displayPhoneNumber)
        throw new BadRequestException(
          'Meta did not return a verified display phone number.',
        );
      const expirationTimes = [exchanged.expiresAt, verified.expiresAt]
        .filter((value): value is string => value !== null)
        .map((value) => Date.parse(value));
      const expiresAt = expirationTimes.length
        ? new Date(Math.min(...expirationTimes)).toISOString()
        : null;
      if (expiresAt && Date.parse(expiresAt) <= Date.now())
        throw new BadRequestException(
          'Meta returned an expired WhatsApp authorization.',
        );
      const envelope = this.cipher.encrypt(
        exchanged.accessToken,
        businessId.toLowerCase(),
        snapshot.connectionId,
      );
      stage = 'CONNECTION_PERSIST_FAILED';
      const saved = await this.access.withBusiness(
        actor,
        businessId,
        'whatsapp.manage',
        async (manager) => {
          await this.writeEmbedded(manager, [
            snapshot.current ? 'rotate' : 'connect',
            snapshot.current?.revision ?? null,
            snapshot.connectionId,
            value.phoneNumberId,
            value.wabaId,
            verified.displayName,
            verified.displayPhoneNumber,
            JSON.stringify(envelope),
            expiresAt,
          ]);
          const [finished] = await query<{ ok: boolean }[]>(
            manager,
            'SELECT public.kleva_whatsapp_signup_finish($1) AS ok',
            [value.attemptId],
          );
          if (!finished?.ok)
            throw new ConflictException(
              'WhatsApp signup attempt is no longer available.',
            );
          return this.read(manager);
        },
      );
      if (!saved)
        throw new ConflictException(
          'Meta verified the account but the connection could not be saved.',
        );
      return saved;
    } catch (error) {
      const failureClass = safeFailureClasses.includes(
        stage as (typeof safeFailureClasses)[number],
      )
        ? stage
        : 'CONNECTION_PERSIST_FAILED';
      this.logger.warn({
        event: 'whatsapp.embedded_signup_failed',
        stage: failureClass,
      });
      await this.access
        .withBusiness(actor, businessId, 'whatsapp.manage', async (manager) => {
          await query(
            manager,
            'SELECT public.kleva_whatsapp_signup_update($1,$2,$3)',
            [value.attemptId, 'FAILED', failureClass],
          );
        })
        .catch(() => undefined);
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException
      )
        throw error;
      throw new ServiceUnavailableException(
        'WhatsApp could not be connected. Start a new attempt and try again.',
      );
    }
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
      'SELECT * FROM public.kleva_whatsapp_status_v2()',
    );
    return status;
  }

  private async writeEmbedded(manager: EntityManager, args: unknown[]) {
    const [result] = await query<{ ok: boolean }[]>(
      manager,
      'SELECT public.kleva_write_whatsapp_v2($1,$2,$3,$4,$5,$6,$7,$8,$9) AS ok',
      args,
    );
    if (!result.ok)
      throw new ConflictException(
        'WhatsApp connection changed or is unavailable.',
      );
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
