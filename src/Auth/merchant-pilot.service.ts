import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { aiResponsesEnabled } from '../config/env';
import { UsageService } from '../metering/usage.service';
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
  constructor(
    private readonly access: MerchantAccess,
    private readonly usage: UsageService,
  ) {}

  status(actor: MerchantPrincipal, businessId: string) {
    return this.access
      .withBusiness(actor, businessId, 'business.read', async (manager) => {
        const [row] = await manager.query<PilotStatus[]>(
          'SELECT * FROM public.kleva_pilot_status()',
        );
        const [readiness] = await manager.query<
          {
            business_active: boolean;
            connection_id: string | null;
            whatsapp_verified: boolean;
            published_knowledge: boolean;
            assistant_configured: boolean;
            pilot_approved: boolean;
            approval_matches_connection: boolean;
            human_takeover_count: number | string;
          }[]
        >('SELECT * FROM public.kleva_pilot_readiness()');
        return {
          ...(row ?? { enrollment_id: null, status: 'NOT_ENROLLED' }),
          connection_id: readiness?.connection_id ?? null,
          human_takeover_count: Number(readiness?.human_takeover_count ?? 0),
          prerequisites: {
            businessActive: readiness?.business_active === true,
            whatsappConnectedAndVerified: readiness?.whatsapp_verified === true,
            publishedKnowledge: readiness?.published_knowledge === true,
            assistantConfigured: readiness?.assistant_configured === true,
            pilotApproved: readiness?.pilot_approved === true,
            approvalMatchesConnection:
              readiness?.approval_matches_connection === true,
            aiResponsesEnabled: aiResponsesEnabled(),
            usageQuotaReady: false,
          },
        };
      })
      .then(async (result) => {
        const usage = await this.usage.getUsageSummary(businessId);
        const aiRequestAllowance =
          await this.usage.hasAiRequestAllowance(businessId);
        const usageQuotaReady =
          aiRequestAllowance &&
          usage.categories.ai_input_tokens.remaining > 0 &&
          usage.categories.ai_output_tokens.remaining > 0 &&
          usage.categories.whatsapp_outbound.remaining > 0;
        const prerequisites = {
          ...result.prerequisites,
          usageQuotaReady,
        };
        const activationReady =
          prerequisites.businessActive &&
          prerequisites.whatsappConnectedAndVerified &&
          prerequisites.publishedKnowledge &&
          prerequisites.assistantConfigured &&
          prerequisites.aiResponsesEnabled &&
          prerequisites.usageQuotaReady;
        const assistantReady =
          activationReady &&
          prerequisites.pilotApproved &&
          prerequisites.approvalMatchesConnection;
        const approvalMismatch =
          prerequisites.pilotApproved &&
          !prerequisites.approvalMatchesConnection;
        const automationStatus = assistantReady
          ? 'ACTIVE'
          : approvalMismatch
            ? 'OFF'
            : result.status === 'PENDING_REVIEW'
              ? 'PENDING_APPROVAL'
              : activationReady
                ? 'READY'
                : 'OFF';
        return {
          ...result,
          prerequisites,
          activation_ready: activationReady,
          assistant_ready: assistantReady,
          automation_status: automationStatus,
        };
      });
  }

  async enroll(actor: MerchantPrincipal, businessId: string, body: unknown) {
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
    const readiness = await this.status(actor, businessId);
    if (!readiness.activation_ready)
      throw new BadRequestException(
        'Complete all AI activation requirements before requesting pilot approval.',
      );
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
