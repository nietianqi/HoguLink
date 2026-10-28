import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
/**
 * Moves a scheduled start into the default 09:00-22:00 JST business hours, never earlier.
 * Starts stay at or before 18:00 so a script's "+3 hours" variant is still bookable.
 */
function bookable(at) {
  const minute = Math.floor((at + 9 * 3600000) / 60000) % 1440;
  if (minute >= 9 * 60 && minute <= 18 * 60) return at;
  const ten = Math.floor((at + 9 * 3600000) / 86400000) * 86400000 + 3600000;
  return ten > at ? ten : ten + 86400000;
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  keep = process.argv.includes('--keep');
const requested = Number(process.argv.find((a) => a.startsWith('--api-port='))?.split('=')[1] || 0);
const origin =
  process.argv.find((a) => a.startsWith('--web-origin='))?.slice(13) || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname) || requested === 4000)
  throw new Error('Account checks require a disposable local API');
const secret = randomBytes(32).toString('hex'),
  messages = [],
  receipts = new Map();
const receiver = createServer(async (req, res) => {
  if (keep && req.method === 'GET' && req.url === '/__qa/messages') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(messages));
  }
  if (req.method !== 'POST') {
    res.writeHead(404);
    return res.end();
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100000) {
      res.writeHead(413);
      return res.end();
    }
  }
  const timestamp = req.headers['x-hogu-timestamp'],
    signature = req.headers['x-hogu-signature'];
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  if (
    typeof signature !== 'string' ||
    signature.length !== 64 ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ||
    Math.abs(Date.now() - Number(timestamp)) > 60000
  ) {
    res.writeHead(403);
    return res.end();
  }
  const value = JSON.parse(body);
  if (!receipts.has(value.id)) {
    receipts.set(value.id, `test-provider-${receipts.size + 1}`);
    messages.push(value.email);
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ messageId: receipts.get(value.id) }));
});
receiver.listen(0, '127.0.0.1');
await once(receiver, 'listening');
const receiverPort = receiver.address().port;
const reservation = createServer();
reservation.listen(requested, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
await mkdir(resolve(root, '.qa'), { recursive: true });
const env = {
  ...process.env,
  SQLITE_PATH: keep ? resolve(root, `.qa/account-preview-${randomUUID()}.sqlite`) : ':memory:',
  DATABASE_URL: '',
  API_HOST: '127.0.0.1',
  API_PORT: String(port),
  NODE_ENV: 'development',
  APP_MODE: 'demo',
  PAYMENT_PROVIDER: 'demo',
  DEMO_ACCESS_ENABLED: '0',
  WEB_ORIGIN: origin,
  PUBLIC_WEB_URL: origin,
  EMAIL_PROVIDER: 'webhook',
  NOTIFICATION_WEBHOOK_URL: `http://127.0.0.1:${receiverPort}`,
  NOTIFICATION_WEBHOOK_SECRET: secret,
  DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  RUN_BACKGROUND_JOBS: '1',
};
if (keep) {
  const bootstrap = spawn(
    process.execPath,
    ['--import', 'tsx', 'src/entrypoint.ts', 'maintenance', 'bootstrap-owner'],
    {
      cwd: resolve(root, 'hogulink-api'),
      env: {
        ...env,
        ADMIN_BOOTSTRAP_EMAIL: 'qa-owner@example.test',
        ADMIN_BOOTSTRAP_PASSWORD: 'isolated operator password',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    },
  );
  let errors = '';
  bootstrap.stderr.on('data', (b) => {
    errors += b;
  });
  const [code] = await once(bootstrap, 'exit');
  if (code !== 0) throw new Error(`Disposable owner bootstrap failed: ${errors}`);
}
const child = spawn(process.execPath, ['--import', 'tsx', 'src/entrypoint.ts', 'main'], {
  cwd: resolve(root, 'hogulink-api'),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let log = '';
child.stdout.on('data', (b) => {
  log += b;
});
child.stderr.on('data', (b) => {
  log += b;
});
let checks = 0;
async function close() {
  if (child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  await new Promise((r) => receiver.close(r));
}
async function request(path, body, cookie = '', expected = 200) {
  const r = await fetch(`http://127.0.0.1:${port}/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined
        ? {}
        : { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  assert.equal(r.status, expected, `${path}: ${JSON.stringify(data)}`);
  checks++;
  return { data, cookie: r.headers.get('set-cookie')?.split(';')[0], headers: r.headers };
}
async function mail(address, start = 0) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = messages.slice(start).find((m) => m.to === address);
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Local mail delivery timed out');
}
const extract = (m) =>
  new URLSearchParams(
    new URL(m.text.split('\n').find((l) => l.startsWith('http'))).hash.slice(1),
  ).get('token');
const input = (email) => ({
  email,
  password: 'isolated account password',
  name: 'Test guest',
  locale: 'zh-cn',
  termsAccepted: true,
});
try {
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(log);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/health`);
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.ok(ready, log);
  const health = await request('health');
  assert.equal(health.data.demoAccessEnabled, false);
  assert.equal(health.headers.get('x-frame-options'), 'DENY');
  checks += 2;
  await request('auth/demo', { role: 'ADMIN' }, '', 404);
  const invalidRegistration = await request(
    'auth/customer/register',
    { name: '', email: 'not-an-email', password: 'short', locale: 'zh-cn', termsAccepted: false },
    '',
    422,
  );
  assert.equal(invalidRegistration.data.error.code, 'VALIDATION_ERROR');
  assert.deepEqual([...invalidRegistration.data.error.fields].sort(), [
    'email',
    'name',
    'password',
    'termsAccepted',
  ]);
  assert.equal(messages.length, 0, 'Invalid registration must not enqueue a verification email');
  checks += 3;
  const a = 'account-a@example.test',
    b = 'account-b@example.test';
  await request('auth/customer/register', { ...input(a), role: 'ADMIN' }, '', 422);
  await request('auth/customer/register', input(a));
  await request('auth/customer/login', { email: a, password: input(a).password }, '', 403);
  const initial = await mail(a);
  await request('auth/customer/verify-email', { token: extract(initial) });
  await request('auth/customer/verify-email', { token: extract(initial) }, '', 400);
  const login = await request('auth/customer/login', { email: a, password: input(a).password });
  const actorA = login.data,
    cookieA = login.cookie;
  assert.ok(cookieA);
  assert.match(login.headers.get('set-cookie'), /HttpOnly.*SameSite=Strict/);
  checks += 2;
  const quote = (
    await request(
      'quotes',
      {
        listingId: 'listing-aoi',
        offeringId: 'store-nagi-60',
        bookingMode: 'SCHEDULED',
        nominationType: 'NOMINATED',
        startAt: bookable(Date.now() + 3 * 3600000),
        area: 'shinjuku',
        requiredLanguage: '',
      },
      cookieA,
      201,
    )
  ).data;
  const hold = (await request('booking-holds', { quoteId: quote.id }, cookieA, 201)).data;
  const payment = (
    await request(
      'payments/demo-authorizations',
      { holdId: hold.id, challengePassed: true },
      cookieA,
    )
  ).data;
  const booking = (
    await request(
      'bookings',
      {
        quoteId: quote.id,
        holdId: hold.id,
        paymentId: payment.id,
        termsAccepted: true,
        policyVersion: quote.cancellationPolicy.version,
        address: {
          name: 'Private account A',
          area: 'shinjuku',
          type: 'HOTEL',
          detail: 'Private test room',
          hotelName: 'Test hotel',
          room: '101',
          hotelPermission: true,
        },
      },
      cookieA,
      201,
    )
  ).data;
  await request('auth/customer/register', input(b));
  await request('auth/customer/verify-email', { token: extract(await mail(b)) });
  const second = await request('auth/customer/login', { email: b, password: input(b).password });
  assert.notEqual(second.data.id, actorA.id);
  checks++;
  await request(`bookings/${booking.id}`, undefined, second.cookie, 404);
  assert.deepEqual((await request('bookings', undefined, second.cookie)).data, []);
  checks++;
  const rotated = await request(
    'auth/customer/login',
    { email: a, password: input(a).password },
    cookieA,
  );
  await request('auth/session', undefined, cookieA, 401);
  await request('auth/session', undefined, rotated.cookie);
  const before = messages.length;
  await request('auth/customer/forgot-password', { email: a });
  const reset = extract(await mail(a, before));
  await request('auth/customer/reset-password', {
    token: reset,
    password: 'new isolated account password',
  });
  await request('auth/session', undefined, rotated.cookie, 401);
  await request('auth/session', undefined, second.cookie);
  await request('auth/customer/login', { email: a, password: input(a).password }, '', 401);
  await request('auth/customer/login', { email: a, password: 'new isolated account password' });
  await request('auth/customer/forgot-password', { email: 'unknown@example.test' });
  const report = {
    checks,
    apiPort: port,
    receiverPort,
    origin,
    passed: true,
    realEmailsSent: false,
  };
  await mkdir(resolve(root, '.qa'), { recursive: true });
  await writeFile(
    resolve(root, '.qa/nonpayment-http-report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  if (keep) {
    console.log('Disposable account preview remains available.');
    process.once('SIGTERM', () => void close().then(() => process.exit(0)));
    process.once('SIGINT', () => void close().then(() => process.exit(0)));
  } else await close();
} catch (error) {
  await close();
  throw error;
}
