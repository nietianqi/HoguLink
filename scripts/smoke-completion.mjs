import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { advanceVisit, advanceTo, fixtureCall } from './qa-clock.mjs';
const base = process.env.SMOKE_API_ORIGIN,
  origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000';
let checks = 0;
const check = (value, note) => {
  assert.ok(value, note);
  checks++;
};
const call = async (cookie, path, body, status = 200, key = randomUUID()) => {
  const r = await fixtureCall(cookie, path, body, status, key);
  checks++;
  return r;
};
async function login(role, extra = {}) {
  const r = await fetch(`${base}/v1/auth/demo`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, ...extra }),
  });
  assert.equal(r.status, 200);
  checks++;
  return r.headers.get('set-cookie').split(';')[0];
}
const c = await login('CUSTOMER'),
  s = await login('STAFF', { staffId: 'staff-aoi' }),
  otherStaff = await login('STAFF', { staffId: 'staff-mio' }),
  m = await login('MERCHANT'),
  otherShop = await login('MERCHANT', { storeId: 'store-mori' }),
  a = await login('ADMIN');
const note = 'Reviewed service times and the customer report with original order facts.';
async function book() {
  const q = await call(
      c,
      'quotes',
      {
        listingId: 'listing-aoi',
        offeringId: 'store-nagi-60',
        bookingMode: 'SCHEDULED',
        nominationType: 'NOMINATED',
        startAt: Date.now() + 180 * 60000,
        area: 'shinjuku',
      },
      201,
    ),
    h = await call(c, 'booking-holds', { quoteId: q.id }, 201),
    p = await call(c, 'payments/demo-authorizations', { holdId: h.id, challengePassed: true });
  let b = await call(
    c,
    'bookings',
    {
      quoteId: q.id,
      holdId: h.id,
      paymentId: p.id,
      termsAccepted: true,
      policyVersion: q.cancellationPolicy.version,
      address: {
        name: 'Isolated completion QA',
        area: 'shinjuku',
        type: 'HOTEL',
        detail: 'Private completion fixture',
        hotelName: 'QA Hotel',
        room: 'QA-01',
        hotelPermission: true,
      },
    },
    201,
  );
  // Completion checks can advance across the shop's JST automatic-acceptance window.
  // Follow the actual manual decision when required, before asking the therapist to confirm.
  if (b.status === 'REQUESTED')
    b = await call(m, `merchant/bookings/${b.id}/accept`, { version: b.version });
  b = await call(s, `staff/tasks/${b.id}/ack`, { version: b.version });
  for (const event of ['EN_ROUTE', 'ARRIVED'])
    b = await call(s, `staff/tasks/${b.id}/events`, { version: b.version, event });
  return b;
}
const action = (actor, b, action, extra = {}, status = 200, key = randomUUID()) =>
  call(actor, `bookings/${b.id}/completion`, { version: b.version, action, ...extra }, status, key);
async function start(b) {
  await advanceVisit(b, 'START');
  return call(s, `staff/tasks/${b.id}/events`, { version: b.version, event: 'START' });
}
async function request(b) {
  await advanceVisit(b, 'COMPLETE');
  return call(s, `staff/tasks/${b.id}/events`, { version: b.version, event: 'COMPLETE' });
}
let b = await book();
await call('', `bookings/${b.id}/completion`, undefined, 401);
for (const cookie of [otherStaff, otherShop])
  await call(cookie, `bookings/${b.id}/completion`, undefined, 404);
await call(s, `staff/tasks/${b.id}/events`, { version: b.version, event: 'START' }, 409);
b = await start(b);
await call(
  s,
  `staff/tasks/${b.id}/events`,
  { version: b.version, event: 'COMPLETE', completedAt: b.quote.endAt },
  409,
);
await action(c, b, 'CONFIRM', { expectedAmount: b.quote.total }, 409);
for (const actor of [c, m])
  await call(
    actor,
    `${actor === c ? 'customer' : 'merchant'}/bookings/${b.id}/cancel`,
    { version: b.version },
    409,
  );
check((await call(c, `bookings/${b.id}`)).capturedAmount === 0, 'No early capture');
b = await request(b);
check(
  b.status === 'AWAITING_COMPLETION' && b.capturedAmount === 0 && !b.address,
  'Staff request is not completion or capture, and hides address',
);
for (const actor of [s, m, a])
  await action(actor, b, 'CONFIRM', { expectedAmount: b.quote.total }, 403);
