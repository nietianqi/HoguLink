import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ClientError } from '../hogulink-web/src/lib/api';
import { flowDraftPrefix } from '../hogulink-web/src/lib/customer-flow-model';
import { safeAccountReturn, ca } from '../hogulink-web/src/lib/customer-auth-i18n';
test('account return URLs reject external origins and recursive authentication routes', () => {
  for (const value of [
    'https://evil.example',
    '//evil.example',
    '/en/\\evil.example',
    '/en/account/access?returnTo=/en/account',
    '/en/account\n',
  ])
    assert.equal(safeAccountReturn('en', value), '/en/account');
});
test('account return URLs preserve booking choices across all three interface languages', () => {
  for (const l of ['ja', 'en', 'zh-cn'] as const)
    assert.equal(
      safeAccountReturn(l, '/zh-cn/book/aoi?mode=SCHEDULED&area=shinjuku'),
      `/${l}/book/aoi?mode=SCHEDULED&area=shinjuku`,
    );
});
test('customer authentication copy covers each language and provider configuration boundaries', () => {
  for (const l of ['ja', 'en', 'zh-cn'] as const)
    for (const key of [
      'login',
      'register',
      'verify',
      'reset',
      'unavailable',
      'terms',
      'credentials',
    ] as const)
      assert.ok(ca(l, key).length > 1);
  assert.notEqual(ca('ja', 'unavailable'), ca('en', 'unavailable'));
  assert.notEqual(ca('en', 'unavailable'), ca('zh-cn', 'unavailable'));
});

async function browserTest(
  run: (state: {
    values: Map<string, string>;
    events: string[];
    blockStorage: () => void;
  }) => Promise<void>,
) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'),
    previousFetch = globalThis.fetch;
  const values = new Map<string, string>(),
    events: string[] = [];
  const storage = {
    get length() {
      return values.size;
    },
    key: (i: number) => [...values.keys()][i] ?? null,
    removeItem: (k: string) => values.delete(k),
  };
  let blocked = false;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      get sessionStorage() {
        if (blocked) throw new Error('Storage is disabled');
        return storage;
      },
      dispatchEvent: (event: Event) => events.push(event.type),
    },
  });
  try {
    await run({
      values,
      events,
      blockStorage: () => {
        blocked = true;
      },
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}
const json = (body: unknown, status = 200) => Response.json(body, { status });
test('successful sign-in and sign-out remain successful when browser storage is disabled', () =>
  browserTest(async ({ events, blockStorage }) => {
    blockStorage();
    globalThis.fetch = async () => json({ role: 'CUSTOMER', id: 'test-owner' });
    assert.equal((await api<{ role: string }>('auth/demo', { role: 'CUSTOMER' })).role, 'CUSTOMER');
    globalThis.fetch = async () => json({ ok: true });
    await api('auth/logout', {});
    assert.deepEqual(events, ['hogulink-session-changed', 'hogulink-session-changed']);
  }));
test('late unauthorized response from an old session cannot erase a new customer draft', () =>
  browserTest(async ({ values, events }) => {
    let release!: (r: Response) => void;
    globalThis.fetch = async (input) =>
      String(input).includes('/customer/addresses')
        ? new Promise<Response>((r) => {
            release = r;
          })
        : json({ role: 'CUSTOMER', id: 'new-owner' });
    const old = api('customer/addresses');
    await api('auth/demo', { role: 'CUSTOMER' });
    const key = `${flowDraftPrefix}new-owner:hold`;
    values.set(key, 'new private address draft');
    release(json({ error: { code: 'UNAUTHORIZED', message: 'Expired old session' } }, 401));
    await assert.rejects(old, (e) => e instanceof ClientError && e.code === 'UNAUTHORIZED');
    assert.equal(values.get(key), 'new private address draft');
    assert.deepEqual(events, ['hogulink-session-changed']);
  }));
test('current session expiry clears private checkout drafts while a failed login keeps unrelated preferences', () =>
  browserTest(async ({ values, events }) => {
    values.set(`${flowDraftPrefix}owner:hold`, 'private draft');
    values.set('booking-key:old-hold', 'old retry key');
    values.set('language', 'ja');
    globalThis.fetch = async () =>
      json({ error: { code: 'UNAUTHORIZED', message: 'Expired session' } }, 401);
    await assert.rejects(() => api('auth/login', {}));
    assert.equal(values.size, 3);
    assert.equal(events.length, 0);
    await assert.rejects(() => api('customer/addresses'));
    assert.deepEqual([...values], [['language', 'ja']]);
    assert.deepEqual(events, ['hogulink-session-invalid']);
  }));
