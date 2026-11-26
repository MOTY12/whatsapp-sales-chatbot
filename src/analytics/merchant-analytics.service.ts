import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import type { MerchantPrincipal } from '../Auth/auth.service';
import { MerchantAccess } from '../Auth/merchant-access.service';
import { usageConfig } from '../config/env';
import {
  analyticsDateRange,
  analyticsPresetRange,
  type AnalyticsRange,
  type AnalyticsPreset,
} from './analytics-date-range';

export type AnalyticsChannel = 'ALL' | 'WHATSAPP' | 'WEBSITE';
type AnalyticsSqlReport = Record<string, unknown> & {
  range: { from: string; to: string; toExclusive: string; timezone: string };
  usageLimits?: {
    monthly_whatsapp_messages: number | null;
    monthly_ai_input_tokens: number | null;
    monthly_ai_output_tokens: number | null;
    monthly_embedding_tokens: number | null;
  } | null;
  quotaCounted?: Record<string, number | string>;
  engagement: Record<string, unknown> & {
    trend: Array<{ date: string; conversations: number | string }>;
  };
};

@Injectable()
export class MerchantAnalyticsService {
  private readonly logger = new Logger(MerchantAnalyticsService.name);
  constructor(private readonly access: MerchantAccess) {}

  async report(
    principal: MerchantPrincipal,
    businessId: string,
    options: {
      from?: string;
      to?: string;
      timezone?: string;
      channel?: string;
      preset?: string;
    },
  ) {
    const channel = (options.channel ?? 'ALL').toUpperCase();
    if (!['ALL', 'WHATSAPP', 'WEBSITE'].includes(channel))
      throw new BadRequestException('Select a supported channel.');
    return this.access.withBusiness(
      principal,
      businessId,
      'analytics.read',
      async (manager) => {
        const [business] = await manager.query<{ timezone: string }[]>(
          'SELECT timezone FROM public.kleva_read_merchant_profile()',
        );
        const timezone = options.timezone ?? business?.timezone ?? 'UTC';
        let range: AnalyticsRange;
        try {
          if (options.from || options.to) {
            if (!options.from || !options.to)
              throw new BadRequestException('Provide both from and to dates.');
            range = analyticsDateRange(options.from, options.to, timezone);
          } else {
            const preset = (options.preset ?? '30d') as AnalyticsPreset;
            range = analyticsPresetRange(new Date(), timezone, preset);
          }
        } catch (error) {
          this.logger.warn({
            event: 'merchant_analytics.request_rejected',
            category: 'INVALID_DATE_RANGE_OR_TIMEZONE',
          });
          throw error;
        }
        const started = performance.now();
        try {
          await manager.query("SET LOCAL statement_timeout = '5000ms'");
          const [row] = await manager.query<{ report: AnalyticsSqlReport }[]>(
            `SELECT public.kleva_merchant_analytics($1,$2,$3,$4) AS report`,
            [range.startUtc, range.endUtc, channel, timezone],
          );
          this.logger.log({
            event: 'merchant_analytics.query_completed',
            durationMs: Math.round(performance.now() - started),
            channel,
            rangeDays: Math.ceil(
              (range.endUtc.getTime() - range.startUtc.getTime()) / 86_400_000,
            ),
          });
          const report = row.report;
          report.generatedAt = new Date().toISOString();
          report.range = {
            from: range.from,
            to: range.to,
            toExclusive: range.endUtc.toISOString(),
            timezone,
          };
          const defaults = usageConfig();
          const overrides = report.usageLimits;
          const counted = report.quotaCounted ?? {};
          const embeddingCounted =
            Number(counted.knowledge_embedding_tokens ?? 0) +
            Number(counted.live_embedding_tokens ?? 0) +
            Number(counted.playground_embedding_tokens ?? 0);
          const allowance = (limit: number | null, used: number) => ({
            limit,
            quotaCounted: used,
            remaining: limit === null ? null : Math.max(0, limit - used),
          });
          report.monthlyAllowances = {
            whatsappOutbound: allowance(
              overrides?.monthly_whatsapp_messages ??
                defaults.monthlyWhatsAppMessages,
              Number(counted.whatsapp_outbound ?? 0),
            ),
            aiInputTokens: allowance(
              overrides?.monthly_ai_input_tokens ??
                defaults.monthlyAiInputTokens,
              Number(counted.ai_input_tokens ?? 0),
            ),
            aiOutputTokens: allowance(
              overrides?.monthly_ai_output_tokens ??
                defaults.monthlyAiOutputTokens,
              Number(counted.ai_output_tokens ?? 0),
            ),
            embeddings: allowance(
              overrides?.monthly_embedding_tokens ??
                defaults.monthlyEmbeddingTokens,
              embeddingCounted,
            ),
          };
          const days = report.engagement.trend;
          if (
            (range.endUtc.getTime() - range.startUtc.getTime()) / 86_400_000 >
            30
          ) {
            const weeks = new Map<string, number>();
            for (const item of days) {
              const date = new Date(`${item.date}T00:00:00Z`);
              const mondayOffset = (date.getUTCDay() + 6) % 7;
              date.setUTCDate(date.getUTCDate() - mondayOffset);
              const week = date.toISOString().slice(0, 10);
              weeks.set(
                week,
                (weeks.get(week) ?? 0) + Number(item.conversations),
              );
            }
            report.engagement.trend = [...weeks.entries()].map(
              ([date, conversations]) => ({ date, conversations }),
            );
            report.trendGrouping = 'weekly';
          } else {
            report.trendGrouping = 'daily';
          }
          delete report.usageLimits;
          delete report.quotaCounted;
          return report;
        } catch (error) {
          const caught: unknown = error;
          const outerRecord =
            typeof caught === 'object' && caught !== null
              ? (caught as Record<string, unknown>)
              : undefined;
          const driverError = outerRecord?.driverError ?? caught;
          const driverRecord =
            typeof driverError === 'object' && driverError !== null
              ? (driverError as Record<string, unknown>)
              : undefined;
          const code =
            typeof driverRecord?.code === 'string'
              ? driverRecord.code
              : undefined;
          this.logger.error({
            event: 'merchant_analytics.query_failed',
            durationMs: Math.round(performance.now() - started),
            category:
              code === '57014' ? 'QUERY_TIMEOUT' : 'DATABASE_QUERY_FAILED',
            ...(code ? { databaseErrorCode: code } : {}),
          });
          throw error;
        }
      },
    );
  }
}
