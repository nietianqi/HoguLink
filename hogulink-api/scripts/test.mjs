import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import { randomBytes } from 'node:crypto';
const directory = await mkdtemp(join(tmpdir(), 'hogulink-api-tests-'));
try {
  const files = (await readdir('test'))
    .filter((name) => name.endsWith('.test.ts'))
    .sort()
    .map((name) => join('test', name));
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', ...files], {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      APP_MODE: 'demo',
      PAYMENT_PROVIDER: 'demo',
      DEMO_ACCESS_ENABLED: '1',
      EMAIL_PROVIDER: 'disabled',
      DATABASE_URL: '',
      SQLITE_PATH: ':memory:',
      DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      LOCAL_KEY_PATH: join(directory, 'local-key'),
      EVIDENCE_DIRECTORY: join(directory, 'evidence'),
    },
  });
  const [code] = await once(child, 'exit');
  process.exitCode = code ?? 1;
} finally {
  const childPath = relative(resolve(tmpdir()), resolve(directory));
  if (!childPath.startsWith('hogulink-api-tests-') || childPath.includes('..'))
    throw new Error('Unexpected test directory');
  await rm(directory, { recursive: true, force: true });
}
