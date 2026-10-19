import './qa-clock.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000',
  base = process.env.SMOKE_API_ORIGIN;
if (!base) throw Error('Use smoke:isolated; engagement checks require a disposable API.');
let checks = 0;
function check(value, message) {
  assert.ok(value, message);
  checks++;
}
async function call(
  cookie,
  path,
  body,
  method = body === undefined ? 'GET' : 'POST',
  status = 200,
  key,
) {
  const r = await fetch(`${base}/v1/${path}`, {
      method,
      headers: {
        Origin: origin,
        ...(cookie && path !== 'auth/demo' ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    data = await r.json();
  assert.equal(r.status, status, `${path}: ${JSON.stringify(data)}`);
  checks++;
  return data;
}
async function login(role) {
  const r = await fetch(`${base}/v1/auth/demo`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  assert.equal(r.status, 200);
  checks++;
  return r.headers.get('set-cookie').split(';')[0];
}
for (const path of ['customer/inbox', 'customer/store-favorites'])
  await call('', path, undefined, 'GET', 401);
const customer = await login('CUSTOMER'),
  merchant = await login('MERCHANT'),
  staff = await login('STAFF'),
  admin = await login('ADMIN');
for (const actor of [merchant, staff, admin])
  for (const path of ['customer/inbox', 'customer/store-favorites'])
    await call(actor, path, undefined, 'GET', 403);
const favorite = await call(customer, 'customer/store-favorites/store-nagi');
const saved = await call(
  customer,
  'customer/store-favorites/store-nagi',
  { version: favorite.version, active: true },
  'PUT',
);
const favorites = await call(customer, 'customer/store-favorites');
check(
  favorites.some((f) => f.storeId === 'store-nagi' && f.available),
  'Saved eligible shop is listed',
);
check(
  !JSON.stringify(favorites).includes('pspAccount') &&
    !JSON.stringify(favorites).includes('emergencyContact'),
  'No private routing or safety contacts',
);
await call(
  customer,
  'customer/store-favorites/store-nagi',
  { version: favorite.version, active: false },
  'PUT',
  409,
);
await call(
  customer,
  'customer/store-favorites/store-nagi',
  { version: saved.version, active: false },
  'PUT',
);
check(
  !(await call(customer, 'customer/store-favorites')).some((f) => f.storeId === 'store-nagi'),
  'Remove persists',
);
const bookings = await call(customer, 'bookings'),
  b = bookings.find((b) => b.storeId === 'store-nagi');
check(b, 'Existing isolated booking fixture');
const inbox = await call(customer, 'customer/inbox'),
  item = inbox.items.find((i) => i.targetId === b.id);
check(item && item.unread, 'Real order becomes an inbox thread');
check(
  !JSON.stringify(inbox).includes('address') &&
    !JSON.stringify(inbox).includes('customerId') &&
    !JSON.stringify(inbox).includes('paymentId'),
  'Inbox has minimal private summaries',
);
const readBody = { items: [{ id: item.id, token: item.token }] };
await call(customer, 'customer/inbox/read', readBody);
check(
  !(await call(customer, 'customer/inbox')).items.find((i) => i.id === item.id).unread,
  'Read state persists',
);
await call(merchant, `merchant/bookings/${b.id}/messages`, {
  text: 'Smoke provider reply for the private order conversation.',
});
const stale = await call(customer, 'customer/inbox/read', readBody);
check(stale.stale.includes(item.id), 'New reply cannot be lost to a stale read');
const changed = (await call(customer, 'customer/inbox')).items.find((i) => i.id === item.id);
check(changed.unread && changed.token !== item.token, 'Reply returns to unread');
await call(customer, 'customer/inbox?cursor=invalid', undefined, 'GET', 400);
await call(customer, 'customer/inbox/read', { items: [] }, 'POST', 422);
const ticket = await call(
  customer,
  'customer/support-tickets',
  {
    category: 'PRIVACY',
    subject: 'Isolated inbox privacy check',
    description: 'Please verify this private case remains in its authorized customer conversation.',
  },
  'POST',
  201,
  randomUUID(),
);
const support = await call(customer, 'customer/inbox?filter=support');
check(
  support.items.some((i) => i.targetId === ticket.id),
  'Private requester-owned case has an authorized inbox entry',
);
check(
  support.items.every((i) => i.kind === 'SUPPORT'),
  'Support filter contains no bookings',
);
check(
  !JSON.stringify(support).includes('Isolated inbox privacy check'),
  'Inbox omits complaint subject and evidence',
);
for (const [locale, lang] of [
  ['ja', 'ja-JP'],
  ['en', 'en'],
  ['zh-cn', 'zh-CN'],
])
  for (const path of [
    'discover',
    'discover?tab=shops',
    'account/messages',
    'account/favorites?type=shops',
    'guides/choose-your-visit',
    'guides/nomination-and-shop-assignment',
    'guides/a-considered-first-visit',
  ]) {
    const r = await fetch(`${origin}/${locale}/${path}`),
      html = await r.text();
    check(r.ok, `${locale}/${path} serves`);
    check(html.includes(`<html lang="${lang}"`), `${locale}/${path} locale`);
    check(html.includes('noindex'), `${locale}/${path} demo indexing boundary`);
  }
console.log(
  `Engagement HTTP smoke passed: ${checks} checks. Discovery, store collections, private inbox and snapshot read receipts verified.`,
);
