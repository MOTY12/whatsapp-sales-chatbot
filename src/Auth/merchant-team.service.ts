import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  Inject,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { MerchantPrincipal } from './auth.service';
import { MerchantAccess } from './merchant-access.service';
import { MerchantDatabase } from './merchant-database';
import { EmailService } from '../Email/email.service';
import { merchantTeamConfig } from '../config/env';
import { currentRequestId } from '../config/logging';

export const MERCHANT_TEAM_CONFIG = Symbol('MERCHANT_TEAM_CONFIG');
type MerchantTeamConfig = ReturnType<typeof merchantTeamConfig>;
type MemberRow = {
  membership_id: string;
  account_id: string;
  full_name: string | null;
  email: string | null;
  role: 'owner' | 'editor' | 'agent' | 'staff';
  status: 'active' | 'inactive';
  joined_at: Date | string;
  revoked_at: Date | string | null;
  membership_version: number;
  total_count?: string | number;
};
type TeamInvitationRow = {
  id: string;
  recipient_email: string;
  invited_role: 'editor' | 'agent';
  status: string;
  delivery_status: 'PENDING' | 'QUEUED' | 'FAILED';
  invited_by: string;
  created_at: Date | string;
  expires_at: Date | string;
  resend_count: number;
};
type InvitationRow = {
  invitation_id: string;
  outcome: 'created' | 'replayed' | 'conflict';
  business_name: string;
  recipient_email: string;
  invited_role: 'editor' | 'agent';
  expires_at: Date | string;
};
type ResendRow = {
  invitation_id: string;
  recipient_email: string;
  invited_role: 'editor' | 'agent';
  business_name: string;
  expires_at: Date | string;
  outcome: string;
};
type TeamAuditRow = {
  id: string;
  actor_account_id: string | null;
  target_account_id: string | null;
  target_id: string | null;
  event_kind: string;
  previous_value: Record<string, unknown> | null;
  next_value: Record<string, unknown> | null;
  correlation_id: string | null;
  created_at: Date | string;
};
type AcceptRow = {
  business_id: string;
  business_name: string;
  role: string;
  outcome: string;
};
const tokenDigest = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const digestPayload = (email: string, role: string) =>
  createHash('sha256').update(JSON.stringify({ email, role })).digest();
const v4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const opaque = /^[A-Za-z0-9_-]{43}$/;

