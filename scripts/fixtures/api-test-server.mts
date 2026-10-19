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
