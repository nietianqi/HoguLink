import { advanceVisit, confirmVisit } from './qa-clock.mjs';
import assert from 'node:assert/strict';
const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000',
  apiOrigin = process.env.SMOKE_API_ORIGIN;
if (!apiOrigin) throw new Error('Run administrator checks through npm run smoke:isolated.');
let checks = 0;
function check(value, message) {
  assert.ok(value, message);
  checks++;
}
async function call(cookie, path, method = 'GET', body, expected = 200, key) {
  const r = await fetch(`${apiOrigin}/v1/${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie && path !== 'auth/demo' ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await r.json();
  assert.equal(r.status, expected, `${method} ${path}: ${JSON.stringify(value)}`);
  checks++;
  return value;
}
async function login(role, extra = {}) {
  const r = await fetch(`${apiOrigin}/v1/auth/demo`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, ...extra }),
  });
  check(r.ok, 'sign in');
  return r.headers.get('set-cookie').split(';')[0];
}
const admin = await login('ADMIN'),
  owner = await login('MERCHANT', { storeId: 'store-nagi' }),
  customer = await login('CUSTOMER'),
  staff = await login('STAFF', { staffId: 'staff-aoi' });
await call('', 'admin/workspace', 'GET', undefined, 401);
const reason = 'ADMIN_PRIVATE_NOTE: Reviewed local demo records and the effect of the decision.';
for (const cookie of [owner, customer, staff]) {
  await call(cookie, 'admin/workspace', 'GET', undefined, 403);
  await call(
    cookie,
    'admin/reviews',
    'POST',
    { targetType: 'STORE', targetId: 'store-nagi', decision: 'SUSPEND', version: 1, reason },
    403,
  );
}
let s = await call(admin, 'admin/workspace');
check(
  s.stores.every((x) => !('pspAccount' in x)),
  'payment routing omitted',
);
const av = await call(
  null,
  'public/staff-listings/listing-aoi/availability?offeringId=store-nagi-60',
);
const slot = av.slots.find((x) => x > Date.now() + 8 * 3600000);
check(slot, 'future test slot');
const makeQuote = (startAt) =>
  call(
    customer,
    'quotes',
    'POST',
    {
      listingId: 'listing-aoi',
      offeringId: 'store-nagi-60',
      bookingMode: 'SCHEDULED',
      nominationType: 'NOMINATED',
      startAt,
      area: 'shinjuku',
      requiredLanguage: '',
    },
    201,
  );
const q = await makeQuote(slot),
  h = await call(customer, 'booking-holds', 'POST', { quoteId: q.id }, 201),
  p = await call(customer, 'payments/demo-authorizations', 'POST', {
    holdId: h.id,
    challengePassed: true,
  });
let b = await call(
  customer,
  'bookings',
  'POST',
  {
    quoteId: q.id,
    holdId: h.id,
    paymentId: p.id,
    termsAccepted: true,
    policyVersion: q.cancellationPolicy.version,
    address: {
      name: 'Admin HTTP QA',
      area: 'shinjuku',
      type: 'HOTEL',
      detail: 'Private admin sample address',
      hotelName: 'Sample Hotel',
      room: 'ADMIN-HTTP-101',
      hotelPermission: true,
    },
  },
  201,
  'admin-smoke-booking',
);
const pending = await makeQuote(slot + 6 * 3600000);
async function review(targetType, targetId, decision) {
  const snap = await call(admin, 'admin/workspace'),
    key = targetType === 'STORE' ? 'stores' : targetType === 'LISTING' ? 'listings' : 'offerings',
    target = snap[key].find((x) => x.id === targetId),
    version = targetType === 'OFFERING' ? target.version : target.moderationVersion;
  return call(admin, 'admin/reviews', 'POST', { targetType, targetId, decision, version, reason });
}
const paused = await review('STORE', 'store-nagi', 'SUSPEND');
check(
  !(await call(null, 'public/staff-listings')).stores.some((x) => x.id === 'store-nagi'),
  'shop suspension stops discovery',
);
await call(customer, 'booking-holds', 'POST', { quoteId: pending.id }, 409);
check((await call(customer, `bookings/${b.id}`)).status === b.status, 'submitted order preserved');
await call(
  admin,
  'admin/reviews',
  'POST',
  {
    targetType: 'STORE',
    targetId: 'store-nagi',
    decision: 'APPROVE',
    version: paused.previousVersion,
    reason,
  },
  409,
);
await review('STORE', 'store-nagi', 'APPROVE');
const stale = await call(customer, 'booking-holds', 'POST', { quoteId: pending.id }, 409);
check(stale.error.code === 'SHOP_RULES_CHANGED', 'old quote stays stale after restore');
await review('LISTING', 'listing-aoi', 'SUSPEND');
check(
  !(await call(null, 'public/staff-listings')).listings.some((x) => x.id === 'listing-aoi'),
  'therapist suspension removes discovery',
);
await review('LISTING', 'listing-aoi', 'APPROVE');
await review('OFFERING', 'store-nagi-60', 'REJECT');
check(
  !(await call(null, 'public/staff-listings')).offerings.some((x) => x.id === 'store-nagi-60'),
  'rejected service is not public',
);
await review('OFFERING', 'store-nagi-60', 'APPROVE');
await call(
  admin,
  'admin/reviews',
  'POST',
  {
    targetType: 'STORE',
    targetId: 'store-nagi',
    decision: 'SUSPEND',
    version: 999,
    reason: 'short',
  },
  422,
);
b = await call(staff, `staff/tasks/${b.id}/ack`, 'POST', { version: b.version });
b = await call(staff, 'staff/safety-alerts', 'POST', {
  bookingId: b.id,
  version: b.version,
  type: 'SOS',
});
const first = await call(
  customer,
  'customer/support-tickets',
  'POST',
  {
    bookingId: b.id,
    category: 'SERVICE_QUALITY',
    subject: 'Admin smoke ordinary case',
    description: 'Please review the local service explanation and confirm the next step.',
  },
  201,
  'admin-smoke-case-one',
);
const second = await call(
  customer,
  'customer/support-tickets',
  'POST',
  {
    bookingId: b.id,
    category: 'FINANCIAL',
    subject: 'Admin smoke private case',
    description: 'This private financial report belongs only to the platform reviewers.',
  },
  201,
  'admin-smoke-case-two',
);
s = await call(admin, 'admin/workspace');
const order = s.bookings.find((x) => x.id === b.id);
check(
  !('address' in order) &&
    !('customerId' in order) &&
    !('customerId' in order.quote) &&
    !('paymentId' in order) &&
    !('holdId' in order),
  'order view minimizes visit identity',
);
check(
  s.cases.some((x) => x.id === second.id && x.visibility === 'PLATFORM_ONLY'),
  'platform sees private case',
);
check(
  !('description' in s.cases.find((x) => x.id === second.id)) &&
    !('customerId' in s.cases.find((x) => x.id === second.id)),
  'queue omits narrative and customer ID',
);
check(
  !JSON.stringify({ audit: s.audit, queue: s.system.queue }).includes('ADMIN_PRIVATE_NOTE'),
  'private review notes stay out of audit and queue',
);
const event = s.safety.find((x) => x.bookingId === b.id && x.status === 'OPEN');
check(event, 'open SOS visible');
await call(
  owner,
  `admin/safety-events/${event.id}/resolve`,
  'POST',
  { version: event.version, text: 'The shop cannot close a platform safety review.' },
  403,
);
const resolved = await call(admin, `admin/safety-events/${event.id}/resolve`, 'POST', {
  version: event.version,
  text: 'Reviewed the local test event and confirmed the sample task context.',
});
check(resolved.status === 'RESOLVED', 'safety handling recorded');
await call(
  admin,
  `admin/safety-events/${event.id}/resolve`,
  'POST',
  { version: event.version, text: 'Repeated stale resolution should fail.' },
  409,
);
for (const ticket of [first, second])
  await call(admin, `support-tickets/${ticket.id}/actions`, 'POST', {
    version: ticket.version,
    action: 'RESOLVE',
    text: 'Reviewed and resolved this local test case without changing payment state.',
  });
for (const event of ['EN_ROUTE', 'ARRIVED', 'START', 'COMPLETE']) {
  await advanceVisit(b, event);
  b = await call(staff, `staff/tasks/${b.id}/events`, 'POST', { version: b.version, event });
}
b = await confirmVisit(customer, b);
b = await call(owner, `merchant/bookings/${b.id}/refunds`, 'POST', {
  version: b.version,
  amount: 1000,
});
s = await call(admin, 'admin/workspace');
check(
  s.feeEntries.some((x) => x.bookingId === b.id && x.type === 'REFUND' && x.amount < 0),
  'partial refund has negative fee reversal',
);
check(s.bookings.find((x) => x.id === b.id).refundedAmount === 1000, 'refund fact visible');
check(
  s.system.notifications === 'DEMO_LOCAL_ONLY' && s.system.pending > 0,
  'notification adapter is truthfully disconnected',
);
b = await call(owner, `merchant/bookings/${b.id}/refunds`, 'POST', {
  version: b.version,
  amount: b.capturedAmount - b.refundedAmount,
});
check(b.paymentStatus === 'REFUNDED', 'test booking fully refunded');
for (const locale of ['ja', 'en', 'zh-cn'])
  for (const tab of ['overview', 'orders', 'review', 'safety', 'finance', 'audit', 'system']) {
    const r = await fetch(`${origin}/${locale}/admin?tab=${tab}`),
      html = await r.text();
    check(r.ok && html.includes('noindex'), `${locale} ${tab} private page`);
  }
console.log(
  `Admin HTTP smoke passed: ${checks} checks. Review changes restored; test booking fully refunded.`,
);
