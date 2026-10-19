import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Repository } from './repository.js';
import { writeBackup } from './backup.js';
const repo = new Repository();
await repo.init();
const directory = resolve(process.env.BACKUP_DIRECTORY || 'backups');
let running: Promise<void> | undefined,
  stopped = false;
function tick() {
  if (running || stopped) return;
  running = (async () => {
    const file = join(
      directory,
      `hogu-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.enc`,
    );
    const result = await writeBackup(repo, file);
    await repo.transaction((tx) =>
      tx.put('systemHealth', { id: 'backup', status: 'ok', at: Date.now(), ...result }),
    );
    console.log(JSON.stringify({ event: 'backup_complete', at: Date.now(), ...result }));
  })()
    .catch(async () => {
      await repo
        .transaction((tx) =>
          tx.put('systemHealth', { id: 'backup', status: 'error', at: Date.now() }),
        )
        .catch(() => {});
      console.error(JSON.stringify({ level: 'error', event: 'backup_failed', at: Date.now() }));
    })
    .finally(() => {
      running = undefined;
    });
}
tick();
const timer = setInterval(tick, 24 * 3600000);
async function close() {
  stopped = true;
  clearInterval(timer);
  await running;
  await repo.close();
  process.exit(0);
}
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
