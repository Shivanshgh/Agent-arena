import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isolatedDataDir = mkdtempSync(resolve(tmpdir(), 'agentarena-tests-'));
const env = {
  ...process.env,
  NODE_ENV: 'test',
  ENABLE_DEMO_SEED: 'true',
  AGENTARENA_SECRET_KEY: process.env.AGENTARENA_SECRET_KEY || randomBytes(32).toString('hex'),
};
const suites = [
  'src/tests/stage3.test.ts',
  'src/tests/stage4.test.ts',
  'src/tests/stage5.test.ts',
  'src/tests/stage6.test.ts',
  'src/tests/stage7.test.ts',
  'src/tests/stage8.test.ts',
];
try {
  for (const suite of suites) {
    const result = spawnSync(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), resolve(root, suite)], { stdio: 'inherit', env, cwd: isolatedDataDir });
    if (result.status !== 0) process.exitCode = result.status ?? 1;
    if (process.exitCode) break;
  }
} finally {
  rmSync(isolatedDataDir, { recursive: true, force: true });
}