await action(c, b, 'CONFIRM', { expectedAmount: b.quote.total - 1 }, 409);
await call(
  c,
  `bookings/${b.id}/completion`,
  { version: b.version, action: 'CONFIRM', expectedAmount: b.quote.total, completedAt: Date.now() },
  422,
);
const privateCustomerNote =
  'PRIVATE_CUSTOMER_COMPLETION_NOTE Please review the original service before capture.';
b = await action(c, b, 'DISPUTE', { note: privateCustomerNote });
for (const actor of [s, a])
  check(
    !JSON.stringify(await call(actor, `bookings/${b.id}/completion`)).includes(privateCustomerNote),
    'Completion metadata hides customer report text from staff and order readers',
  );
for (const actor of [c, m])
  check(
    JSON.stringify(await call(actor, `bookings/${b.id}/completion`)).includes(privateCustomerNote),
    'Customer and original shop can review their shared service issue',
  );
check(
  b.completion.status === 'DISPUTED' && b.capturedAmount === 0 && !!b.completion.ticketId,
  'Dispute holds payment and creates case',
);
check(
  (await call(a, 'admin/order-monitor')).alerts.some(
    (x) => x.kind === 'COMPLETION_REVIEW' && x.bookingId === b.id,
  ),
  'Platform monitor sees completion exception',
);
await action(c, b, 'CONFIRM', { expectedAmount: b.quote.total }, 409);
b = await action(m, b, 'REVIEW', { note });
check(b.capturedAmount === 0, 'Shop review cannot capture');
const payload = { version: b.version, action: 'CONFIRM', expectedAmount: b.quote.total },
  retry = randomUUID();
const copies = await Promise.all([
  call(c, `bookings/${b.id}/completion`, payload, 200, retry),
  call(c, `bookings/${b.id}/completion`, payload, 200, retry),
]);
b = copies[0];
check(
  copies.every((x) => x.status === 'COMPLETED') && b.capturedAmount === b.quote.total,
  'Customer confirmation is atomic and idempotent',
);
await call(
  c,
  `bookings/${b.id}/completion`,
  { ...payload, expectedAmount: b.quote.total - 1 },
  409,
  retry,
);
const billing = await call(m, 'merchant/billing');
check(
  billing.rows.filter((x) => x.bookingId === b.id && x.kind === 'CAPTURE').length === 1,
  'One captured ledger row',
);
let short = await start(await book());
short = await action(s, short, 'EXCEPTION', {
  note: 'The customer requested early termination after service started.',
});
await advanceTo(short.completion.eligibleAt + 1000);
await action(m, short, 'REVIEW', { note }, 409);
await action(c, short, 'CONFIRM', { expectedAmount: short.quote.total }, 409);
short = await action(m, short, 'VOID', { note });
check(
  short.status === 'CANCELLED' && short.paymentStatus === 'VOIDED' && short.capturedAmount === 0,
  'Early-ended visit closes without charge',
);
let overdue = await request(await start(await book()));
await advanceTo(overdue.completion.confirmBy + 1000);
overdue = await call(c, `bookings/${overdue.id}`);
check(
  overdue.completion.status === 'TIMED_OUT' && overdue.capturedAmount === 0,
  'Confirmation timeout never captures',
);
await action(c, overdue, 'CONFIRM', { expectedAmount: overdue.quote.total }, 409);
overdue = await action(m, overdue, 'REVIEW', { note });
overdue = await action(c, overdue, 'CONFIRM', { expectedAmount: overdue.quote.total });
check(overdue.status === 'COMPLETED', 'Reviewed timeout can be explicitly confirmed');
let expired = await request(await start(await book()));
await advanceTo(Date.now() + 8 * 86400000);
expired = await call(c, `bookings/${expired.id}`);
check(
  expired.completion.status === 'PAYMENT_REVIEW' &&
    expired.paymentStatus === 'AUTH_EXPIRED' &&
    expired.capturedAmount === 0,
  'Expired guarantee cannot be charged',
);
expired = await action(c, expired, 'REAUTHORIZE', { expectedAmount: expired.quote.total });
check(
  expired.capturedAmount === 0 && expired.completion.status === 'TIMED_OUT',
  'Renewal captures nothing and preserves overdue review',
);
await action(c, expired, 'CONFIRM', { expectedAmount: expired.quote.total }, 409);
expired = await action(m, expired, 'REVIEW', { note });
expired = await action(c, expired, 'CONFIRM', { expectedAmount: expired.quote.total });
check(
  expired.status === 'COMPLETED',
  'Renewed and reviewed visit can complete with customer confirmation',
);
console.log(
  `Completion HTTP smoke passed: ${checks} checks. Timing, consent, disputes, timeout, reauthorization and single capture verified in memory.`,
);
