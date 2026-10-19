import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Repository } from '../hogulink-api/src/repository.js';
import { NotificationWorker, enqueueEmail } from '../hogulink-api/src/notifications.js';
const target = process.env.TEST_DATABASE_URL;
if (!target)
  throw new Error(
    'Set TEST_DATABASE_URL to a disposable local PostgreSQL database ending in _test',
  );
const url = new URL(target);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test'))
  throw new Error('PostgreSQL checks require an explicitly named local *_test database');
const schema = `qa_${randomUUID().replace(/-/g, '')}`,
  admin = new Pool({ connectionString: target });
await admin.query(`CREATE SCHEMA ${schema}`);
url.searchParams.set('options', `-c search_path=${schema},public`);
const a = new Repository(url.toString()),
  b = new Repository(url.toString());
try {
  await a.init();
  await b.init();
  await a.transaction((tx) => tx.put('testCounter', { id: 'one', value: 0 }));
  await Promise.all(
    [a, b, a, b].map((repo) =>
      repo.transaction(async (tx) => {
        const row = await tx.get<{ id: string; value: number }>('testCounter', 'one');
        await tx.put('testCounter', { ...row!, value: row!.value + 1 });
      }),
    ),
  );
  assert.equal((await a.read((tx) => tx.get<{ value: number }>('testCounter', 'one')))!.value, 4);
  const intervals = await Promise.allSettled(
    [a, b].map((repo, i) =>
      repo.transaction((tx) =>
        tx.interval({ id: `slot-${i}`, staffId: 'staff', startAt: 10, endAt: 20, expiresAt: 100 }),
      ),
    ),
  );
  assert.equal(intervals.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(intervals.filter((r) => r.status === 'rejected').length, 1);
  await a.transaction((tx) =>
    enqueueEmail(
      tx,
      { to: 'test@example.test', subject: 'test', text: 'local only' },
      'TEST',
      Date.now(),
    ),
  );
  let delivered = 0;
  const send = async () => {
    delivered++;
    return 'accepted';
  };
  await Promise.all([
    new NotificationWorker(a, send).tick(),
    new NotificationWorker(b, send).tick(),
  ]);
  assert.equal(delivered, 1);
  await a.transaction((tx) =>
    tx.put('bookings', {
      id: 'booking',
      storeId: 'shop',
      merchantId: 'merchant',
      selectedStaffId: 'staff',
      selectedStaffListingId: 'listing',
      quote: { bookingMode: 'SCHEDULED', nominationType: 'NOMINATED' },
    }),
  );
  await assert.rejects(
    a.transaction((tx) =>
      tx.put('bookings', {
        id: 'booking',
        storeId: 'forged',
        merchantId: 'merchant',
        selectedStaffId: 'staff',
        selectedStaffListingId: 'listing',
        quote: { bookingMode: 'SCHEDULED', nominationType: 'NOMINATED' },
      }),
    ),
    /Immutable booking identity/,
  );
  await a.read(async (tx) => {
    assert.equal(await tx.count('bookings', { storeId: 'shop' }), 1);
    assert.equal((await tx.find('bookings', { storeId: ['shop'] })).length, 1);
  });
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        'serializable_retry',
        'overlap_exclusion',
        'outbox_claim',
        'immutable_identity',
        'indexed_filters',
      ],
      schema,
    }),
  );
} finally {
  await a.close();
  await b.close();
  if (!/^qa_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected test schema');
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
