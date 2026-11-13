import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { BusinessMemberRole } from '../database/entities/business-member.entity';
import type { MerchantPrincipal } from './auth.service';
import { MerchantDatabase } from './merchant-database';

type Permission =
  | 'business.read'
  | 'business.update'
  | 'team.manage'
  | 'knowledge.manage'
  | 'inbox.operate';
const permissions: Record<BusinessMemberRole, readonly Permission[]> = {
  owner: [
    'business.read',
    'business.update',
    'team.manage',
    'knowledge.manage',
    'inbox.operate',
  ],
  editor: ['business.read', 'knowledge.manage'],
  agent: ['business.read', 'inbox.operate'],
  staff: [],
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type MerchantMembership = {
  businessId: string;
  role: BusinessMemberRole;
};

@Injectable()
export class MerchantAccess {
  constructor(private readonly database: MerchantDatabase) {}

  memberships(principal: MerchantPrincipal) {
    return this.database
      .connection()
      .query<MerchantMembership[]>(
        'SELECT * FROM public.kleva_list_memberships($1)',
        [principal.sessionDigest],
      );
  }

  withBusiness<T>(
    principal: MerchantPrincipal,
    businessId: string,
    permission: Permission,
    operation: (
      manager: EntityManager,
      membership: MerchantMembership,
    ) => Promise<T>,
  ): Promise<T> {
    if (!uuidPattern.test(businessId)) throw new NotFoundException();
    return this.database.connection().transaction(async (manager) => {
      await manager.query(
        "SELECT set_config('kleva.business_id', $1, true), set_config('kleva.session_digest', $2, true)",
        [businessId, principal.sessionDigest],
      );
      const [result] = await manager.query<
        { role: BusinessMemberRole | null }[]
      >('SELECT public.kleva_current_role() AS role');
      if (!result?.role) throw new NotFoundException();
      if (!permissions[result.role]?.includes(permission))
        throw new ForbiddenException();
      return operation(manager, { businessId, role: result.role });
    });
  }
}
