import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import { metaConfig, whatsappSignupRuntimeConfig } from '../../config/env';

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
  displayPhoneNumber: string | null;
  expiresAt: string | null;
}

export interface EmbeddedSignupSettings {
  appId: string;
  configId: string;
  apiVersion: string;
}

export interface ExchangedBusinessToken {
  accessToken: string;
  expiresAt: string | null;
}

@Injectable()
export class MetaWhatsAppVerifier {
  private readonly config = metaConfig();
  private readonly signupConfig = whatsappSignupRuntimeConfig();
  private readonly appId = process.env.META_APP_ID?.trim();
  private readonly appSecret = process.env.META_APP_SECRET?.trim();
  private readonly configId = process.env.WHATSAPP_BUSINESS_CONFIG_ID?.trim();

  embeddedSignupSettings(): EmbeddedSignupSettings {
    if (
      !this.appId ||
      !this.appSecret ||
      !this.configId ||
      /^replace_me$|^your[_-]/i.test(this.appId) ||
      /^replace_me$|^your[_-]/i.test(this.appSecret) ||
      /^replace_me$|^your[_-]/i.test(this.configId)
    ) {
      throw new ServiceUnavailableException(
        'WhatsApp self-service connection is not configured.',
      );
    }
    return {
      appId: this.appId,
      configId: this.configId,
      apiVersion: this.config.apiVersion,
    };
  }

  async exchangeCode(code: string): Promise<ExchangedBusinessToken> {
    if (!this.appId || !this.appSecret) {
      throw new ServiceUnavailableException(
        'Meta authorization is not configured.',
      );
    }
    try {
      const response = await axios.get<{
        access_token?: unknown;
        expires_in?: unknown;
      }>(
        `${this.config.graphBaseUrl}/${this.config.apiVersion}/oauth/access_token`,
        {
          params: {
            client_id: this.appId,
            client_secret: this.appSecret,
            code,
          },
          maxRedirects: 0,
          timeout: this.signupConfig.codeExchangeTimeoutMs,
          maxContentLength: 64 * 1024,
        },
      );
      const accessToken = response.data?.access_token;
      const expiresIn = response.data?.expires_in;
      if (
        typeof accessToken !== 'string' ||
        !/^[A-Za-z0-9._|-]{1,4096}$/.test(accessToken) ||
        (expiresIn !== undefined &&
          (!Number.isSafeInteger(expiresIn) || Number(expiresIn) <= 0))
      ) {
        throw new BadRequestException(
          'Meta returned an invalid authorization response.',
        );
      }
      return {
        accessToken,
        expiresAt:
          typeof expiresIn === 'number'
            ? new Date(Date.now() + expiresIn * 1000).toISOString()
            : null,
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      if (status === 400 || status === 401 || status === 403) {
        throw new BadRequestException(
          'Meta could not exchange this signup code. Start a new connection attempt.',
        );
      }
      throw new ServiceUnavailableException(
        'Meta authorization could not be completed. Please try again.',
      );
    }
  }

  async subscribeToWebhooks(
    accessToken: string,
    wabaId: string,
  ): Promise<void> {
    try {
      const response = await axios.post<{ success?: boolean }>(
        `${this.config.graphBaseUrl}/${this.config.apiVersion}/${wabaId}/subscribed_apps`,
        undefined,
        {
          headers: { Authorization: 'Bearer ' + accessToken },
          maxRedirects: 0,
          timeout: 5000,
          maxContentLength: 64 * 1024,
        },
      );
      if (response.data?.success !== true)
        throw new BadRequestException(
          'Meta did not confirm the webhook subscription.',
        );
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      if (status === 400 || status === 401 || status === 403 || status === 404)
        throw new BadRequestException(
          'Meta rejected webhook access for this WhatsApp account.',
        );
      throw new ServiceUnavailableException(
        'Meta webhook subscription could not be completed.',
      );
    }
  }

  async registerPhoneNumber(
    accessToken: string,
    phoneNumberId: string,
    registrationPin: string,
  ): Promise<void> {
    try {
      const response = await axios.post<{ success?: boolean }>(
        `${this.config.graphBaseUrl}/${this.config.apiVersion}/${phoneNumberId}/register`,
        { messaging_product: 'whatsapp', pin: registrationPin },
        {
          headers: { Authorization: 'Bearer ' + accessToken },
          maxRedirects: 0,
          timeout: 5000,
          maxContentLength: 64 * 1024,
        },
      );
      if (response.data?.success !== true)
        throw new BadRequestException(
          'Meta did not confirm phone-number registration.',
        );
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      if (status === 400 || status === 401 || status === 403 || status === 404)
        throw new BadRequestException(
          'Meta could not register this phone number. Check its eligibility and two-step verification PIN.',
        );
      throw new ServiceUnavailableException(
        'Meta phone-number registration could not be completed.',
      );
    }
  }

  async verify(
    token: string,
    wabaId: string,
    phoneId: string,
  ): Promise<VerifiedWhatsAppAsset> {
    return this.verifyAssets(token, wabaId, phoneId, true);
  }

  /** Read-only authorization check used before subscription or registration calls. */
  async verifyAuthorizedAssets(
    token: string,
    wabaId: string,
    phoneId: string,
  ): Promise<VerifiedWhatsAppAsset> {
    return this.verifyAssets(token, wabaId, phoneId, false);
  }

  private async verifyAssets(
    token: string,
    wabaId: string,
    phoneId: string,
    requireSubscription: boolean,
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
        this.get<{
          data?: {
            id: string;
            verified_name?: string;
            display_phone_number?: string;
          }[];
        }>('/' + wabaId + '/phone_numbers', token, {
          fields: 'id,verified_name,display_phone_number',
          limit: '100',
        }),
        requireSubscription
          ? this.get<{
              data?: { whatsapp_business_api_data?: { id: string } }[];
            }>('/' + wabaId + '/subscribed_apps', token, { limit: '100' })
          : Promise.resolve({ data: [] }),
      ]);
      const phone = phones.data?.find(({ id }) => id === phoneId);
      if (
        !phone ||
        (requireSubscription &&
          !subscriptions.data?.some(
            (app) => app.whatsapp_business_api_data?.id === appId,
          ))
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
        displayPhoneNumber:
          typeof phone.display_phone_number === 'string'
            ? phone.display_phone_number.replace(/\0/g, '').slice(0, 64)
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
