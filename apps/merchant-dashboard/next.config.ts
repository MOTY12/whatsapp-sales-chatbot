import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,
  turbopack: { root: process.cwd() },
};
export default nextConfig;
