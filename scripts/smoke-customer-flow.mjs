import { advanceVisit, confirmVisit } from './qa-clock.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.SMOKE_API_ORIGIN,
  origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000';
if (!base) throw Error('Run smoke:isolated; customer flow writes require a disposable API.');
let checks = 0;
const check = (v, message) => {
  assert.ok(v, message);
  checks++;
};
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
  });
  const data = await r.json();
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
await call('', 'customer/addresses', undefined, 'GET', 401);
const customer = await login('CUSTOMER'),
  shop = await login('MERCHANT'),
  staff = await login('STAFF'),
  admin = await login('ADMIN');
for (const actor of [shop, staff, admin])
  await call(actor, 'customer/addresses', undefined, 'GET', 403);
let book = await call(customer, 'customer/addresses');
const key = randomUUID(),
  address = {
    version: book.version,
    label: 'Smoke hotel',
    setDefault: true,
    address: {
      name: 'QA Guest',
      area: 'shinjuku',
      type: 'HOTEL',
      detail: 'Isolated QA building 123',
      hotelName: 'QA Hotel',
    },
  };
book = await call(customer, 'customer/addresses', address, 'POST', 201, key);
const id = book.items.find((a) => a.label === 'Smoke hotel').id;
check(book.defaultId === id, 'Default is the created hotel');
check(
  (await call(customer, 'customer/addresses', address, 'POST', 201, key)).items.length ===
    book.items.length,
  'Create retry has no duplicate',
);
await call(
  customer,
  `customer/addresses/${id}`,
  { ...address, version: book.version - 1 },
  'PUT',
  409,
);
const edited = { ...address, version: book.version, label: 'Edited hotel' };
book = await call(customer, `customer/addresses/${id}`, edited, 'PUT');
await call(
  customer,
  'customer/addresses',
  { ...address, version: book.version, address: { ...address.address, room: '201' } },
  'POST',
  422,
  randomUUID(),
);
check(
  !JSON.stringify(book).includes('hotelPermission') && !JSON.stringify(book).includes('customerId'),
  'Static private address contract',
);
const q = await call(
  customer,
  'quotes',
  {
    listingId: 'listing-aoi',
    offeringId: 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt: Date.now() + 5 * 86400000 + 4 * 3600000,
    area: 'shinjuku',
  },
  'POST',
  201,
);
const h = await call(customer, 'booking-holds', { quoteId: q.id }, 'POST', 201);
const holdView = await call(customer, `booking-holds/${h.id}`);
check(
  holdView.serverNow > 0 &&
    holdView.hold.expiresAt - holdView.serverNow > 0 &&
    holdView.hold.expiresAt - holdView.serverNow <= 600000,
  'Checkout countdown uses a current server-time snapshot',
);
check(
  (await call(customer, `booking-holds/${h.id}/submission`)).bookingId === null,
  'No order before submission',
);
const p = await call(customer, 'payments/demo-authorizations', {
  holdId: h.id,
  challengePassed: true,
});
const body = {
    quoteId: q.id,
    holdId: h.id,
    paymentId: p.id,
    termsAccepted: true,
    policyVersion: q.cancellationPolicy.version,
    address: { ...address.address, room: '201', hotelPermission: true },
  },
  submitKey = randomUUID();
let b = await call(customer, 'bookings', body, 'POST', 201, submitKey);
check(
  (await call(customer, 'bookings', body, 'POST', 201, submitKey)).id === b.id,
  'Submission replay returns same order',
);
check(
  (await call(customer, `booking-holds/${h.id}/submission`)).bookingId === b.id,
  'Submitted hold recovers original order',
);
await call(shop, `booking-holds/${h.id}/submission`, undefined, 'GET', 403);
check(
  !(await call(customer, `customer/bookings/${b.id}/care`)).canRequest,
  'Authorization is not refundable capture',
);
await call(
  customer,
  `customer/bookings/${b.id}/refund-requests`,
  {
    bookingVersion: b.version,
    amount: 1000,
    reason: 'This authorization is not a charge.',
    locale: 'en',
  },
  'POST',
  409,
  randomUUID(),
);
b = await call(staff, `staff/tasks/${b.id}/ack`, { version: b.version });
for (const event of ['EN_ROUTE', 'ARRIVED', 'START', 'COMPLETE']) {
  await advanceVisit(b, event);
  b = await call(staff, `staff/tasks/${b.id}/events`, { version: b.version, event });
}
b = await confirmVisit(customer, b);
check(b.status === 'COMPLETED' && b.capturedAmount > 1000, 'Isolated demo capture exists');
const claim = {
    bookingVersion: b.version,
    amount: 2000,
    reason: 'Please review the service issue and refund evidence.',
    locale: 'en',
  },
  claimKey = randomUUID();
