import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  isWebsiteOriginAllowed,
  isWebsiteBusinessOpen,
  normalizeWebsiteOrigin,
  normalizeWebsiteWidgetConfiguration,
} from './website-chat.service';

describe('website widget validation', () => {
  it('canonicalizes exact HTTPS origins and permits local HTTP only in development', () => {
    expect(normalizeWebsiteOrigin('https://SHOP.example:443/')).toBe(
      'https://shop.example',
    );
    expect(normalizeWebsiteOrigin('http://localhost:4173', false)).toBe(
      'http://localhost:4173',
    );
    expect(() => normalizeWebsiteOrigin('http://shop.example', true)).toThrow(
      ForbiddenException,
    );
    expect(() =>
      normalizeWebsiteOrigin('https://shop.example/checkout', true),
    ).toThrow(ForbiddenException);
    expect(
      isWebsiteOriginAllowed('https://shop.example.attacker.invalid', [
        'https://shop.example',
      ]),
    ).toBe(false);
    expect(
      isWebsiteOriginAllowed('https://shop.example', ['https://shop.example']),
    ).toBe(true);
  });

  it('rejects unsafe or unsupported appearance values and returns bounded defaults', () => {
    expect(normalizeWebsiteWidgetConfiguration(null).primaryColor).toBe(
      '#2563eb',
    );
    expect(() =>
      normalizeWebsiteWidgetConfiguration({ primaryColor: 'red' }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeWebsiteWidgetConfiguration({ onClick: 'alert(1)' }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeWebsiteWidgetConfiguration({ requireContact: true }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeWebsiteWidgetConfiguration({
        businessHours: {
          enabled: true,
          daysOfWeek: [1, 1],
          opensAt: '09:00',
          closesAt: '17:00',
        },
      }),
    ).toThrow(BadRequestException);
    expect(
      normalizeWebsiteWidgetConfiguration({
        assistantName: '<img onerror=alert(1)>',
      }).assistantName,
    ).toBe('<img onerror=alert(1)>');
  });

  it('evaluates configured availability in the business timezone', () => {
    const schedule = {
      enabled: true,
      daysOfWeek: [1, 2, 3, 4, 5],
      opensAt: '09:00',
      closesAt: '17:00',
    };
    expect(
      isWebsiteBusinessOpen(
        schedule,
        'Africa/Lagos',
        new Date('2026-11-23T08:30:00.000Z'),
      ),
    ).toBe(true);
    expect(
      isWebsiteBusinessOpen(
        schedule,
        'Africa/Lagos',
        new Date('2026-11-23T16:30:00.000Z'),
      ),
    ).toBe(false);
    expect(
      isWebsiteBusinessOpen(
        { ...schedule, enabled: false },
        'Invalid/Timezone',
        new Date(),
      ),
    ).toBe(true);
  });
});
