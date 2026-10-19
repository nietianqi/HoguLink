import { advanceVisit, confirmVisit } from './qa-clock.mjs';
import assert from 'node:assert/strict';
const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000';
const apiBase = `${process.env.SMOKE_API_ORIGIN || origin}/v1`;
let cookie = '';
let assertions = 0;
function check(value, message) {
  assert.ok(value, message);
  assertions++;
}
async function request(
  path,
  body,
  method = body === undefined ? 'GET' : 'POST',
  expected = 200,
  headers = {},
) {
  const res = await fetch(`${apiBase}/${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie && path !== 'auth/demo' ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  assert.equal(res.status, expected, JSON.stringify(data));
  assertions++;
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return data;
}
const login = (role, extra = {}) => request('auth/demo', { role, ...extra });
check(
  (await request('health')).productionReady === false,
  'demo must not claim production readiness',
);
await request('bookings', undefined, 'GET', 401);
await request('auth/demo', { role: 'CUSTOMER' }, 'POST', 403, {
  Origin: 'https://untrusted.example',
});
const c = await request('public/staff-listings');
check(c.listings.length > 0, 'public demo catalog exists');
check(c.offerings[0].durationMinutes === 60, 'default service is shortest duration');
check(
  c.stores.every((s) => !s.pspAccount && !s.emergencyContact),
  'public catalog strips internal accounts and contacts',
);
await login('CUSTOMER');
const customerCookie = cookie;
await request('quotes', { merchantId: 'forged' }, 'POST', 422);
const startAt = Date.now() + 5 * 24 * 60 * 60_000;
const quote = await request(
  'quotes',
  {
    listingId: 'listing-aoi',
    offeringId: 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt,
    area: 'shinjuku',
    requiredLanguage: 'en',
  },
  'POST',
  201,
);
let hold = await request('booking-holds', { quoteId: quote.id }, 'POST', 201);
const address = {
  name: 'HTTP Demo Guest',
  area: 'shinjuku',
  type: 'HOTEL',
  detail: 'Demo Shinjuku street 123',
  hotelName: 'HTTP Demo Hotel',
  room: 'QA-101',
  hotelPermission: true,
};
const data = {
  holdId: hold.id,
  quoteId: quote.id,
  paymentId: 'forged',
  address,
  termsAccepted: true,
  policyVersion: quote.cancellationPolicy.version,
};
await request('bookings', data, 'POST', 402, { 'Idempotency-Key': crypto.randomUUID() });
await request(
  'payments/demo-authorizations',
  { holdId: hold.id, challengePassed: false },
  'POST',
  402,
);
await request(`booking-holds/${hold.id}`, undefined, 'GET', 409);
await request(
  'payments/demo-authorizations',
  { holdId: hold.id, challengePassed: true },
  'POST',
  409,
);
hold = await request('booking-holds', { quoteId: quote.id }, 'POST', 201);
data.holdId = hold.id;
const payment = await request('payments/demo-authorizations', {
  holdId: hold.id,
  challengePassed: true,
});
const resumed = await request(`booking-holds/${hold.id}`);
check(
  resumed.payment.id === payment.id,
  'payment authentication survives a reload or language switch',
);
data.paymentId = payment.id;
const key = crypto.randomUUID();
let b = await request('bookings', data, 'POST', 201, { 'Idempotency-Key': key });
const retry = await request('bookings', data, 'POST', 201, { 'Idempotency-Key': key });
check(b.id === retry.id, 'HTTP idempotent booking replay');
check(b.status === 'ACCEPTED' && b.merchantAcceptance === 'AUTO_ACCEPTED', 'auto acceptance');
const messages = await request(`customer/bookings/${b.id}/messages`, {
  text: 'Contact +81 90 1111 2222 test@example.com',
});
check(!messages[0].text.includes('@') && !messages[0].text.includes('1111'), 'contact masking');
await login('MERCHANT', { storeId: 'store-mori' });
await request(`bookings/${b.id}`, undefined, 'GET', 404);
await login('STAFF', { staffId: 'staff-ren' });
await request(`bookings/${b.id}`, undefined, 'GET', 404);
await login('STAFF', { staffId: 'staff-aoi' });
check(!(await request(`bookings/${b.id}`)).address, 'address hidden before acknowledgment');
b = await request(`staff/tasks/${b.id}/ack`, { version: b.version });
check(!!b.address, 'address available only during confirmed work');
await request(`staff/tasks/${b.id}/events`, { version: b.version, event: 'COMPLETE' }, 'POST', 409);
for (const event of ['EN_ROUTE', 'ARRIVED', 'START', 'COMPLETE']) {
  await advanceVisit(b, event);
  b = await request(`staff/tasks/${b.id}/events`, { version: b.version, event });
}
b = await confirmVisit(customerCookie, b);
b = await request(`bookings/${b.id}`);
check(
  b.status === 'COMPLETED' && b.paymentStatus === 'PAID',
  'service completion captures the demo payment',
);
check(!b.address, 'completion response redacts address');
await request(`staff/tasks/${b.id}/events`, { version: b.version, event: 'COMPLETE' }, 'POST', 409);
await login('MERCHANT', { storeId: 'store-nagi' });
b = await request(`merchant/bookings/${b.id}/refunds`, {
  version: b.version,
  amount: b.capturedAmount,
});
check(b.paymentStatus === 'REFUNDED', 'merchant refund');
await login('ADMIN');
const dashboard = await request('dashboard');
check(
  dashboard.audit.some((x) => x.bookingId === b.id),
  'audit records persisted',
);
await request('auth/logout', {});
await request('auth/session', undefined, 'GET', 401);
cookie = customerCookie;
await request('auth/logout', {});
cookie = customerCookie;
await request('auth/session', undefined, 'GET', 401);
for (const [locale, lang] of [
  ['ja', 'ja-JP'],
  ['en', 'en'],
  ['zh-cn', 'zh-CN'],
]) {
  const res = await fetch(`${origin}/${locale}`);
  const html = await res.text();
  check(res.ok, `${locale} home serves`);
  check(html.includes(`<html lang="${lang}"`), `${locale} HTML language`);
  check(
    html.includes('rel="canonical"') && html.includes('hrefLang="zh-CN"'),
    `${locale} canonical and language alternates`,
  );
  check(html.includes('noindex'), `${locale} fictional demo is not indexable`);
}
for (const path of [
  '/robots.txt',
  '/sitemap.xml',
  '/sitemap-therapists.xml',
  '/sitemap-shops.xml',
  '/sitemap-areas.xml',
  '/sitemap-services.xml',
  '/sitemap-guides.xml',
])
  check((await fetch(`${origin}${path}`)).ok, `${path} serves`);
const sitemap = await (await fetch(`${origin}/sitemap-therapists.xml`)).text();
check(!sitemap.includes('aoi-tokyo'), 'fictional listings are absent from real sitemap');
const privatePage = await (await fetch(`${origin}/en/checkout/missing`)).text();
check(privatePage.includes('noindex'), 'private routes are noindex');
check(
  (await fetch(`${origin}/ja/therapists/not-a-real-person`)).status === 404,
  'missing therapist is a true HTTP 404',
);
console.log(
  `PASS: ${assertions} HTTP / SSR assertions. Demo booking ${b.id.slice(-8)} was fully refunded.`,
);
