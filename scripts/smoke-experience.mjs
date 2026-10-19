import { advanceVisit, confirmVisit } from './qa-clock.mjs';
import assert from 'node:assert/strict';
const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000',
  base = process.env.SMOKE_API_ORIGIN;
if (!base) throw Error('Use npm run smoke:isolated; these checks require an isolated API.');
let checks = 0;
const check = (value, message) => {
  assert.ok(value, message);
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
await call('', 'customer/favorites', undefined, 'GET', 401);
const customer = await login('CUSTOMER'),
  shop = await login('MERCHANT'),
  staff = await login('STAFF'),
  admin = await login('ADMIN');
await call(customer, 'fulfillment/safety', undefined, 'GET', 403);
await call(shop, 'customer/favorites', undefined, 'GET', 403);
await call(staff, 'admin/experience', undefined, 'GET', 403);
await call('', 'customer/overview', undefined, 'GET', 401);
for (const cookie of [shop, staff, admin])
  await call(cookie, 'customer/overview', undefined, 'GET', 403);
const initialHub = await call(customer, 'customer/overview');
check(
  Object.values(initialHub.counts).every((n) => Number.isSafeInteger(n) && n >= 0) &&
    !JSON.stringify(initialHub).includes('customerId'),
  'Private overview has real counts and no customer identity fields',
);
const state = await call(customer, 'customer/favorites/listing-aoi');
const favorite = await call(
  customer,
  'customer/favorites/listing-aoi',
  { version: state.version, active: true },
  'PUT',
);
check(
  (await call(customer, 'customer/favorites')).some(
    (f) => f.listingId === 'listing-aoi' && f.available,
  ),
  'Current favorites only',
);
await call(
  customer,
  'customer/favorites/listing-aoi',
  { version: state.version, active: false },
  'PUT',
  409,
);
const q = await call(
  customer,
  'quotes',
  {
    listingId: 'listing-aoi',
    offeringId: 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt: Date.now() + 6 * 86400000,
    area: 'shinjuku',
    requiredLanguage: 'en',
  },
  'POST',
  201,
);
const h = await call(customer, 'booking-holds', { quoteId: q.id }, 'POST', 201),
  p = await call(
    customer,
    'payments/demo-authorizations',
    { holdId: h.id, challengePassed: true },
    'POST',
    200,
  );
const pendingHub = await call(customer, 'customer/overview');
check(
  pendingHub.resumeCheckout?.holdId === h.id && pendingHub.counts.checkout >= 1,
  'Unsubmitted live hold can be resumed',
);
let b = await call(
  customer,
  'bookings',
  {
    quoteId: q.id,
    holdId: h.id,
    paymentId: p.id,
    termsAccepted: true,
    policyVersion: q.cancellationPolicy.version,
    address: {
      name: 'Isolated Experience Guest',
      area: 'shinjuku',
      type: 'HOTEL',
      detail: 'Private isolated address',
      hotelName: 'Demo hotel',
      room: 'QA-201',
      hotelPermission: true,
    },
  },
  'POST',
  201,
  crypto.randomUUID(),
);
const scores = { punctuality: 4, communication: 5, explanation: 4, cleanliness: 5, overall: 4 };
const bookedHub = await call(customer, 'customer/overview');
check(
  bookedHub.recent.some((x) => x.id === b.id) && bookedHub.resumeCheckout?.holdId !== h.id,
  'Submitted booking is not represented as an unpaid draft',
);
await call(
  customer,
  `customer/bookings/${b.id}/review`,
  { version: 0, scores, text: 'Genuine service feedback.' },
  'PUT',
  409,
);
const preview = await call(customer, `bookings/${b.id}/cancellation-preview`);
check(preview.fee === 0 && preview.bookingVersion === b.version, 'Server cancellation preview');
b = await call(staff, `staff/tasks/${b.id}/ack`, { version: b.version });
b = await call(
  staff,
  `fulfillment/bookings/${b.id}/delay`,
  { version: b.version, minutes: 180, reason: 'TRAFFIC' },
  'POST',
  400,
).then(() => b); // Estimate cannot precede the original scheduled visit.
for (const event of ['EN_ROUTE', 'ARRIVED', 'START', 'COMPLETE']) {
  await advanceVisit(b, event);
  b = await call(staff, `staff/tasks/${b.id}/events`, { version: b.version, event });
}
b = await confirmVisit(customer, b);
check(b.status === 'COMPLETED' && b.capturedAmount > 0, 'Local demo completion records a charge');
let r = await call(
  customer,
  `customer/bookings/${b.id}/review`,
  { version: 0, scores, text: 'Clear explanation and thoughtful service communication.' },
  'PUT',
);
check(
  (await call(customer, 'customer/overview')).reviewBookingId !== b.id,
  'Pending content review is not a customer review task',
);
check(
  !(await call('', 'public/experiences?listingId=listing-aoi')).items.some((x) => x.id === r.id),
  'Pending reviews stay private',
);
await call(
  shop,
  `merchant/reviews/${r.id}/reply`,
  { version: 0, reviewVersion: r.version, text: 'Thank you for your feedback.' },
  'POST',
  404,
);
const reviewChecks = { privacy: true, appearance: true, claims: true, relevance: true },
  reason = 'Reviewed the actual service feedback and content publication policy.';
await call(
  admin,
  `admin/experience/REVIEW/${r.id}`,
  { version: r.version, decision: 'APPROVE', reason, checks: { ...reviewChecks, privacy: false } },
  'POST',
  400,
);
await call(admin, `admin/experience/REVIEW/${r.id}`, {
  version: r.version,
  decision: 'APPROVE',
  reason,
  checks: reviewChecks,
});
r = (await call(customer, `customer/bookings/${b.id}/experience`)).review;
const publicRow = (await call('', 'public/experiences?listingId=listing-aoi')).items.find(
  (x) => x.id === r.id,
);
check(
  publicRow &&
    !('bookingId' in publicRow) &&
    !('customerId' in publicRow) &&
    !('staffId' in publicRow),
  'Public review strips private identity',
);
const reply = await call(shop, `merchant/reviews/${r.id}/reply`, {
  version: 0,
  reviewVersion: r.version,
  text: 'Thank you. We appreciate your service feedback.',
});
check(
  !(await call('', 'public/experiences?listingId=listing-aoi')).items.find((x) => x.id === r.id)
    .reply,
  'Pending reply stays private',
);
await call(admin, `admin/experience/REPLY/${reply.id}`, {
  version: reply.version,
  decision: 'APPROVE',
  reason,
  checks: reviewChecks,
});
check(
  !!(await call('', 'public/experiences?listingId=listing-aoi')).items.find((x) => x.id === r.id)
    .reply,
  'Reviewed reply publishes',
);
check(
  (await call(staff, 'staff/experience')).items.some((x) => x.id === r.id),
  'Actual staff sees anonymous published feedback',
);
const appeal = await call(shop, `merchant/reviews/${r.id}/appeal`, {
  reviewVersion: r.version,
  reason: 'Please assess the service content against the publication policy.',
});
check(
  (await call('', 'public/experiences?listingId=listing-aoi')).items.some((x) => x.id === r.id),
  'Appeals do not suppress public reviews',
);
await call(admin, `admin/experience/APPEAL/${appeal.id}`, {
  version: appeal.version,
  decision: 'UPHOLD',
  reason,
  checks: reviewChecks,
});
const next = await call(customer, `customer/bookings/${b.id}/rebook`);
check(
  next.listingSlug === 'aoi-tokyo' && !next.quoteId && !next.paymentId && !next.startAt,
  'Rebook uses a fresh selection without old transaction state',
);
await call(customer, `customer/reviews/${r.id}/withdraw`, { version: r.version });
check(
  (await call(customer, 'customer/overview')).reviewBookingId === b.id,
  'Withdrawn review becomes an actionable owned service task',
);
check(
  !(await call('', 'public/experiences?listingId=listing-aoi')).items.some((x) => x.id === r.id),
  'Withdrawal immediately hides review and reply',
);
await call(
  customer,
  'customer/favorites/listing-aoi',
  { version: favorite.version, active: false },
  'PUT',
);
b = await call(customer, `bookings/${b.id}`);
await call(shop, `merchant/bookings/${b.id}/refunds`, {
  version: b.version,
  amount: b.capturedAmount,
});
for (const [locale, lang] of [
  ['ja', 'ja-JP'],
  ['en', 'en'],
  ['zh-cn', 'zh-CN'],
])
  for (const path of ['services', 'account', 'account/history']) {
    const res = await fetch(`${origin}/${locale}/${path}`),
      html = await res.text();
    check(res.ok, `${locale}/${path} serves`);
    check(html.includes(`<html lang="${lang}"`), `${locale}/${path} language`);
    check(html.includes('noindex'), `${locale}/${path} demo privacy/SEO boundary`);
  }
console.log(
  `Experience HTTP smoke passed: ${checks} checks. Reviews, replies, appeals, favorites, rebooking and cancellation preview verified in memory.`,
);
