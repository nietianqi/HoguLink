import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiController } from './controller.js';
import { Repository } from './repository.js';
import { Engine } from './engine.js';
import { assertDemoRuntime } from './config.js';
import { seed } from './seed.js';
import { bootstrapAdmin } from './employees.js';
import { startBackground } from './background.js';

assertDemoRuntime();
const repo = new Repository();
await repo.init();
if (
  process.env.SEED_DEMO_DATA === '1' ||
  ((process.env.APP_MODE ?? 'demo') === 'demo' && process.env.SEED_DEMO_DATA !== '0')
)
  await seed(repo);
if ((process.env.APP_MODE ?? 'demo') === 'demo') await bootstrapAdmin(repo);
const engine = new Engine(repo);
@Module({ controllers: [ApiController], providers: [{ provide: 'ENGINE', useValue: engine }] })
class AppModule {}
const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  logger: ['error', 'warn', 'log'],
});
app.useBodyParser('json', { limit: '512kb' });
const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (![0, 1, 2].includes(proxyHops)) throw new Error('Invalid TRUST_PROXY_HOPS');
app.set('trust proxy', proxyHops);
app.disable('x-powered-by');
const stopBackground =
  process.env.RUN_BACKGROUND_JOBS === '0' ? async () => {} : startBackground(engine);
await app.listen(Number(process.env.API_PORT || 4000), process.env.API_HOST || '127.0.0.1');
console.log(
  `HoguLink ${process.env.APP_MODE || 'demo'} API ready at ${await app.getUrl()}/v1/health`,
);
async function close() {
  await stopBackground();
  await app.close();
  await repo.close();
  process.exit(0);
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
