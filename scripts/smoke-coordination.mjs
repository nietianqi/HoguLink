import { advanceVisit, confirmVisit } from './qa-clock.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.SMOKE_API_ORIGIN,
  origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000';
if (!base) throw Error('Use smoke:isolated with disposable data.');
let checks = 0;
const check = (v, m) => {
  assert.ok(v, m);
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
    }),
    d = await r.json();
  assert.equal(r.status, status, `${path}: ${JSON.stringify(d)}`);
  checks++;
  return d;
}
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
await call('', 'staff/handoffs', undefined, 'GET', 401);
const customer = await login('CUSTOMER'),
  shop = await login('MERCHANT', { storeId: 'store-mori' }),
  foreign = await login('MERCHANT', { storeId: 'store-nagi' }),
  yuki = await login('STAFF', { staffId: 'staff-yuki' }),
  saki = await login('STAFF', { staffId: 'staff-saki' }),
  admin = await login('ADMIN');
async function book(days, nominationType = 'NOMINATED') {
  const q = await call(
      customer,
      'quotes',
      {
        listingId: 'listing-yuki',
        offeringId: 'store-mori-60',
        bookingMode: 'SCHEDULED',
        nominationType,
        startAt: Date.now() + days * 86400000,
        area: 'shinjuku',
      },
      'POST',
      201,
    ),
    h = await call(customer, 'booking-holds', { quoteId: q.id }, 'POST', 201),
    p = await call(customer, 'payments/demo-authorizations', {
      holdId: h.id,
      challengePassed: true,
    });
  return call(
    customer,
    'bookings',
    {
      quoteId: q.id,
      holdId: h.id,
      paymentId: p.id,
      termsAccepted: true,
      policyVersion: q.cancellationPolicy.version,
      address: {
        name: 'QA Guest',
        type: 'HOTEL',
        area: 'shinjuku',
        detail: 'Isolated QA building',
        hotelName: 'QA Hotel',
        room: 'QA-201',
        hotelPermission: true,
      },
    },
    'POST',
    201,
    randomUUID(),
  );
}
let b = await book(2);
check(
  b.status === 'REQUESTED' && b.staffTaskStatus === 'NOT_SENT',
  'Manual contract acceptance is separate from task acknowledgement',
);
await call(yuki, `staff/tasks/${b.id}/ack`, { version: b.version }, 'POST', 409);
for (const cookie of [foreign, admin])
  await call(cookie, `bookings/${b.id}/coordination`, undefined, 'GET', 404);
b = await call(shop, `merchant/bookings/${b.id}/accept`, { version: b.version });
check(b.status === 'ACCEPTED' && b.staffTaskStatus === 'OFFERED', 'Shop accepted and offered task');
b = await call(yuki, `staff/tasks/${b.id}/ack`, { version: b.version });
const body = {
    bookingVersion: b.version,
    topic: 'AFTERCARE_FACTS',
    text: 'Private task facts required by the original shop.',
  },
  key = randomUUID();
