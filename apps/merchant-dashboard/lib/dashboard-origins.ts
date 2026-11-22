const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export function configuredDashboardOrigins(env = process.env): Set<string> {
  const primary = env.DASHBOARD_PUBLIC_ORIGIN?.trim();
  const additionalRaw = env.DASHBOARD_ALLOWED_ORIGINS?.trim();
  const additional = additionalRaw
    ? additionalRaw.split(',').map((item) => item.trim())
    : [];
  if (additional.some((value) => !value))
    throw new Error('Dashboard origin configuration is invalid.');
  const values = [primary, ...(additional ?? [])].filter(
    (value): value is string => Boolean(value),
  );
  const origins = new Set<string>();

  for (const value of values) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error('Dashboard origin configuration is invalid.');
    }
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      (parsed.protocol !== 'https:' &&
        !(parsed.protocol === 'http:' && localHosts.has(parsed.hostname)))
    ) {
      throw new Error('Dashboard origin configuration is invalid.');
    }
    origins.add(parsed.origin);
  }

  return origins;
}

export function isAllowedDashboardOrigin(
  requestOrigin: string | null,
  env = process.env,
): requestOrigin is string {
  if (!requestOrigin) return false;
  try {
    const parsed = new URL(requestOrigin);
    return (
      parsed.origin === requestOrigin &&
      configuredDashboardOrigins(env).has(parsed.origin)
    );
  } catch {
    return false;
  }
}
