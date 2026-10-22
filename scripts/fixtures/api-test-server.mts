// Disposable HTTP harness only. The application bootstrap never imports this file.
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiController } from '../../hogulink-api/src/controller.js';
import { Repository } from '../../hogulink-api/src/repository.js';
import { Engine } from '../../hogulink-api/src/engine.js';
import { seed } from '../../hogulink-api/src/seed.js';
import { bootstrapAdmin } from '../../hogulink-api/src/employees.js';
import { assertDemoRuntime } from '../../hogulink-api/src/config.js';
assertDemoRuntime();
const token = process.env.SMOKE_CLOCK_TOKEN;
const port = Number(process.env.API_PORT);
if (
  !token ||
  !port ||
  port === 4000 ||
  process.env.SQLITE_PATH !== ':memory:' ||
  process.env.DATABASE_URL
)
  throw new Error(
    'Test harness requires a unique clock token, a separate port and an in-memory database.',
  );
const repo = new Repository('', ':memory:');
await repo.init();
await seed(repo);
await bootstrapAdmin(repo);
let offset = 0;
const engine = new Engine(repo, () => Date.now() + offset);
@Module({ controllers: [ApiController], providers: [{ provide: 'ENGINE', useValue: engine }] })
class TestModule {}
const app = await NestFactory.create<NestExpressApplication>(TestModule, {
  logger: ['error', 'warn'],
});
app.useBodyParser('json', { limit: '512kb' });
// Fault injection is confined to this disposable, memory-only test entry point.
const failures = new Set<string>();
const supportedFailures = [
  'catalog',
  'listing-stats',
  'store-stats',
  'completion',
  'messages',
  'care',
  'merchant',
  'staff',
  'admin',
];
app.use('/__qa/faults', (req: any, res: any) => {
  if (req.get('x-qa-token') !== token) return res.status(404).end();
  if (req.method === 'POST') {
    if (
      !Array.isArray(req.body?.failures) ||
      req.body.failures.some(
        (x: unknown) => typeof x !== 'string' || !supportedFailures.includes(x),
      )
    )
      return res.status(422).end();
    failures.clear();
    for (const item of req.body.failures) failures.add(item);
  } else if (req.method !== 'GET') return res.status(405).end();
  res.json({ disposable: true, failures: [...failures] });
});
app.use('/v1', (req: any, res: any, next: () => void) => {
  if (req.method !== 'GET') return next();
  const failed =
    (failures.has('catalog') && req.path === '/public/staff-listings') ||
    (failures.has('listing-stats') && req.path === '/public/listing-stats') ||
    (failures.has('store-stats') && req.path === '/public/store-stats') ||
    (failures.has('completion') && /^\/bookings\/[^/]+\/completion$/.test(req.path)) ||
    (failures.has('messages') &&
      /^\/(?:customer\/bookings|merchant\/bookings|staff\/tasks)\/[^/]+\/messages$/.test(
        req.path,
      )) ||
    (failures.has('merchant') && req.path === '/merchant/workspace') ||
    (failures.has('staff') && req.path === '/staff/workspace') ||
    (failures.has('admin') && req.path === '/admin/workspace') ||
    (failures.has('care') && /^\/customer\/bookings\/[^/]+\/care$/.test(req.path));
  if (failed)
    return res
      .status(503)
      .json({ error: { code: 'QA_UNAVAILABLE', message: 'Disposable read failure' } });
  next();
});
app.use('/__qa/clock', (req: any, res: any) => {
  if (req.get('x-qa-token') !== token) return res.status(404).end();
  if (req.method === 'POST') {
    const at = req.body?.at;
    if (!Number.isSafeInteger(at) || at < engine.now() - 1000)
      return res.status(422).json({ error: 'Clock must advance monotonically.' });
    offset = Math.max(offset, at - Date.now());
  } else if (req.method !== 'GET') return res.status(405).end();
  res.json({ now: engine.now(), offset, disposable: true });
});
await app.listen(port, '127.0.0.1');
console.log(`Disposable API ready on ${port}`);
async function close() {
  await app.close();
  await repo.close();
  process.exit(0);
}
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
