import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPartnerBookings } from '../hogulink-web/src/lib/partner-booking-data';
import { ClientError } from '../hogulink-web/src/lib/api';

test('merchant orders survive unavailable public profiles and retain their private team', async (t) => {
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    if (path.includes('public/'))
      return new Response(JSON.stringify({ error: { code: 'UNAVAILABLE' } }), { status: 503 });
    return new Response(
      JSON.stringify(
        path.endsWith('dashboard') ? { listings: [{ id: 'private-team' }] } : [{ id: 'pending' }],
      ),
    );
  });
  const result = await loadPartnerBookings('MERCHANT');
  assert.deepEqual(result.bookings, [{ id: 'pending' }]);
  assert.equal(await result.catalog, undefined);
  assert.deepEqual(await result.dashboard, { listings: [{ id: 'private-team' }] });
});

test('stalled dashboard and directory cannot delay order access', { timeout: 1000 }, async (t) => {
  let finish!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  t.mock.method(globalThis, 'fetch', async (path: string) =>
    path.includes('bookings') ? new Response(JSON.stringify({ id: 'ready' })) : pending,
  );
  const result = await loadPartnerBookings('MERCHANT', 'ready');
  assert.deepEqual(result.bookings, [{ id: 'ready' }]);
  finish(new Response('{}'));
  await Promise.all([result.catalog, result.dashboard]);
});

test('private failures stay errors and identifiers stay encoded', async (t) => {
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    paths.push(path);
    return path.includes('bookings')
      ? new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 })
      : new Response('{}');
  });
  await assert.rejects(
    loadPartnerBookings('STAFF', 'other/order'),
    (error) => error instanceof ClientError && error.code === 'NOT_FOUND',
  );
  assert.ok(paths.includes('/v1/bookings/other%2Forder'));
  assert.ok(!paths.some((path) => path.endsWith('dashboard')));
});
