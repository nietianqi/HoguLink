import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, randomUUID, scrypt } from 'node:crypto';
import { Repository } from './repository.js';
import { migrateEvidence, restoreEvidence } from './evidence-storage.js';
import { unseal } from './secrets.js';
import { writeBackup } from './backup.js';
import { ticketTeams } from '@hogulink/contracts';
const action = process.argv[2],
  file = process.argv[3];
if (
  ![
    'migrate',
    'migrate-evidence',
    'migrate-private',
    'backup',
    'restore',
    'bootstrap-owner',
  ].includes(action)
)
  throw new Error(
    'Choose migrate, migrate-evidence, migrate-private, backup <file>, restore <file>, or bootstrap-owner',
  );
const repo = new Repository();
await repo.init();
try {
  if (action === 'migrate') console.log(JSON.stringify({ ok: true, schemaVersion: 2 }));
  if (action === 'migrate-evidence') console.log(JSON.stringify(await migrateEvidence(repo)));
  if (action === 'migrate-private') {
    let count = 0;
    await repo.transaction(async (tx) => {
      for (const kind of [
        'bookings',
        'addressBooks',
        'customerAccounts',
        'partnerAccounts',
        'messages',
        'partnerApplications',
        'adminMembers',
        'contentReviews',
      ])
        for (const record of await tx.list<{ id: string }>(kind)) {
          await tx.put(kind, record);
          count++;
        }
    });
    console.log(JSON.stringify({ ok: true, rewritten: count }));
  }
  if (action === 'backup') {
    if (!file) throw new Error('A new backup file path is required');
    console.log(JSON.stringify({ ok: true, ...(await writeBackup(repo, file)) }));
  }
  if (action === 'restore') {
    if (!file)
      throw new Error('A backup path is required; configure an empty destination database');
    const snapshot = JSON.parse(
      unseal(await readFile(resolve(file), 'utf8'), 'backup:v1').toString(),
    );
    const current = await repo.snapshot();
    if (current.records.length) throw new Error('Restore requires an empty database');
    await restoreEvidence(snapshot.evidence || [], snapshot.records);
    console.log(JSON.stringify(await repo.restore(snapshot)));
  }
  if (action === 'bootstrap-owner') {
    const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase(),
      password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !password ||
      password.length < 16 ||
      password.length > 128
    )
      throw new Error('Set ADMIN_BOOTSTRAP_EMAIL and a 16–128 character ADMIN_BOOTSTRAP_PASSWORD');
    const salt = randomBytes(16).toString('hex'),
      hash = (
        await new Promise<Buffer>((resolve, reject) =>
          scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key))),
        )
      ).toString('hex');
    await repo.transaction(async (tx) => {
      const members = await tx.list<{ id: string; bootstrap?: boolean; adminRole: string }>(
        'adminMembers',
      );
      if (members.some((m) => !m.bootstrap && m.adminRole === 'OWNER'))
        throw new Error('Owner already exists');
      const id = `member_${randomUUID()}`;
      await tx.put('adminMembers', {
        id,
        email,
        name: process.env.ADMIN_BOOTSTRAP_NAME || 'Platform owner',
        status: 'ACTIVE',
        adminRole: 'OWNER',
        teams: [...ticketTeams],
        version: 1,
        sessionVersion: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        bootstrap: false,
      });
      await tx.put('adminCredentials', { id, salt, hash });
      await tx.put('audit', {
        id: `audit_${randomUUID()}`,
        actorId: 'operator',
        action: 'OWNER_BOOTSTRAPPED',
        at: Date.now(),
      });
    });
    console.log(JSON.stringify({ ok: true, event: 'owner_bootstrapped' }));
  }
} finally {
  await repo.close();
}
