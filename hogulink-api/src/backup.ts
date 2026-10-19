import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Repository } from './repository.js';
import { bundleEvidence } from './evidence-storage.js';
import { seal } from './secrets.js';
export async function writeBackup(repo: Repository, file: string) {
  const output = resolve(file),
    snapshot = await repo.snapshot();
  const evidence = await bundleEvidence(
    snapshot.records as { kind: string; id: string; body: string }[],
  );
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, seal(JSON.stringify({ ...snapshot, evidence }), 'backup:v1'), {
    flag: 'wx',
    mode: 0o600,
  });
  return {
    records: snapshot.records.length,
    intervals: snapshot.intervals.length,
    files: evidence.length,
  };
}
