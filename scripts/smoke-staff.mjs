import { advanceVisit, confirmVisit } from './qa-clock.mjs';
import assert from 'node:assert/strict';
const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000',
  apiOrigin = process.env.SMOKE_API_ORIGIN;
if (!apiOrigin) throw new Error('Run staff checks through npm run smoke:isolated.');
let checks = 0;
function check(value, message) {
  assert.ok(value, message);
  checks++;
}
async function call(cookie, path, method = 'GET', body, expected = 200, key) {
  const response = await fetch(`${apiOrigin}/v1/${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie && path !== 'auth/demo' ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value)}`);
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
const staff = await login('STAFF', { staffId: 'staff-aoi' }),
  mio = await login('STAFF', { staffId: 'staff-mio' }),
  owner = await login('MERCHANT', { storeId: 'store-nagi' }),
  other = await login('MERCHANT', { storeId: 'store-mori' }),
  customer = await login('CUSTOMER');
await call('', 'staff/workspace', 'GET', undefined, 401);
await call(customer, 'staff/workspace', 'GET', undefined, 403);
let s = await call(staff, 'staff/workspace');
check(
  s.listing.staffId === 'staff-aoi' && !('pspAccount' in s.store) && !('totals' in s),
  'own private workspace',
);
const available = await call(
  null,
  'public/staff-listings/listing-aoi/availability?offeringId=store-nagi-60',
);
const slot = available.slots.find((x) => x > Date.now() + 6 * 3600000);
check(slot, 'future time-off slot');
const requestBody = { startAt: slot - 30 * 60000, endAt: slot + 90 * 60000, reason: 'TIME_OFF' };
let r = await call(staff, 'staff/time-off-requests', 'POST', requestBody, 201, 'staff-smoke-leave');
check(
  (await call(staff, 'staff/time-off-requests', 'POST', requestBody, 201, 'staff-smoke-leave'))
    .id === r.id,
  'retry returns same request',
);
await call(
  staff,
  'staff/time-off-requests',
  'POST',
  { ...requestBody, reason: 'BREAK' },
  409,
  'staff-smoke-leave',
);
check(
  (
    await call(null, 'public/staff-listings/listing-aoi/availability?offeringId=store-nagi-60')
  ).slots.includes(slot),
  'pending does not block booking',
);
await call(
  staff,
  `staff/time-off-requests/${r.id}`,
  'PUT',
  { version: 1, decision: 'APPROVED' },
  403,
);
await call(
  mio,
  `staff/time-off-requests/${r.id}`,
  'PUT',
  { version: 1, decision: 'WITHDRAWN' },
  404,
);
await call(
  other,
  `merchant/time-off-requests/${r.id}`,
  'PUT',
  { version: 1, decision: 'APPROVED' },
  404,
);
await call(
  owner,
  `merchant/time-off-requests/${r.id}`,
  'PUT',
  { version: 99, decision: 'APPROVED' },
  409,
);
r = await call(owner, `merchant/time-off-requests/${r.id}`, 'PUT', {
  version: 1,
  decision: 'APPROVED',
});
check(r.status === 'APPROVED' && r.blockId, 'shop approval creates block');
check(
  !(
    await call(null, 'public/staff-listings/listing-aoi/availability?offeringId=store-nagi-60')
  ).slots.includes(slot),
  'approved time is not bookable',
);
check(
  (await call(mio, 'staff/workspace')).requests.every((x) => x.id !== r.id),
  'other staff cannot enumerate request',
);
const block = (await call(owner, 'merchant/workspace')).blocks.find((x) => x.id === r.blockId);
await call(staff, `merchant/time-blocks/${block.id}`, 'DELETE', { version: block.version }, 403);
await call(owner, `merchant/time-blocks/${block.id}`, 'DELETE', { version: block.version });
check(
  (
    await call(null, 'public/staff-listings/listing-aoi/availability?offeringId=store-nagi-60')
  ).slots.includes(slot),
  'shop release restores capacity',
);
const w = await call(
  staff,
  'staff/time-off-requests',
  'POST',
  requestBody,
  201,
  'staff-smoke-withdraw',
);
await call(staff, `staff/time-off-requests/${w.id}`, 'PUT', {
  version: w.version,
  decision: 'WITHDRAWN',
});
await call(
  owner,
  `merchant/time-off-requests/${w.id}`,
  'PUT',
  { version: 1, decision: 'APPROVED' },
  409,
);
const original = s.listing.dutyUpdatedAt;
await call(staff, 'staff/duty-status', 'PUT', { onDuty: true, expectedAt: original });
await call(staff, 'staff/duty-status', 'PUT', { onDuty: false, expectedAt: original }, 409);
const instant = await call(
  null,
  'public/staff-listings/listing-aoi/availability?offeringId=store-nagi-60&mode=INSTANT',
);
check(instant.slots.length > 0, 'fresh standby enables instant visits');
async function book(mode, startAt, key) {
  const q = await call(
    customer,
    'quotes',
    'POST',
    {
      listingId: 'listing-aoi',
      offeringId: 'store-nagi-60',
      bookingMode: mode,
      nominationType: 'NOMINATED',
      startAt,
      area: 'shinjuku',
      requiredLanguage: '',
    },
    201,
  );
  const h = await call(customer, 'booking-holds', 'POST', { quoteId: q.id }, 201),
    p = await call(customer, 'payments/demo-authorizations', 'POST', {
      holdId: h.id,
      challengePassed: true,
    });
  return call(
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
        name: 'Staff QA',
        type: 'HOTEL',
        area: 'shinjuku',
        detail: 'Staff QA sample address',
        hotelName: 'Sample Hotel',
        room: 'STAFF-101',
        hotelPermission: true,
      },
    },
    201,
    key,
  );
}
let b = await book('INSTANT', instant.slots[0], 'staff-smoke-instant');
check(!(await call(staff, `bookings/${b.id}`)).address, 'address hidden before ack');
await call(mio, `staff/tasks/${b.id}/ack`, 'POST', { version: b.version, arrivalMinutes: 30 }, 404);
await call(
  staff,
  `staff/tasks/${b.id}/ack`,
  'POST',
  { version: b.version, arrivalMinutes: 10 },
  400,
);
b = await call(staff, `staff/tasks/${b.id}/ack`, 'POST', {
  version: b.version,
  arrivalMinutes: 30,
});
check(
  b.arrivalMinutes === 30 && b.address.room === 'STAFF-101',
  'chosen ETA and confirmed address',
);
const messages = await call(staff, `staff/tasks/${b.id}/messages`, 'POST', {
  text: 'I have confirmed the visit details.',
});
check(messages.length > 0, 'task messaging');
b = await call(staff, 'staff/safety-alerts', 'POST', {
  bookingId: b.id,
  version: b.version,
  type: 'SOS',
});
check(
  (await call(staff, 'staff/workspace')).safety.some(
    (x) => x.bookingId === b.id && x.type === 'SOS',
  ),
  'own SOS visible',
);
for (const event of ['EN_ROUTE', 'ARRIVED', 'START', 'COMPLETE']) {
  await advanceVisit(b, event);
  b = await call(staff, `staff/tasks/${b.id}/events`, 'POST', { version: b.version, event });
}
b = await confirmVisit(customer, b);
b = await call(staff, `bookings/${b.id}`, 'GET');
check(
  b.status === 'COMPLETED' && b.paymentStatus === 'PAID' && !b.address,
  'complete captures demo payment and hides address',
);
await call(
  staff,
  `staff/tasks/${b.id}/events`,
  'POST',
  { version: b.version, event: 'COMPLETE' },
  409,
);
await call(staff, `staff/tasks/${b.id}/messages`, 'GET', undefined, 403);
let declined = await book('SCHEDULED', slot, 'staff-smoke-decline');
declined = await call(staff, `staff/tasks/${declined.id}/decline`, 'POST', {
  version: declined.version,
  reason: 'transport: travel disruption',
});
check(
  declined.staffTaskStatus === 'DECLINED' && !declined.address,
  'structured reason leaves rearrangement to shop',
);
await call(
  staff,
  `staff/tasks/${declined.id}/events`,
  'POST',
  { version: declined.version, event: 'EN_ROUTE' },
  409,
);
await call(owner, `merchant/bookings/${declined.id}/cancel`, 'POST', { version: declined.version });
s = await call(staff, 'staff/workspace');
await call(staff, 'staff/duty-status', 'PUT', {
  onDuty: false,
  expectedAt: s.listing.dutyUpdatedAt,
});
for (const locale of ['ja', 'en', 'zh-cn']) {
  const response = await fetch(`${origin}/${locale}/staff?tab=schedule`);
  const html = await response.text();
  check(response.ok && html.includes('noindex'), 'private localized staff page');
}
console.log(`Staff HTTP smoke passed: ${checks} checks.`);