let h = await call(shop, `bookings/${b.id}/handoffs`, body, 'POST', 201, key);
check(
  (await call(shop, `bookings/${b.id}/handoffs`, body, 'POST', 201, key)).id === h.id,
  'Retry creates one cooperation record',
);
await call(customer, `bookings/${b.id}/handoffs`, body, 'POST', 403, randomUUID());
await call(
  saki,
  `work-handoffs/${h.id}/actions`,
  {
    version: h.version,
    action: 'REPLY',
    text: 'I am not the addressed therapist for this original task.',
  },
  'POST',
  404,
  randomUUID(),
);
b = await call(yuki, `staff/tasks/${b.id}/withdraw`, {
  version: b.version,
  reason: 'QA sudden schedule conflict; shop must arrange with customer.',
});
check(
  b.status === 'CONFIRMED' && b.replacementConsent === 'PENDING' && !b.proposedListingId,
  'Withdrawal preserves confirmed order awaiting shop',
);
b = await call(shop, `merchant/bookings/${b.id}/replacement-proposals`, {
  version: b.version,
  listingId: 'listing-saki',
});
await call(yuki, `staff/tasks/${b.id}/messages`, undefined, 'GET', 403);
const deadline = b.replacementDeadline;
b = await call(shop, `merchant/bookings/${b.id}/replacement-withdrawal`, {
  version: b.version,
  reason: 'Review the proposed candidate before requesting consent again.',
});
check(
  !b.proposedListingId && b.replacementDeadline === deadline,
  'Withdraw candidate retains consent deadline',
);
await call(
  customer,
  `customer/bookings/${b.id}/replacement-consent`,
  { version: b.version, approved: true },
  'POST',
  409,
);
b = await call(shop, `merchant/bookings/${b.id}/replacement-proposals`, {
  version: b.version,
  listingId: 'listing-saki',
});
b = await call(customer, `customer/bookings/${b.id}/replacement-consent`, {
  version: b.version,
  approved: true,
});
check(
  b.assignedStaffId === 'staff-saki' &&
    b.selectedStaffId === 'staff-yuki' &&
    b.quote.nominationFee === 0,
  'Customer explicit consent applies replacement and waives nomination',
);
await call(yuki, `bookings/${b.id}`, undefined, 'GET', 404);
const oldInbox = await call(yuki, 'staff/handoffs');
check(
  oldInbox.some((x) => x.id === h.id) && !JSON.stringify(oldInbox).includes('address'),
  'Original therapist retains only private minimal cooperation',
);
h = await call(
  yuki,
  `work-handoffs/${h.id}/actions`,
  {
    version: h.version,
    action: 'REPLY',
    text: 'The original task could not proceed and the shop arranged a replacement.',
  },
  'POST',
  200,
  randomUUID(),
);
await call(
  shop,
  `work-handoffs/${h.id}/actions`,
  {
    version: h.version,
    action: 'RESOLVE',
    text: 'Recorded original task facts; replacement is handled on the order.',
  },
  'POST',
  200,
  randomUUID(),
);
b = await call(saki, `staff/tasks/${b.id}/ack`, { version: b.version });
for (const event of ['EN_ROUTE', 'ARRIVED', 'START', 'COMPLETE']) {
  await advanceVisit(b, event);
  b = await call(saki, `staff/tasks/${b.id}/events`, { version: b.version, event });
}
b = await confirmVisit(customer, b);
check(
  b.status === 'COMPLETED' && b.capturedAmount === 8200,
  'Replacement therapist completes and captures adjusted amount in demo',
);
const refund = await call(
  customer,
  `customer/bookings/${b.id}/refund-requests`,
  {
    bookingVersion: b.version,
    amount: 2000,
    reason: 'Please review actual service facts with the assigned therapist.',
    locale: 'en',
  },
  'POST',
  201,
  randomUUID(),
);
let summary = await call(shop, `bookings/${b.id}/coordination`);
check(
  summary.cases.some((t) => t.id === refund.ticketId && t.refundPending),
  'Merchant order links exact pending refund case',
);
h = await call(
  shop,
  `bookings/${b.id}/handoffs`,
  {
    bookingVersion: b.version,
    topic: 'AFTERCARE_FACTS',
    ticketId: refund.ticketId,
    text: 'Confirm the service facts before the shop decides the refund.',
  },
  'POST',
  201,
  randomUUID(),
);
h = await call(
  saki,
  `work-handoffs/${h.id}/actions`,
  {
    version: h.version,
    action: 'REPLY',
    text: 'The completed service facts are supplied only to the original shop.',
  },
  'POST',
  200,
  randomUUID(),
);
await call(
  shop,
  `work-handoffs/${h.id}/actions`,
  {
    version: h.version,
    action: 'RESOLVE',
    text: 'Facts received; refund decision remains a separate case action.',
  },
  'POST',
  200,
  randomUUID(),
);
check(
  (await call(customer, `support-tickets/${refund.ticketId}`)).refundPending,
  'Cooperation resolution does not close pending customer refund',
);
const financial = await call(shop, `support-tickets/${refund.ticketId}/refund-request`);
await call(
  shop,
  `refund-requests/${refund.id}/decision`,
  {
    version: refund.version,
    bookingVersion: financial.bookingVersion,
    action: 'APPROVE',
    amount: 1000,
    text: 'Reviewed the therapist facts and approve this partial refund.',
  },
  'POST',
  200,
  randomUUID(),
);
const care = await call(customer, `customer/bookings/${b.id}/care`);
check(
  care.refunded === 1000 && care.remaining === 7200,
  'Customer sees real partial refund balance',
);
summary = await call(customer, `bookings/${b.id}/coordination`);
check(
  summary.handoffs.length === 0 && !JSON.stringify(summary).includes('Private task facts'),
  'Customer never receives private handoff text',
);
check(
  summary.timeline.some((t) => t.action === 'REPLACEMENT_APPROVED') &&
    summary.timeline.some((t) => t.action === 'STAFF_COMPLETE') &&
    summary.timeline.some((t) => t.action === 'DEMO_REFUND_SUCCEEDED'),
  'Customer history includes actual reassignment, fulfillment and refund',
);
let f = await book(3, 'FREE');
f = await call(shop, `merchant/bookings/${f.id}/accept`, { version: f.version });
f = await call(shop, `merchant/bookings/${f.id}/assignments`, {
  version: f.version,
  listingId: 'listing-saki',
});
check(
  f.selectedStaffId === null &&
    f.assignedStaffId === 'staff-saki' &&
    f.replacementConsent === 'NOT_REQUIRED',
  'Free-choice order is assigned within original shop without a consent fiction',
);
f = await call(saki, `staff/tasks/${f.id}/ack`, { version: f.version });
check(f.status === 'CONFIRMED', 'Assigned free-choice task confirms normally');
for (const l of ['ja', 'en', 'zh-cn'])
  for (const path of ['merchant?tab=bookings', 'staff?tab=tasks']) {
    const r = await fetch(`${origin}/${l}/${path}`);
    check(r.ok, `${l}/${path} serves`);
  }
console.log(
  `Coordination HTTP smoke passed: ${checks} checks. Manual acceptance, replacement withdrawal/consent, therapist handoffs, fulfillment and refund linkage verified.`,
);
