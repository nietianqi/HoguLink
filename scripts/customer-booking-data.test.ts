import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCustomerBookings } from '../hogulink-web/src/lib/customer-booking-data';
import { ClientError } from '../hogulink-web/src/lib/api';

test(
  'a stalled public directory cannot delay a readable private booking',
  { timeout: 1000 },
  async (t) => {
    let finishCatalog!: (response: Response) => void;
    const pendingCatalog = new Promise<Response>((resolve) => {
      finishCatalog = resolve;
    });
    t.mock.method(globalThis, 'fetch', async (path: string) =>
      path.includes('public/')
        ? pendingCatalog
        : new Response(JSON.stringify({ id: 'ready-order' })),
    );
    const result = await loadCustomerBookings('ready-order');
    assert.deepEqual(result.bookings, [{ id: 'ready-order' }]);
    finishCatalog(new Response(JSON.stringify({ listings: [], stores: [], offerings: [] })));
    assert.deepEqual(await result.catalog, { listings: [], stores: [], offerings: [] });
  },
);

test('an existing order remains accessible when public profiles fail', async (t) => {
  const calls: string[] = [];
  const order = {
    id: 'private-order',
    quote: { serviceName: { 'zh-cn': 'Original service' }, total: 12300 },
  };
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    calls.push(path);
    return path.includes('public/')
      ? new Response(JSON.stringify({ error: { code: 'UNAVAILABLE' } }), { status: 503 })
      : new Response(JSON.stringify(order));
  });
  const result = await loadCustomerBookings('private-order');
  assert.deepEqual(result.bookings, [order]);
  assert.equal(await result.catalog, undefined);
  assert.equal(calls.length, 2);
});
test('a failed private order request stays an error instead of becoming an empty list', async (t) => {
  t.mock.method(globalThis, 'fetch', async (path: string) =>
    path.includes('public/')
      ? new Response(JSON.stringify({ listings: [], stores: [], offerings: [] }))
      : new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 }),
  );
  await assert.rejects(
    loadCustomerBookings('not-owned'),
    (e) => e instanceof ClientError && e.code === 'NOT_FOUND',
  );
});
test('the booking list can load without public supply and detail identifiers are encoded', async (t) => {
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    paths.push(path);
    if (path.includes('public/')) throw new TypeError('Network unavailable');
    return new Response(
      JSON.stringify(path === '/v1/bookings' ? [{ id: 'one' }] : { id: 'with/slash' }),
    );
  });
  assert.deepEqual((await loadCustomerBookings()).bookings, [{ id: 'one' }]);
  assert.deepEqual((await loadCustomerBookings('with/slash')).bookings, [{ id: 'with/slash' }]);
  assert.ok(paths.includes('/v1/bookings/with%2Fslash'));
});
