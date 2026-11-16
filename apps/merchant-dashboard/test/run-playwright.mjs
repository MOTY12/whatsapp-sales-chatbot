import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const appDir = resolve(import.meta.dirname, '..');
const distDir = `.next-playwright-${process.pid}`;
const nextEnvPath = resolve(appDir, 'next-env.d.ts');
const tsconfigPath = resolve(appDir, 'tsconfig.json');
const [originalNextEnv, originalTsconfig] = await Promise.all([
  readFile(nextEnvPath, 'utf8'),
  readFile(tsconfigPath, 'utf8'),
]);

const playwrightCli = resolve(appDir, 'node_modules/@playwright/test/cli.js');
const child = spawn(
  process.execPath,
  [playwrightCli, 'test', '--config', 'playwright.config.ts'],
  {
    cwd: appDir,
    env: { ...process.env, KLEVA_NEXT_DIST_DIR: distDir },
    stdio: 'inherit',
  },
);

let receivedSignal;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    receivedSignal = signal;
    child.kill(signal);
  });
}

const result = await new Promise((resolveExit, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolveExit({ code, signal }));
});

const generatedNextEnv = (await readFile(nextEnvPath, 'utf8')).replaceAll(
  `./${distDir}/dev`,
  './.next',
);
const generatedTsconfig = (await readFile(tsconfigPath, 'utf8')).replace(
  `,\n    "${distDir}/types/**/*.ts",\n    "${distDir}/dev/types/**/*.ts"`,
  '',
);

const safeToRestore =
  generatedNextEnv === originalNextEnv &&
  generatedTsconfig === originalTsconfig;

if (safeToRestore) {
  await Promise.all([
    writeFile(nextEnvPath, originalNextEnv),
    writeFile(tsconfigPath, originalTsconfig),
  ]);
} else {
  process.stderr.write(
    'Playwright changed Next type configuration beyond its generated distDir entries; leaving those files untouched.\n',
  );
}

process.exitCode = receivedSignal ? 128 + (receivedSignal === 'SIGINT' ? 2 : 15) : result.code ?? 1;
