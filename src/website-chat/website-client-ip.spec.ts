import { websiteClientIp } from './website-client-ip';

describe('website trusted client IP resolution', () => {
  it('ignores forwarded headers from untrusted peers', () => {
    expect(
      websiteClientIp('198.51.100.9', '203.0.113.7', new Set(['127.0.0.1'])),
    ).toBe('198.51.100.9');
  });

  it('uses the client hop behind an explicitly trusted proxy', () => {
    expect(
      websiteClientIp(
        '127.0.0.1',
        '203.0.113.7, 10.0.0.2',
        new Set(['127.0.0.1', '10.0.0.2']),
      ),
    ).toBe('203.0.113.7');
  });

  it('normalizes IPv4-mapped IPv6 and rejects malformed forwarded values', () => {
    expect(websiteClientIp('::ffff:127.0.0.1', undefined)).toBe('127.0.0.1');
    expect(
      websiteClientIp('127.0.0.1', 'spoofed', new Set(['127.0.0.1'])),
    ).toBe('127.0.0.1');
  });
});
