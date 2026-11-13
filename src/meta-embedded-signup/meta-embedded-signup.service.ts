import { signupConfig } from '../config/env';
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  MetaEmbeddedSignupCallbackQuery,
  MetaEmbeddedSignupCallbackResult,
  MetaEmbeddedSignupStatePayload,
  MetaPhoneNumber,
  MetaWaba,
} from './types/meta-embedded-signup.types';

@Injectable()
export class MetaEmbeddedSignupService {
  private readonly config = signupConfig();
  private readonly logger = new Logger(MetaEmbeddedSignupService.name);
  private readonly facebookBaseUrl = 'https://www.facebook.com';

  createSignupUrl(input: {
    ownerWhatsappId: string;
    businessId: string;
  }): string {
    const state = this.signState({
      ownerWhatsappId: input.ownerWhatsappId,
      businessId: input.businessId,
    });

    const extras = {
      feature: 'whatsapp_embedded_signup',
      version: 2,
      setup: {
        business_config_id: this.config.businessConfigId,
      },
    };

    const url = new URL(
      `${this.facebookBaseUrl}/${this.config.apiVersion}/dialog/oauth`,
    );

    url.searchParams.set('client_id', this.config.appId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set(
      'scope',
      'whatsapp_business_management,whatsapp_business_messaging,business_management',
    );
    url.searchParams.set('state', state);
    url.searchParams.set('extras', JSON.stringify(extras));

    return url.toString();
  }

  verifyAndDecodeState(state: string): MetaEmbeddedSignupStatePayload {
    const [encodedPayload, encodedSignature] = state.split('.');

    if (!encodedPayload || !encodedSignature) {
      throw new Error('The embedded signup state is invalid or missing.');
    }

    const expectedSignature = createHmac('sha256', this.config.appSecret)
      .update(encodedPayload)
      .digest('base64url');

    const actualSignatureBuffer = Buffer.from(encodedSignature, 'base64url');
    const expectedSignatureBuffer = Buffer.from(expectedSignature, 'base64url');

    if (
      actualSignatureBuffer.length !== expectedSignatureBuffer.length ||
      !timingSafeEqual(actualSignatureBuffer, expectedSignatureBuffer)
    ) {
      throw new Error(
        'The embedded signup state signature could not be verified.',
      );
    }

    const payloadJson = Buffer.from(encodedPayload, 'base64url').toString(
      'utf8',
    );

    try {
      const payload = JSON.parse(payloadJson) as MetaEmbeddedSignupStatePayload;

      if (!payload.ownerWhatsappId || !payload.businessId) {
        throw new Error(
          'The embedded signup state is missing required fields.',
        );
      }

      return payload;
    } catch {
      throw new Error('The embedded signup state could not be decoded.');
    }
  }

  handleCallback(
    query: MetaEmbeddedSignupCallbackQuery,
  ): MetaEmbeddedSignupCallbackResult {
    if (query.error) {
      return {
        statusCode: 400,
        html: this.buildErrorHtml(
          'Meta returned an error during WhatsApp Embedded Signup.',
        ),
      };
    }

    if (!query.code) {
      return {
        statusCode: 400,
        html: this.buildErrorHtml(
          'Meta did not return an authorization code for the WhatsApp Embedded Signup callback.',
        ),
      };
    }

    if (!query.state) {
      return {
        statusCode: 400,
        html: this.buildErrorHtml(
          'The embedded signup callback is missing its signed state.',
        ),
      };
    }

    try {
      this.verifyAndDecodeState(query.state);
      return {
        statusCode: 410,
        html: this.buildErrorHtml(
          'Connect WhatsApp through supervised merchant onboarding.',
        ),
      };
    } catch (error) {
      this.logger.warn({
        event: 'meta.signup_failed',
        status: axios.isAxiosError(error) ? error.response?.status : undefined,
      });

      return {
        statusCode: 400,
        html: this.buildErrorHtml(
          'WhatsApp Embedded Signup could not be completed.',
        ),
      };
    }
  }

  async exchangeCodeForAccessToken(code: string): Promise<string> {
    const response = await axios.get(
      `${this.config.graphBaseUrl}/${this.config.apiVersion}/oauth/access_token`,
      {
        maxRedirects: 0,
        params: {
          client_id: this.config.appId,
          client_secret: this.config.appSecret,
          redirect_uri: this.config.redirectUri,
          code,
        },
      },
    );

    return this.readAccessToken(response.data);
  }

  async getOwnedWhatsAppBusinessAccounts(
    accessToken: string,
  ): Promise<MetaWaba[]> {
    const businessesResponse = await this.fetchGraphJson(
      accessToken,
      '/me/businesses',
      {
        fields: 'id,name',
      },
    );
    const businesses = this.extractItems<{ id?: string; name?: string }>(
      businessesResponse,
    ).filter((item) => Boolean(item.id));

    if (!businesses.length) {
      throw new Error(
        'Meta did not return any businesses for the connected account.',
      );
    }

    const collectedWabas: MetaWaba[] = [];

    for (const business of businesses) {
      const wabasResponse = await this.fetchGraphJson(
        accessToken,
        `/${business.id}/owned_whatsapp_business_accounts`,
        { fields: 'id,name' },
      );

      collectedWabas.push(
        ...this.normalizeWabas(this.extractItems<unknown>(wabasResponse)),
      );
    }

    const uniqueWabas = this.uniqueById(collectedWabas);

    if (!uniqueWabas.length) {
      throw new Error(
        'No owned WhatsApp Business Account was returned by Meta.',
      );
    }

    return uniqueWabas;
  }

  async getPhoneNumbers(
    accessToken: string,
    wabaId: string,
  ): Promise<MetaPhoneNumber[]> {
    const response = await this.fetchGraphJson(
      accessToken,
      `/${wabaId}/phone_numbers`,
      {
        fields: 'id,display_phone_number,verified_name',
      },
    );
    const phoneNumbers = this.normalizePhoneNumbers(
      this.extractItems<unknown>(response),
    );

    if (!phoneNumbers.length) {
      throw new Error(
        'No phone number was returned for the selected WhatsApp Business Account.',
      );
    }

    return phoneNumbers;
  }

  private async fetchGraphJson(
    accessToken: string,
    path: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    const response = await axios.get(
      `${this.config.graphBaseUrl}/${this.config.apiVersion}${path}`,
      {
        maxRedirects: 0,
        params: {
          ...params,
          access_token: accessToken,
        },
      },
    );

    return response.data;
  }

  private signState(payload: MetaEmbeddedSignupStatePayload): string {
    const encodedPayload = Buffer.from(
      JSON.stringify(payload),
      'utf8',
    ).toString('base64url');
    const signature = createHmac('sha256', this.config.appSecret)
      .update(encodedPayload)
      .digest('base64url');

    return `${encodedPayload}.${signature}`;
  }

  private readAccessToken(payload: unknown): string {
    const accessToken = this.readString(payload, [
      'access_token',
      'accessToken',
    ]);

    if (!accessToken) {
      throw new Error('Meta did not return an access token.');
    }

    return accessToken;
  }

  private extractItems<T>(payload: unknown): T[] {
    if (Array.isArray(payload)) {
      return payload as T[];
    }

    if (this.isRecord(payload)) {
      if (Array.isArray(payload.data)) {
        return payload.data as T[];
      }

      if (Array.isArray(payload.items)) {
        return payload.items as T[];
      }

      if (Array.isArray(payload.phone_numbers)) {
        return payload.phone_numbers as T[];
      }
    }

    return [];
  }

  private normalizeWabas(items: unknown[]): MetaWaba[] {
    const normalizedWabas: Array<MetaWaba | undefined> = items.map((item) => {
      if (!this.isRecord(item)) {
        return undefined;
      }

      const id = this.readString(item, [
        'id',
        'waba_id',
        'whatsapp_business_account_id',
      ]);

      if (!id) {
        return undefined;
      }

      return {
        id,
        name: this.readString(item, ['name', 'display_name']),
      };
    });

    return normalizedWabas.filter((item): item is MetaWaba => Boolean(item));
  }

  private normalizePhoneNumbers(items: unknown[]): MetaPhoneNumber[] {
    const normalizedPhoneNumbers: Array<MetaPhoneNumber | undefined> =
      items.map((item) => {
        if (!this.isRecord(item)) {
          return undefined;
        }

        const id = this.readString(item, ['id', 'phone_number_id']);

        if (!id) {
          return undefined;
        }

        return {
          id,
          displayPhoneNumber: this.readString(item, [
            'display_phone_number',
            'displayPhoneNumber',
          ]),
          verifiedName: this.readString(item, [
            'verified_name',
            'verifiedName',
          ]),
        };
      });

    return normalizedPhoneNumbers.filter((item): item is MetaPhoneNumber =>
      Boolean(item),
    );
  }

  private uniqueById(items: MetaWaba[]): MetaWaba[] {
    const seen = new Set<string>();

    return items.filter((item) => {
      if (seen.has(item.id)) {
        return false;
      }

      seen.add(item.id);
      return true;
    });
  }

  private readString(payload: unknown, keys: string[]): string | undefined {
    if (!this.isRecord(payload)) {
      return undefined;
    }

    for (const key of keys) {
      const value = payload[key];

      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }

    return undefined;
  }

  private buildErrorHtml(title: string): string {
    const safeTitle = this.escapeHtml(title);

    return [
      '<!doctype html>',
      '<html lang="en">',
      '<head><meta charset="utf-8"><title>WhatsApp connection failed</title></head>',
      '<body>',
      `<p>${safeTitle}</p>`,
      '<p>Contact Kleva support for supervised setup.</p>',
      '</body>',
      '</html>',
    ].join('');
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }
}
