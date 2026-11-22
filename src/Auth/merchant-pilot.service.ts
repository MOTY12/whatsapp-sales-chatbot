import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { aiConfig } from '../config/env';
import type { MerchantPrincipal } from './auth.service';
import { MerchantAccess } from './merchant-access.service';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type PilotStatus = {
  enrollment_id: string;
  status: string;
  connection_id: string;
  consent_version: string;
  consented_at: Date | string;
  activated_at: Date | string | null;
  revoked_at: Date | string | null;
};
type PilotEnrollment = {
  enrollment_id: string;
  status: string;
  created_at: Date | string;
};

@Injectable()
export class MerchantPilotService {
  constructor(private readonly access: MerchantAccess) {}

  status(actor: MerchantPrincipal, businessId: string) {
    return this.access.withBusiness(
      actor,
      businessId,
      'business.read',
      async (manager) => {
        const [row] = await manager.query<PilotStatus[]>(
          'SELECT * FROM public.kleva_pilot_status()',
        );
        const [connection] = await manager.query<
          { id: string; status: string }[]
        >('SELECT id, status FROM public.kleva_whatsapp_status()');
        return {
          ...(row ?? { enrollment_id: null, status: 'NOT_ENROLLED' }),
          assistant_ready:
            row?.status === 'ACTIVE' &&
            connection?.status === 'active' &&
            connection.id === row.connection_id &&
            aiConfig().enabled,
        };
      },
    );
  }

  enroll(actor: MerchantPrincipal, businessId: string, body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid pilot enrollment.');
    }
    const input = body as Record<string, unknown>;
    if (
      Object.keys(input).some(
        (key) =>
          ![
            'connectionId',
            'consentVersion',
            'aiProviderDisclosureAccepted',
            'humanEscalationAccepted',
          ].includes(key),
      ) ||
      typeof input.connectionId !== 'string' ||
      !uuid.test(input.connectionId) ||
      input.consentVersion !== 'pilot-merchant-v1' ||
      input.aiProviderDisclosureAccepted !== true ||
      input.humanEscalationAccepted !== true
    ) {
      throw new BadRequestException(
        'Complete all required pilot acknowledgments.',
      );
    }
    return this.access.withBusiness(
      actor,
      businessId,
      'business.update',
      async (manager) => {
        const [row] = await manager.query<PilotEnrollment[]>(
          'SELECT * FROM public.kleva_pilot_enroll($1,$2,$3,$4)',
          [input.connectionId, input.consentVersion, true, true],
        );
        return row;
      },
    );
  }

  revoke(actor: MerchantPrincipal, businessId: string, enrollmentId: string) {
    if (!uuid.test(enrollmentId)) throw new NotFoundException();
    return this.access.withBusiness(
      actor,
      businessId,
      'business.update',
      async (manager) => {
        const [row] = await manager.query<{ revoked: boolean }[]>(
          'SELECT public.kleva_pilot_revoke($1) AS revoked',
          [enrollmentId],
        );
        if (!row?.revoked) throw new NotFoundException();
        return { revoked: true };
      },
    );
  }
}
