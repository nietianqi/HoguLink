// Test-data seeding harness: runs the real API against the configured SQLite file with a
// movable clock so past visits can be completed. Stop the main API before using it.
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiController } from '../../hogulink-api/src/controller.js';
import { Repository } from '../../hogulink-api/src/repository.js';
import { Engine } from '../../hogulink-api/src/engine.js';
import { seed, seedDemoPromotion, seedDemoServices } from '../../hogulink-api/src/seed.js';
import { bootstrapAdmin } from '../../hogulink-api/src/employees.js';
import { assertDemoRuntime } from '../../hogulink-api/src/config.js';
import { unseal } from '../../hogulink-api/src/secrets.js';
import { seedCatalog } from './seed-catalog.mjs';
assertDemoRuntime();
const token = process.env.SEED_TOKEN;
const port = Number(process.env.API_PORT);
if (!token || !port || port === 4000) throw new Error('Seed harness needs SEED_TOKEN and a separate port.');
const repo = new Repository();
await repo.init();
await seed(repo);
await bootstrapAdmin(repo);
let offset = Number(process.env.SEED_START_OFFSET_MS || 0);
const engine = new Engine(repo, () => Date.now() + offset);
await seedDemoServices(repo);
await seedDemoPromotion(engine);
if (process.env.SEED_CATALOG === '1') await seedCatalog(repo, Date.now());
@Module({ controllers: [ApiController], providers: [{ provide: 'ENGINE', useValue: engine }] })
class SeedModule {}
const app = await NestFactory.create<NestExpressApplication>(SeedModule, { logger: ['error', 'warn'] });
app.useBodyParser('json', { limit: '512kb' });
app.use('/__seed/clock', (req: any, res: any) => {
  if (req.get('x-seed-token') !== token) return res.status(404).end();
  if (req.method === 'POST') {
    const at = req.body?.at;
    if (!Number.isSafeInteger(at) || at < engine.now() - 1000)
      return res.status(422).json({ error: 'Clock must advance monotonically.' });
    offset = Math.min(0, Math.max(offset, at - Date.now()));
  }
  res.json({ now: engine.now(), offset });
});
// Local-only mailbox: decrypts queued emails so verification links can be followed.
app.use('/__seed/outbox', async (req: any, res: any) => {
  if (req.get('x-seed-token') !== token) return res.status(404).end();
  const rows = await repo.read((tx) => tx.list<any>('outbox'));
  res.json(
    rows
      .filter((r) => r.payloadSealed)
      .map((r) => ({ id: r.id, type: r.type, createdAt: r.createdAt, ...JSON.parse(unseal(r.payloadSealed, r.id).toString()) })),
  );
});
await app.listen(port, '127.0.0.1');
console.log(`Seed API ready on ${port}`);
async function close() {
  await app.close();
  await repo.close();
  process.exit(0);
}
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
