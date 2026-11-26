import { BadRequestException } from '@nestjs/common';
import {
  analyticsDateRange,
  analyticsPresetRange,
} from './analytics-date-range';

describe('analyticsDateRange', () => {
  it('uses half-open local dates for Africa/Lagos', () => {
    const range = analyticsDateRange(
      '2026-01-31',
      '2026-02-01',
      'Africa/Lagos',
    );
    expect(range.endUtc.getTime() - range.startUtc.getTime()).toBe(
      48 * 60 * 60 * 1000,
    );
    expect(range.startUtc.toISOString()).toBe('2026-01-30T23:00:00.000Z');
    expect(range.endUtc.toISOString()).toBe('2026-02-01T23:00:00.000Z');
  });

  it('handles UTC midnight, leap days and the year boundary', () => {
    const range = analyticsDateRange('2024-12-31', '2025-01-01', 'UTC');
    expect(range.startUtc.toISOString()).toBe('2024-12-31T00:00:00.000Z');
    expect(range.endUtc.toISOString()).toBe('2025-01-02T00:00:00.000Z');
    expect(analyticsDateRange('2024-02-29', '2024-02-29', 'UTC').from).toBe(
      '2024-02-29',
    );
  });

  it('respects daylight saving short and long days', () => {
    const spring = analyticsDateRange(
      '2026-03-08',
      '2026-03-08',
      'America/New_York',
    );
    const fall = analyticsDateRange(
      '2026-11-01',
      '2026-11-01',
      'America/New_York',
    );
    expect(spring.endUtc.getTime() - spring.startUtc.getTime()).toBe(
      23 * 60 * 60 * 1000,
    );
    expect(fall.endUtc.getTime() - fall.startUtc.getTime()).toBe(
      25 * 60 * 60 * 1000,
    );
  });

  it('rejects malformed dates, timezones and ranges beyond 90 days', () => {
    expect(() => analyticsDateRange('2026-02-30', '2026-03-01', 'UTC')).toThrow(
      BadRequestException,
    );
    expect(() =>
      analyticsDateRange('2026-01-01', '2026-01-02', 'Not/AZone'),
    ).toThrow(BadRequestException);
    expect(() => analyticsDateRange('2026-01-01', '2026-04-01', 'UTC')).toThrow(
      BadRequestException,
    );
    expect(() => analyticsDateRange('2026-02-01', '2026-01-31', 'UTC')).toThrow(
      BadRequestException,
    );
  });

  it('returns a business-local previous calendar day', () => {
    const range = analyticsPresetRange(
      new Date('2026-03-08T16:00:00.000Z'),
      'America/Los_Angeles',
      'yesterday',
    );
    expect(range.from).toBe('2026-03-07');
    expect(range.to).toBe('2026-03-07');
  });
});
