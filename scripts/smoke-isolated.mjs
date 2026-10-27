import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';

// Exercise current code without consuming the preview customer's booking quota.
// Browser/SSR pages remain on the existing local preview; write checks use memory.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7);
if (
  only &&
  ![
    'base',
    'care',
    'merchant',
    'staff',
    'admin',
    'handling',
    'employees',
    'experience',
    'engagement',
    'customer-flow',
    'coordination',
    'governance',
    'finance',
    'subscription',
    'invoicing',
    'reporting',
    'completion',
    'in-store',
    'h5',
    'storefront',
  ].includes(only)
)
  throw new Error('Unknown isolated smoke suite.');
const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw new Error('Isolated smoke requires a local preview.');
const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((resolve, reject) =>
  listener.close((error) => (error ? reject(error) : resolve())),
);
const env = {
  ...process.env,
  SQLITE_PATH: ':memory:',
  DATABASE_URL: '',
  API_PORT: String(port),
  APP_MODE: 'demo',
  PAYMENT_PROVIDER: 'demo',
  NODE_ENV: 'development',
  WEB_ORIGIN: origin,
  SMOKE_CLOCK_TOKEN: randomUUID(),
  // Uploaded test files stay out of the developer's private evidence folder.
  EVIDENCE_DIRECTORY: join(tmpdir(), `hogulink-smoke-evidence-${randomUUID()}`),
};
function startApi() {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '../scripts/fixtures/api-test-server.mts'],
    {
      cwd: resolve(root, 'hogulink-api'),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let log = '';
  child.stdout.on('data', (chunk) => {
    log += chunk;
  });
  child.stderr.on('data', (chunk) => {
    log += chunk;
  });
  return { child, getLog: () => log };
}
let instance = startApi();
async function stopApi() {
  if (instance.child.exitCode === null) {
    const exited = once(instance.child, 'exit');
    instance.child.kill('SIGTERM');
    await exited;
  }
}
async function run(script) {
  const child = spawn(process.execPath, [resolve(root, 'scripts', script)], {
    cwd: root,
    env: {
      ...process.env,
      SMOKE_ORIGIN: origin,
      SMOKE_API_ORIGIN: `http://127.0.0.1:${port}`,
      SMOKE_CLOCK_TOKEN: env.SMOKE_CLOCK_TOKEN,
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${script} failed (${code})`);
}
async function waitReady() {
  let ready = false;
  // Cold TypeScript startup on Windows can exceed twelve seconds. Wait for
  // health with a bounded deadline; no business assertion is skipped.
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (instance.child.exitCode !== null) throw new Error(instance.getLog());
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error(`Test API did not start. ${instance.getLog()}`);
}
async function waitPreviewReady() {
  // The shared dev preview may still be rebuilding after a source or tsconfig change.
  // Check readiness before assertions; persistent failures still fail this run.
  const deadline = Date.now() + 60000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      for (const locale of ['ja', 'en', 'zh-cn']) {
        const response = await fetch(`${origin}/${locale}`, { signal: AbortSignal.timeout(10000) });
        await response.text();
        if (!response.ok) throw new Error(`${locale} preview: HTTP ${response.status}`);
      }
      return;
    } catch (error) {
      last = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Local preview did not become ready: ${last}`);
}
try {
  await waitReady();
  await waitPreviewReady();
  console.log('Isolated API checks use an in-memory database; SSR checks use the local preview.');
  if (only) {
    await run(only === 'base' ? 'smoke.mjs' : `smoke-${only}.mjs`);
  } else {
    const suites = [
      'base',
      'care',
      'merchant',
      'staff',
      'admin',
      'handling',
      'employees',
      'experience',
      'engagement',
      'customer-flow',
      'coordination',
      'governance',
      'finance',
      'subscription',
      'invoicing',
      'reporting',
      'completion',
      'in-store',
      'h5',
      'storefront',
    ];
    // Handling, employee and engagement checks intentionally reuse prior bookings.
    // Give the staff capacity checks a fresh fixture so the preceding completed
    // merchant visit's travel buffer does not consume its instant-booking window.
    const reuseFixture = new Set([
      'care',
      'merchant',
      'admin',
      'handling',
      'employees',
      'experience',
      'engagement',
    ]);
    for (const [index, suite] of suites.entries()) {
      if (index > 0 && !reuseFixture.has(suite)) {
        await stopApi();
        instance = startApi();
        await waitReady();
      }
      await run(suite === 'base' ? 'smoke.mjs' : `smoke-${suite}.mjs`);
    }
  }
} finally {
  await stopApi();
  await rm(env.EVIDENCE_DIRECTORY, { recursive: true, force: true });
}
