import test from 'node:test';
import assert from 'node:assert/strict';
import { instantServiceMembers } from '../hogulink-web/src/lib/service-availability';
import { ClientError } from '../hogulink-web/src/lib/api';

test('instant project selection excludes providers outside the chosen area or language', async (t) => {
  const calls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const url = new URL(input, 'http://localhost');
    calls.push(url);
    // The provider serves Tokyo, but its automatic rule covers only this menu/ward/language.
    const eligible =
      url.pathname.includes('/eligible/') &&
      url.searchParams.get('area') === 'taito' &&
      url.searchParams.get('language') === 'zh' &&
      url.searchParams.get('offeringId') === 'menu-90' &&
      url.searchParams.get('mode') === 'INSTANT';
    return new Response(JSON.stringify({ slots: eligible ? [1792454400000] : [] }));
  });
  const eligible = { id: 'eligible', name: 'Allowed' },
    busy = { id: 'busy', name: 'Busy' };
  assert.deepEqual(
    await instantServiceMembers([eligible, busy], 'menu-90', { area: 'taito', language: 'zh' }),
    [eligible],
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(
    await instantServiceMembers([eligible], 'menu-90', { area: 'shinjuku', language: 'zh' }),
    [],
  );
  assert.deepEqual(
    await instantServiceMembers([eligible], 'menu-90', { area: 'taito', language: 'en' }),
    [],
  );
});

test('failed instant availability does not silently advertise an unchecked provider', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Retry' } }), {
        status: 503,
      }),
  );
  await assert.rejects(
    () => instantServiceMembers([{ id: 'eligible' }], 'menu-90', { area: 'taito' }),
    (e) => e instanceof ClientError && e.code === 'UNAVAILABLE',
  );
});
