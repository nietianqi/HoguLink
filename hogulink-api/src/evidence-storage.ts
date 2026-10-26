import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { seal, unseal } from './secrets.js';
import type { Repository } from './repository.js';
export type StoredEvidence = { id: string; data?: string; storageKey?: string };
/** Record kinds whose files live in evidence storage under the record id. */
const fileKinds = new Set(['partnerEvidence', 'venuePhotos']);
function location(id: string) {
  if (!/^evidence_[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid evidence storage key');
  return join(resolve(process.env.EVIDENCE_DIRECTORY || 'data/private-evidence'), `${id}.enc`);
}
export async function saveEvidence(id: string, bytes: Buffer) {
  const file = location(id);
  await mkdir(resolve(process.env.EVIDENCE_DIRECTORY || 'data/private-evidence'), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(file, seal(bytes, `evidence:${id}`), { flag: 'wx', mode: 0o600 });
  return id;
}
export async function loadEvidence(e: StoredEvidence) {
  if (e.storageKey)
    return unseal(await readFile(location(e.storageKey), 'utf8'), `evidence:${e.id}`);
  if (e.data) return Buffer.from(e.data, 'base64');
  throw new Error('Evidence content is unavailable');
}
export async function migrateEvidence(repo: Repository) {
  let migrated = 0;
  const rows = await repo.read((tx) => tx.list<StoredEvidence>('partnerEvidence'));
  for (const row of rows) {
    if (!row.data || row.storageKey) continue;
    // Reuse an already-written file after an interrupted migration only after authenticating it.
    try {
      await saveEvidence(row.id, Buffer.from(row.data, 'base64'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const bytes = await loadEvidence({ ...row, storageKey: row.id });
      if (!bytes.equals(Buffer.from(row.data, 'base64')))
        throw new Error('Evidence migration content mismatch');
    }
    const changed = await repo.transaction(async (tx) => {
      const current = await tx.get<StoredEvidence>('partnerEvidence', row.id);
      if (!current || current.storageKey || current.data !== row.data) return false;
      const { data: _data, ...metadata } = current;
      await tx.put('partnerEvidence', { ...metadata, storageKey: row.id });
      return true;
    });
    if (changed) migrated++;
  }
  return { migrated };
}
export async function bundleEvidence(records: { kind: string; id: string; body: string }[]) {
  const files: { id: string; data: string }[] = [];
  for (const row of records)
    if (fileKinds.has(row.kind)) {
      const metadata = JSON.parse(row.body) as StoredEvidence;
      if (metadata.storageKey)
        files.push({ id: row.id, data: (await loadEvidence(metadata)).toString('base64') });
    }
  return files;
}
export async function restoreEvidence(
  files: { id: string; data: string }[],
  records: { kind: string; id: string; body: string }[],
) {
  const allowed = new Set(records.filter((row) => fileKinds.has(row.kind)).map((row) => row.id));
  for (const file of files) {
    if (!allowed.has(file.id) || typeof file.data !== 'string')
      throw new Error('Unexpected evidence in backup');
    const bytes = Buffer.from(file.data, 'base64');
    if (bytes.length > 350000 || bytes.toString('base64') !== file.data)
      throw new Error('Invalid evidence in backup');
    try {
      await saveEvidence(file.id, bytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!(await loadEvidence({ id: file.id, storageKey: file.id })).equals(bytes))
        throw new Error('Evidence already exists with different content');
    }
  }
  for (const row of records)
    if (
      fileKinds.has(row.kind) &&
      JSON.parse(row.body).storageKey &&
      !files.some((file) => file.id === row.id)
    )
      throw new Error('Backup is missing evidence content');
}