function safeDatabaseFailure(error: unknown): never {
  const code =
    (error as { code?: string; driverError?: { code?: string } })?.code ??
    (error as { driverError?: { code?: string } })?.driverError?.code;
  if (code === '23505')
    throw new ConflictException(
      'A member or pending invitation already exists.',
    );
  if (code === '40001')
    throw new ConflictException(
      'This team member changed. Refresh and try again.',
    );
  if (code === '42501') throw new ForbiddenException();
  if (code === '53300')
    throw new HttpException(
      'Invitation rate limit reached.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  if (code === '22023')
    throw new BadRequestException('This invitation is no longer available.');
  if (code === '23514')
    throw new ConflictException(
      'A business must retain at least one active owner.',
    );
  throw new ServiceUnavailableException(
    'Team management is temporarily unavailable.',
  );
}

@Injectable()
export class MerchantTeamService {
  private readonly logger = new Logger(MerchantTeamService.name);

  constructor(
    private readonly access: MerchantAccess,
    private readonly database: MerchantDatabase,
    private readonly email: EmailService,
    @Inject(MERCHANT_TEAM_CONFIG) private readonly config: MerchantTeamConfig,
  ) {}

  list(
    actor: MerchantPrincipal,
    businessId: string,
    options: {
      limit?: number;
      offset?: number;
      role?: string;
      status?: string;
      search?: string;
    } = {},
  ) {
    const limit = this.page(options.limit);
    const offset = this.offset(options.offset);
    const role = this.filter(options.role, [
      'owner',
      'editor',
      'agent',
      'staff',
    ]);
    const status = this.filter(options.status, ['active', 'inactive']);
    const search = this.search(options.search);
    return this.run(() =>
      this.access.withBusiness(
        actor,
        businessId,
        'team.manage',
        async (manager) => {
          const rows = (await manager.query(
            'SELECT * FROM public.kleva_team_members($1,$2,$3,$4,$5)',
            [limit, offset, role, status, search],
          )) as unknown as MemberRow[];
          return {
            items: rows.map((row) => this.memberDto(row)),
            limit,
            offset,
            total: Number(rows[0]?.total_count ?? 0),
          };
        },
      ),
    );
  }

  detail(actor: MerchantPrincipal, businessId: string, membershipId: string) {
    return this.run(() =>
      this.access.withBusiness(
        actor,
        businessId,
        'team.manage',
        async (manager) => {
          const [row] = await manager.query<MemberRow[]>(
            'SELECT * FROM public.kleva_team_member($1)',
            [this.uuid(membershipId)],
          );
          if (!row) throw new NotFoundException();
          return this.memberDto(row);
        },
      ),
    );
  }

  invitations(
    actor: MerchantPrincipal,
    businessId: string,
    limit?: number,
    offset?: number,
  ) {
    return this.run(() =>
      this.access.withBusiness(
        actor,
        businessId,
        'team.manage',
        async (manager) => {
          const items = await manager.query<TeamInvitationRow[]>(
            'SELECT * FROM public.kleva_team_invitations($1,$2)',
            [this.page(limit), this.offset(offset)],
          );
          return {
            items,
            limit: this.page(limit),
            offset: this.offset(offset),
          };
        },
      ),
    );
  }

  audit(
    actor: MerchantPrincipal,
    businessId: string,
    limit?: number,
    offset?: number,
  ) {
    return this.run(() =>
      this.access.withBusiness(
        actor,
        businessId,
        'team.manage',
        async (manager) => ({
          items: await manager.query<TeamAuditRow[]>(
            'SELECT * FROM public.kleva_team_audit($1,$2)',
            [this.page(limit), this.offset(offset)],
          ),
        }),
      ),
    );
  }

  async invite(
    actor: MerchantPrincipal,
    businessId: string,
    key: string | undefined,
    body: unknown,
  ) {
    if (!key || !v4.test(key))
      throw new BadRequestException(
        'Idempotency-Key must be a version 4 UUID.',
      );
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('Expected an invitation object.');
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some((field) => !['email', 'role'].includes(field)))
      throw new BadRequestException('Unexpected invitation field.');
    const email =
      typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const role = input.role;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      throw new BadRequestException('Enter a valid email address.');
    if (role !== 'editor' && role !== 'agent')
      throw new BadRequestException('Choose editor or agent access.');
    const secret = randomBytes(32).toString('base64url');
    const result = await this.run(() =>
      this.access.withBusiness(
        actor,
        businessId,
        'team.manage',
        async (manager) => {
          const [row] = await manager.query<InvitationRow[]>(
            'SELECT * FROM public.kleva_team_invitation_create($1,$2,$3,$4,$5,$6)',
            [
              key,
              digestPayload(email, role),
              email,
              role,
              tokenDigest(secret),
              this.config.invitationTtlSeconds,
            ],
          );
          if (row.outcome === 'conflict')
            throw new ConflictException(
              'Idempotency key already used for another invitation.',
            );
          return row;
        },
      ),
    );
    if (result.outcome === 'replayed')
      return {
        id: result.invitation_id,
        email: result.recipient_email,
        role: result.invited_role,
        expiresAt: result.expires_at,
        deliveryStatus: 'existing',
      };
    try {
      await this.email.sendTeamInvitation(
        result.recipient_email,
        result.business_name,
        result.invited_role,
        secret,
        new Date(result.expires_at),
      );
      await this.markDelivery(
        actor,
        businessId,
        result.invitation_id,
        'QUEUED',
      );
      return {
        id: result.invitation_id,
        email: result.recipient_email,
        role: result.invited_role,
        expiresAt: result.expires_at,
        deliveryStatus: 'QUEUED',
      };
    } catch {
      await this.markDelivery(
        actor,
        businessId,
        result.invitation_id,
        'FAILED',
      ).catch(() => undefined);
      this.logger.warn({
        event: 'merchant_team.invitation_delivery_failed',
        businessId,
        invitationId: result.invitation_id,
      });
      throw new ServiceUnavailableException(
        'The invitation was saved, but email could not be queued. Resend it from pending invitations.',
      );
    }
  }

  async resend(
    actor: MerchantPrincipal,
    businessId: string,
    invitationId: string,
  ) {
    const secret = randomBytes(32).toString('base64url');
    const result = await this.run(() =>
      this.access.withBusiness(
        actor,
        businessId,
        'team.manage',
        async (manager) => {
          const [row] = await manager.query<ResendRow[]>(
            'SELECT * FROM public.kleva_team_invitation_resend($1,$2,$3,$4,$5)',
            [
              this.uuid(invitationId),
              tokenDigest(secret),
              this.config.invitationTtlSeconds,
              this.config.invitationResendCooldownSeconds,
              this.config.invitationMaxAttempts,
            ],
          );
          if (!row) throw new NotFoundException();
          return row;
        },
      ),
    );
    try {
      await this.email.sendTeamInvitation(
        result.recipient_email,
        result.business_name,
        result.invited_role,
        secret,
        new Date(result.expires_at),
      );
      await this.markDelivery(
        actor,
        businessId,
        result.invitation_id,
        'QUEUED',
      );
      return {
        id: result.invitation_id,
        deliveryStatus: 'QUEUED',
        expiresAt: result.expires_at,
      };
    } catch {
      await this.markDelivery(
        actor,
        businessId,
        result.invitation_id,
        'FAILED',
      ).catch(() => undefined);
      this.logger.warn({
        event: 'merchant_team.invitation_delivery_failed',
        businessId,
        invitationId: result.invitation_id,
      });
      throw new ServiceUnavailableException(
        'The invitation could not be queued. Try again after the resend cooldown.',
      );
    }
  }

  revokeInvitation(actor: MerchantPrincipal, businessId: string, id: string) {
    return this.run(() =>
      this.access.withBusiness(
        actor,
        businessId,
        'team.manage',
        async (manager) => {
          const [row] = await manager.query<{ revoked: boolean }[]>(
            'SELECT public.kleva_team_invitation_revoke($1) AS revoked',
            [this.uuid(id)],
          );
          if (!row?.revoked) throw new NotFoundException();
          return { revoked: true };
        },
      ),
    );
  }

  changeRole(
    actor: MerchantPrincipal,
    businessId: string,
    id: string,
    body: unknown,
  ) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('Expected a role update.');
    const input = body as Record<string, unknown>;
    if (
      Object.keys(input).some(
        (field) => !['role', 'version'].includes(field),
      ) ||
      (input.role !== 'editor' && input.role !== 'agent') ||
      !Number.isInteger(input.version) ||
      (input.version as number) < 1
    )
      throw new BadRequestException(
        'Provide an eligible role and current membership version.',
      );
    return this.run(() =>
      this.access.withBusiness(
        actor,
        businessId,
        'team.manage',
        async (manager) => {
          const [row] = await manager.query<
            { changed: boolean; current_version: number }[]
          >('SELECT * FROM public.kleva_team_member_role($1,$2,$3)', [
            this.uuid(id),
            input.role,
            input.version,
          ]);
          if (!row?.changed) throw new NotFoundException();
          return { changed: true, version: row.current_version };
        },
      ),
    );
  }

  revokeMember(
    actor: MerchantPrincipal,
    businessId: string,
    id: string,
    version: unknown,
  ) {
    if (!Number.isInteger(version) || (version as number) < 1)
      throw new BadRequestException('Provide the current membership version.');
    return this.run(() =>
      this.access.withBusiness(
        actor,
        businessId,
        'team.manage',
        async (manager) => {
          const [row] = await manager.query<
            { revoked: boolean; current_version: number }[]
          >('SELECT * FROM public.kleva_team_member_revoke($1,$2)', [
            this.uuid(id),
            version,
          ]);
          if (!row?.revoked) throw new NotFoundException();
          return { revoked: true, version: row.current_version };
        },
      ),
    );
  }

  async accept(sessionDigest: string, body: unknown) {
    const token =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>).token
        : undefined;
    if (typeof token !== 'string' || !opaque.test(token))
      throw new BadRequestException('Invalid or expired invitation.');
    return this.run(async () => {
      const [result] = await this.database
        .connection()
        .transaction(async (manager) => {
          await manager.query("SELECT set_config('kleva.request_id',$1,true)", [
            currentRequestId() ?? '',
          ]);
          return manager.query<AcceptRow[]>(
            'SELECT * FROM public.kleva_team_invitation_accept($1,$2,$3)',
            [
              sessionDigest,
              tokenDigest(token),
              this.config.invitationMaxAttempts,
            ],
          );
        });
      if (!result)
        throw new NotFoundException('Invitation is invalid or expired.');
      return {
        businessId: result.business_id,
        businessName: result.business_name,
        role: result.role,
        accepted: result.outcome !== 'replayed',
      };
    });
  }

  private async markDelivery(
    actor: MerchantPrincipal,
    businessId: string,
    id: string,
    status: 'QUEUED' | 'FAILED',
  ) {
    return this.access.withBusiness(
      actor,
      businessId,
      'team.manage',
      async (manager) => {
        await manager.query(
          'SELECT public.kleva_team_invitation_delivery($1,$2)',
          [id, status],
        );
      },
    );
  }

  private uuid(id: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new NotFoundException();
    return id;
  }
  private page(value?: number) {
    return Number.isInteger(value) ? Math.min(Math.max(value!, 1), 100) : 50;
  }
  private offset(value?: number) {
    return Number.isInteger(value) ? Math.max(value!, 0) : 0;
  }
  private filter(value: string | undefined, values: string[]) {
    if (value === undefined) return null;
    if (!values.includes(value))
      throw new BadRequestException('Invalid team filter.');
    return value;
  }
  private search(value?: string): string | null {
    const normalized = value?.trim().toLowerCase() ?? '';
    const containsControlCharacter = [...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    });
    if (normalized.length > 100 || containsControlCharacter)
      throw new BadRequestException('Search must be 100 characters or fewer.');
    return normalized || null;
  }
  private memberDto(row: MemberRow) {
    return {
      id: row.membership_id,
      accountId: row.account_id,
      name: row.full_name,
      email: row.email,
      role: row.role,
      status: row.status,
      joinedAt: row.joined_at,
      revokedAt: row.revoked_at,
      version: row.membership_version,
      ...(row.total_count !== undefined
        ? { total: Number(row.total_count) }
        : {}),
    };
  }
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof ServiceUnavailableException ||
        error instanceof HttpException
      )
        throw error;
      safeDatabaseFailure(error);
    }
  }
}
