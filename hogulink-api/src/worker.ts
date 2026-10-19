import { Repository } from './repository.js';
import { Engine } from './engine.js';
import { assertDemoRuntime } from './config.js';
import { startBackground } from './background.js';
assertDemoRuntime();
const repo = new Repository();
await repo.init();
const stop = startBackground(new Engine(repo));
console.log(JSON.stringify({ event: 'worker_started', mode: process.env.APP_MODE || 'demo' }));
const keepAlive = setInterval(() => {}, 3600000);
async function close() {
  clearInterval(keepAlive);
  await stop();
  await repo.close();
  process.exit(0);
}
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
