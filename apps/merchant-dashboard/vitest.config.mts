import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { '@': resolve(appRoot, '.') } },
  test: { environment: 'jsdom', setupFiles: ['./test/setup.ts'], include: ['**/*.test.tsx'] },
});
