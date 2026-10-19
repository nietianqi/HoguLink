import { Engine } from './engine.js';
export function startBackground(engine: Engine) {
  let running: Promise<void> | undefined,
    stopped = false;
  const tick = () => {
    if (running || stopped) return;
    running = (async () => {
      await engine.run(async (tx) => {
        for (const kind of ['sessions', 'customerChallenges'])
          for (const row of await tx.find<{ id: string }>(
            kind,
            { expiresAt: { lte: engine.now() } },
            { limit: 500 },
          ))
            await tx.remove(kind, row.id);
      });
      await engine.notifications.tick(4);
      await engine.limits.prune();
      await engine.repo.transaction((tx) =>
        tx.put('systemHealth', { id: 'background', at: engine.now(), status: 'ok' }),
      );
    })()
      .catch(() =>
        console.error(
          JSON.stringify({ level: 'error', event: 'background_job_failed', at: Date.now() }),
        ),
      )
      .finally(() => {
        running = undefined;
      });
  };
  const timer = setInterval(tick, 5000);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
