import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import { metaConfig } from '../../config/env';

interface DebugData {
  app_id?: string;
  is_valid?: boolean;
  expires_at?: number;
  data_access_expires_at?: number;
  scopes?: string[];
  granular_scopes?: { scope: string; target_ids?: string[] }[];
}

export interface VerifiedWhatsAppAsset {
  displayName: string | null;
  expiresAt: string | null;
}

@Injectable()
export class MetaWhatsAppVerifier {
  private readonly config = metaConfig();
  private readonly appId = process.env.META_APP_ID?.trim();

  async verify(
    token: string,
    wabaId: string,
    phoneId: string,
  ): Promise<VerifiedWhatsAppAsset> {
    const { appSecret, graphBaseUrl } = this.config;
    const appId = this.appId;
    if (
      !appId ||
      !appSecret ||
      (graphBaseUrl !== 'https://graph.facebook.com' &&
        process.env.NODE_ENV !== 'test')
    ) {
      throw new ServiceUnavailableException(
        'Meta verification is unavailable.',
      );
    }
    try {
      const result = await this.get<{ data?: DebugData }>(
        '/debug_token',
        appId + '|' + appSecret,
        { input_token: token },
      );
      const debug = result.data;
      const now = Date.now() / 1000;
      const deadlines = [debug?.expires_at, debug?.data_access_expires_at];
      const scopes = [
        'whatsapp_business_management',
        'whatsapp_business_messaging',
      ];
      if (
        debug?.is_valid !== true ||
        debug.app_id !== appId ||
        deadlines.some(
          (value) =>
            value !== undefined &&
            (!Number.isSafeInteger(value) || (value !== 0 && value <= now)),
        ) ||
        !scopes.every(
          (scope) =>
            debug.scopes?.includes(scope) &&
            !debug.granular_scopes?.some(
              (entry) =>
                entry.scope === scope &&
                entry.target_ids !== undefined &&
                !entry.target_ids.includes(wabaId),
            ),
        )
      )
        throw new BadRequestException(
          'Meta did not verify the credential and permissions.',
        );

      const [phones, subscriptions] = await Promise.all([
        this.get<{ data?: { id: string; verified_name?: string }[] }>(
          '/' + wabaId + '/phone_numbers',
          token,
          { fields: 'id,verified_name', limit: '100' },
        ),
        this.get<{ data?: { whatsapp_business_api_data?: { id: string } }[] }>(
          '/' + wabaId + '/subscribed_apps',
          token,
          { limit: '100' },
        ),
      ]);
      const phone = phones.data?.find(({ id }) => id === phoneId);
      if (
        !phone ||
        !subscriptions.data?.some(
          (app) => app.whatsapp_business_api_data?.id === appId,
        )
      ) {
        throw new BadRequestException(
          'Meta did not verify the selected phone and app subscription.',
        );
      }
      const expiry = Math.min(
        ...deadlines.filter((value): value is number => Boolean(value)),
      );
      return {
        displayName:
          typeof phone.verified_name === 'string'
            ? phone.verified_name.replace(/\0/g, '').slice(0, 255)
            : null,
        expiresAt: Number.isFinite(expiry)
          ? new Date(expiry * 1000).toISOString()
          : null,
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      if (
        status === 400 ||
        status === 401 ||
        status === 403 ||
        status === 404
      ) {
        throw new BadRequestException(
          'Meta rejected credential or asset verification.',
        );
      }
      throw new ServiceUnavailableException(
        'Meta verification could not be completed.',
      );
    }
  }

  private async get<T>(
    path: string,
    token: string,
    params: Record<string, string>,
  ) {
    const response = await axios.get<T>(
      this.config.graphBaseUrl + '/' + this.config.apiVersion + path,
      {
        params,
        headers: { Authorization: 'Bearer ' + token },
        maxRedirects: 0,
        timeout: 5000,
        maxContentLength: 256 * 1024,
      },
    );
    return response.data;
  }
}
