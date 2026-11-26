import { BadRequestException } from '@nestjs/common';
import { zonedMidnightToUtc } from '../assistant/business-date-range';

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
export type AnalyticsPreset = 'today' | 'yesterday' | '7d' | '30d' | '90d';
export interface AnalyticsRange {
  from: string;
  to: string;
  timezone: string;
  startUtc: Date;
  endUtc: Date;
}

function parseDate(value: string) {
  const match = datePattern.exec(value);
  if (!match) throw new BadRequestException('Use YYYY-MM-DD dates.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  )
    throw new BadRequestException('The date range contains an invalid date.');
  return { year, month, day, utc: check };
}

export function analyticsDateRange(
  from: string,
  to: string,
  timezone: string,
): AnalyticsRange {
  let fromDate: ReturnType<typeof parseDate>;
  let toDate: ReturnType<typeof parseDate>;
  try {
    fromDate = parseDate(from);
    toDate = parseDate(to);
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date());
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('Use a valid IANA timezone.');
  }
  const duration = (toDate.utc.getTime() - fromDate.utc.getTime()) / 86_400_000;
  if (duration < 0 || duration >= 90)
    throw new BadRequestException('Choose a date range of up to 90 days.');
  const next = new Date(toDate.utc.getTime() + 86_400_000);
  const startUtc = zonedMidnightToUtc(
    fromDate.year,
    fromDate.month,
    fromDate.day,
    timezone,
  );
  const endUtc = zonedMidnightToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timezone,
  );
  return { from, to, timezone, startUtc, endUtc };
}

export function analyticsDateBounds(now: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (key: string) =>
      Number(parts.find((part) => part.type === key)?.value);
    const today = new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
    return (days: number) => {
      const from = new Date(today.getTime() - (days - 1) * 86_400_000);
      const format = (date: Date) => date.toISOString().slice(0, 10);
      return analyticsDateRange(format(from), format(today), timezone);
    };
  } catch {
    throw new BadRequestException('Use a valid IANA timezone.');
  }
}

export function analyticsPresetRange(
  now: Date,
  timezone: string,
  preset: AnalyticsPreset,
) {
  const bounds = analyticsDateBounds(now, timezone);
  if (preset === 'yesterday') {
    const today = bounds(1);
    const y = new Date(today.startUtc.getTime() - 1);
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(y);
    const value = (key: string) =>
      parts.find((part) => part.type === key)?.value;
    const date = `${value('year')}-${value('month')}-${value('day')}`;
    return analyticsDateRange(date, date, timezone);
  }
  const days: Record<Exclude<AnalyticsPreset, 'yesterday'>, number> = {
    today: 1,
    '7d': 7,
    '30d': 30,
    '90d': 90,
  };
  if (preset in days) return bounds(days[preset]);
  throw new BadRequestException('Select a supported date range.');
}
