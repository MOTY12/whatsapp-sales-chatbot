import { isIP } from 'node:net';
import { websiteAbuseConfig } from '../config/env';

function normalizeIp(value: string | undefined) {
  if (!value) return null;
  const trimmed = value.trim().replace(/^\[|\]$/g, '');
  const mapped = trimmed.toLowerCase().startsWith('::ffff:')
    ? trimmed.slice(7)
    : trimmed;
  return isIP(mapped) ? mapped.toLowerCase() : null;
}

/** Uses forwarding headers only when the direct peer is explicitly trusted. */
export function websiteClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | undefined,
  trustedProxyIps = websiteAbuseConfig().trustedProxyIps,
) {
  const peer = normalizeIp(remoteAddress);
  if (!peer) return 'unknown';
  const trusted = new Set(
    [...trustedProxyIps]
      .map(normalizeIp)
      .filter((ip): ip is string => ip !== null),
  );
  if (!trusted.has(peer) || !forwardedFor) return peer;

  const rawChain = forwardedFor.split(',');
  const chain = rawChain.map(normalizeIp);
  if (!chain.length || chain.some((ip) => ip === null)) return peer;

  // Walk from the directly connected proxy toward the client. The first
  // untrusted hop is the client address; values to its left are spoofable.
  let current = peer;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (!trusted.has(current)) return current;
    current = chain[index]!;
  }
  return trusted.has(current) ? peer : current;
}
