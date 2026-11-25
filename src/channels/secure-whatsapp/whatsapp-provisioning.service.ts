import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { CredentialCipher, type CredentialEnvelope } from './credential-cipher';
import { MetaWhatsAppVerifier } from './meta-verifier';
import { PermanentJobFailure } from '../../jobs/outbox.store';
import type { OutboxOperation } from '../../database/entities/outbox-operation.entity';
import { errorCode } from '../../config/logging';

type PendingConnection = {
  business_id: string;
  connection_id: string;
  waba_id: string;
  phone_number_id: string;
  credential_envelope: CredentialEnvelope;
  registration_pin_envelope: CredentialEnvelope;
  expires_at: string | null;
  expected_revision: number | null;
  reconnect: boolean;
  processing_stage: string;
};

const idPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class WhatsAppProvisioningService {
  private readonly logger = new Logger(WhatsAppProvisioningService.name);

  constructor(
    @InjectDataSource() private readonly database: DataSource,
    private readonly cipher: CredentialCipher,
    private readonly meta: MetaWhatsAppVerifier,
  ) {}

  async execute(operation: Readonly<OutboxOperation>): Promise<void> {
    const attemptId = operation.metadata?.attemptId;
    if (
      operation.operation !== 'whatsapp.connection.provision' ||
      !operation.businessId ||
      !idPattern.test(attemptId ?? '') ||
      !operation.leaseToken
    ) {
      throw new PermanentJobFailure('Invalid provisioning operation.');
    }

    let stage = 'ASSET_VERIFICATION_FAILED';
    try {
      const [pending] = await this.database.query<PendingConnection[]>(
        'SELECT * FROM public.kleva_whatsapp_provision_read($1,$2,$3)',
        [attemptId, operation.id, operation.leaseToken],
      );
      if (!pending || pending.business_id !== operation.businessId) {
        throw new PermanentJobFailure('Provisioning lease is stale.');
      }
      const token = await this.cipher.decrypt(
        pending.credential_envelope,
        pending.business_id,
        pending.connection_id,
      );
      const pin = await this.cipher.decrypt(
        pending.registration_pin_envelope,
        pending.business_id,
        pending.connection_id,
      );

      // This read-only check proves the token, application, scopes and exact
      // selected WABA/phone relationship before any provider mutation.
      await this.meta.verifyAuthorizedAssets(
        token,
        pending.waba_id,
        pending.phone_number_id,
      );
      await this.checkpoint(attemptId, operation, 'VERIFYING_ASSETS');

      if (
        pending.processing_stage === 'CREDENTIAL_STAGED' ||
        pending.processing_stage === 'VERIFYING_ASSETS' ||
        pending.processing_stage === 'SUBSCRIBING_WEBHOOKS'
      ) {
        stage = 'WEBHOOK_SUBSCRIPTION_FAILED';
        await this.checkpoint(attemptId, operation, 'SUBSCRIBING_WEBHOOKS');
        await this.meta.subscribeToWebhooks(token, pending.waba_id);
        await this.checkpoint(attemptId, operation, 'REGISTERING_PHONE');
      }

      // This Embedded Signup configuration is for standard Cloud API numbers,
      // for which Graph's /register endpoint requires the merchant's two-step
      // verification PIN. The PIN exists only encrypted and in worker memory.
      const currentStage = await this.database.query<
        { processing_stage: string }[]
      >(
        `SELECT processing_stage FROM public.whatsapp_signup_attempts WHERE id=$1 AND operation_id=$2`,
        [attemptId, operation.id],
      );
      if (currentStage[0]?.processing_stage === 'REGISTERING_PHONE') {
        stage = 'PHONE_REGISTRATION_FAILED';
        await this.meta.registerPhoneNumber(
          token,
          pending.phone_number_id,
          pin,
        );
        await this.checkpoint(attemptId, operation, 'VERIFYING_READINESS');
      }

      stage = 'ASSET_VERIFICATION_FAILED';
      const verified = await this.meta.verify(
        token,
        pending.waba_id,
        pending.phone_number_id,
      );
      if (!verified.displayPhoneNumber)
        throw new PermanentJobFailure('Meta did not verify a display number.');
      const expiries = [pending.expires_at, verified.expiresAt]
        .filter((item): item is string => Boolean(item))
        .map((item) => Date.parse(item));
      const expiry = expiries.length
        ? new Date(Math.min(...expiries)).toISOString()
        : null;
      stage = 'CONNECTION_PERSIST_FAILED';
      const [activated] = await this.database.query<{ ok: boolean }[]>(
        'SELECT public.kleva_whatsapp_provision_finish($1,$2,$3,$4,$5,$6) AS ok',
        [
          attemptId,
          operation.id,
          operation.leaseToken,
          verified.displayName,
          verified.displayPhoneNumber,
          expiry,
        ],
      );
      if (!activated?.ok)
        throw new PermanentJobFailure(
          'Connection activation was fenced or conflicted.',
        );
    } catch (error) {
      const safeCategory = stage;
      const permanent =
        error instanceof PermanentJobFailure ||
        error instanceof BadRequestException;
      this.logger.warn({
        event: 'whatsapp.connection.provision_failed',
        category: safeCategory,
        postgresCode: errorCode(error) ?? undefined,
      });
      if (operation.attempts >= 5 || permanent) {
        await this.database
          .query('SELECT public.kleva_whatsapp_provision_fail($1,$2,$3,$4)', [
            attemptId,
            operation.id,
            operation.leaseToken,
            safeCategory,
          ])
          .catch(() => undefined);
        throw new PermanentJobFailure('WhatsApp provisioning failed safely.');
      }
      throw error;
    }
  }

  private async checkpoint(
    attempt: string,
    operation: Readonly<OutboxOperation>,
    stage: string,
  ) {
    const [result] = await this.database.query<{ ok: boolean }[]>(
      'SELECT public.kleva_whatsapp_provision_checkpoint($1,$2,$3,$4) AS ok',
      [attempt, operation.id, operation.leaseToken, stage],
    );
    if (!result?.ok)
      throw new PermanentJobFailure('Provisioning lease is stale.');
  }
}
