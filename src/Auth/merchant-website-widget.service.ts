import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { UsageService } from '../metering/usage.service';
import { websiteWidgetConfig } from '../config/env';
import {
  isWebsiteAiAvailable,
  normalizeWebsiteOrigin,
  normalizeWebsiteWidgetConfiguration,
} from '../website-chat/website-chat.service';
import { MerchantAccess } from './merchant-access.service';
import type { MerchantPrincipal } from './auth.service';

@Injectable()
export class MerchantWebsiteWidgetService {
  constructor(
    private readonly access: MerchantAccess,
    private readonly usage: UsageService,
  ) {}

  list(actor: MerchantPrincipal, businessId: string) {
    return this.access.withBusiness(
      actor,
      businessId,
      'website.manage',
      async (manager) => {
        const rows = await manager.query<Array<Record<string, unknown>>>(
          'SELECT * FROM public.kleva_website_widget_list()',
        );
        return rows.map((row) => {
          const publicId =
            typeof row.public_id === 'string' ? row.public_id : '';
          return {
            id: row.id,
            publicId,
            name: row.name,
            enabled: row.enabled,
            aiEnabled: row.ai_enabled,
            configuration: normalizeWebsiteWidgetConfiguration(
              row.configuration,
            ),
            domains: row.domains,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            connectionStatus: row.connection_status,
            installScript: `<script async src="${websiteWidgetConfig().publicOrigin}/public/widget.js" data-widget-id="${publicId}"></script>`,
            aiAvailable: isWebsiteAiAvailable(),
          };
        });
      },
    );
  }

  create(actor: MerchantPrincipal, businessId: string, body: unknown) {
    const name = this.nameInput(body);
    const publicId = randomBytes(24).toString('base64url');
    return this.access.withBusiness(
      actor,
      businessId,
      'website.manage',
      async (manager) => {
        const [row] = await manager.query<
          Array<{ id: string; public_id: string }>
        >('SELECT * FROM public.kleva_website_widget_create($1,$2)', [
          publicId,
          name,
        ]);
        if (!row) throw new NotFoundException();
        return { id: row.id, publicId: row.public_id };
      },
    );
  }

  domains(
    actor: MerchantPrincipal,
    businessId: string,
    widgetId: string,
    body: unknown,
  ) {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !Array.isArray((body as { origins?: unknown }).origins)
    )
      throw new BadRequestException('Provide a list of website origins.');
    const origins = (body as { origins: unknown[] }).origins;
    if (
      origins.length > 10 ||
      origins.some(
        (origin) => typeof origin !== 'string' || origin.length > 300,
      )
    )
      throw new BadRequestException('Provide up to ten valid website origins.');
    let normalizedOrigins: string[];
    try {
      normalizedOrigins = [
        ...new Set(
          origins.map((origin) => normalizeWebsiteOrigin(origin as string)),
        ),
      ];
    } catch {
      throw new BadRequestException(
        'Website origins must be valid HTTPS origins (localhost HTTP is development-only).',
      );
    }
    return this.access.withBusiness(
      actor,
      businessId,
      'website.manage',
      async (manager) => {
        const [row] = await manager.query<Array<{ origin_count: number }>>(
          'SELECT * FROM public.kleva_website_widget_domains_set($1,$2)',
          [widgetId, normalizedOrigins],
        );
        if (!row) throw new NotFoundException();
        return { count: row.origin_count };
      },
    );
  }

  async update(
    actor: MerchantPrincipal,
    businessId: string,
    widgetId: string,
    body: unknown,
  ) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('Provide widget settings.');
    const input = body as Record<string, unknown>;
    if (
      Object.keys(input).some(
        (key) =>
          !['name', 'enabled', 'aiEnabled', 'configuration'].includes(key),
      ) ||
      typeof input.enabled !== 'boolean' ||
      typeof input.aiEnabled !== 'boolean'
    )
      throw new BadRequestException('Widget settings are invalid.');
    const name = this.nameInput(input.name);
    const configuration = normalizeWebsiteWidgetConfiguration(
      input.configuration,
    );
    if (input.aiEnabled && !isWebsiteAiAvailable())
      throw new BadRequestException(
        'AI responses are not available in this environment.',
      );
    return this.access.withBusiness(
      actor,
      businessId,
      'website.manage',
      async (manager) => {
        if (input.aiEnabled) {
          const [usage, requestAllowance] = await Promise.all([
            this.usage.getUsageSummary(businessId),
            this.usage.hasAiRequestAllowance(businessId),
          ]);
          if (
            !requestAllowance ||
            usage.categories.ai_input_tokens.remaining <= 0 ||
            usage.categories.ai_output_tokens.remaining <= 0
          )
            throw new BadRequestException(
              'AI usage allowance is unavailable for this business.',
            );
        }
        const [row] = await manager.query<
          Array<{
            id: string;
            enabled: boolean;
            ai_enabled: boolean;
            updated_at: Date;
          }>
        >('SELECT * FROM public.kleva_website_widget_update($1,$2,$3,$4,$5)', [
          widgetId,
          name,
          input.enabled,
          input.aiEnabled,
          JSON.stringify(configuration),
        ]);
        if (!row) throw new NotFoundException();
        return {
          ...row,
          aiEnabled: row.ai_enabled,
          updatedAt: row.updated_at,
          aiAvailable: isWebsiteAiAvailable(),
        };
      },
    );
  }

  rotate(actor: MerchantPrincipal, businessId: string, widgetId: string) {
    const publicId = randomBytes(24).toString('base64url');
    return this.access.withBusiness(
      actor,
      businessId,
      'website.manage',
      async (manager) => {
        const [row] = await manager.query<Array<{ public_id: string }>>(
          'SELECT * FROM public.kleva_website_widget_rotate($1,$2)',
          [widgetId, publicId],
        );
        if (!row) throw new NotFoundException();
        return { publicId: row.public_id };
      },
    );
  }

  private nameInput(value: unknown) {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.trim().length > 80 ||
      value.includes('\0')
    )
      throw new BadRequestException('Widget name must be 1 to 80 characters.');
    return value.trim();
  }
}