let request = await call(
  customer,
  `customer/bookings/${b.id}/refund-requests`,
  claim,
  'POST',
  201,
  claimKey,
);
check(
  (await call(customer, `customer/bookings/${b.id}/refund-requests`, claim, 'POST', 201, claimKey))
    .id === request.id,
  'Request replay shares one case',
);
let detail = await call(shop, `support-tickets/${request.ticketId}/refund-request`);
check(
  detail.request.id === request.id && detail.remaining === b.capturedAmount,
  'Original shop sees linked balance',
);
await call(staff, `support-tickets/${request.ticketId}/refund-request`, undefined, 'GET', 403);
check(
  (await call(customer, `support-tickets/${request.ticketId}`)).refundPending,
  'Pending request blocks ordinary case completion',
);
const approve = {
    version: request.version,
    bookingVersion: detail.bookingVersion,
    action: 'APPROVE',
    amount: 1000,
    text: 'The shop approves a partial refund after reviewing the case.',
  },
  decisionKey = randomUUID();
await call(admin, `refund-requests/${request.id}/decision`, approve, 'POST', 403, randomUUID());
request = await call(
  shop,
  `refund-requests/${request.id}/decision`,
  approve,
  'POST',
  200,
  decisionKey,
);
check(
  request.status === 'PARTIALLY_APPROVED' && request.approvedAmount === 1000,
  'Partial outcome is explicit',
);
await call(shop, `refund-requests/${request.id}/decision`, approve, 'POST', 200, decisionKey);
let care = await call(customer, `customer/bookings/${b.id}/care`);
check(
  care.refunded === 1000 && care.remaining === b.capturedAmount - 1000 && care.canRequest,
  'Approval retries do not duplicate refunds',
);
check(
  (await call(customer, `support-tickets/${request.ticketId}`)).ticket.status === 'RESOLVED',
  'Normal case resolved with refund',
);
b = (await call(customer, 'bookings')).find((x) => x.id === b.id);
check(
  care.bookingVersion === b.version,
  'Care balance identifies the current original booking version',
);
request = await call(
  customer,
  `customer/bookings/${b.id}/refund-requests`,
  { ...claim, bookingVersion: b.version, amount: 500 },
  'POST',
  201,
  randomUUID(),
);
await call(
  customer,
  `refund-requests/${request.id}/decision`,
  {
    version: request.version,
    bookingVersion: b.version,
    action: 'WITHDRAW',
    amount: 0,
    text: 'I withdraw this request after checking the existing outcome.',
  },
  'POST',
  200,
  randomUUID(),
);
care = await call(customer, `customer/bookings/${b.id}/care`);
check(
  care.refunded === 1000 && care.requests.some((x) => x.status === 'WITHDRAWN'),
  'Withdrawal preserves payment balance',
);
book = await call(customer, 'customer/addresses');
book = await call(customer, `customer/addresses/${id}`, { version: book.version }, 'DELETE');
check(!book.items.some((a) => a.id === id), 'Address removed without changing booked snapshot');
check(
  (await call(customer, 'bookings')).find((x) => x.id === b.id).address.room === '201',
  'Historical visit retains own per-visit snapshot',
);
for (const [locale, lang] of [
  ['ja', 'ja-JP'],
  ['en', 'en'],
  ['zh-cn', 'zh-CN'],
]) {
  const r = await fetch(`${origin}/${locale}/account/addresses`),
    html = await r.text();
  check(
    r.ok && html.includes(`<html lang="${lang}"`) && html.includes('noindex'),
    `${locale} private address SSR`,
  );
}
console.log(
  `Customer flow HTTP smoke passed: ${checks} checks. Addresses, checkout recovery and original-shop refund workflow verified.`,
);
