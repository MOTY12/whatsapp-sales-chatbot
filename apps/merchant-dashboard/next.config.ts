import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,
  // Browser tests may run beside a developer's Next server in this checkout.
  // Keep their dev manifests and incremental compiler state separate.
  distDir: process.env.KLEVA_NEXT_DIST_DIR ?? '.next',
  turbopack: { root: process.cwd() },
};
export default nextConfig;
