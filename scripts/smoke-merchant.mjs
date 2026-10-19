import { advanceVisit, confirmVisit } from './qa-clock.mjs';
import assert from 'node:assert/strict';
const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000';
const apiOrigin = process.env.SMOKE_API_ORIGIN;
if (!apiOrigin) throw new Error('Run merchant checks through npm run smoke:isolated.');
let checks = 0;
const check = (value, message) => {
  assert.ok(value, message);
  checks++;
};
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
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  checks++;
  return data;
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
const owner = await login('MERCHANT', { storeId: 'store-nagi' }),
  other = await login('MERCHANT', { storeId: 'store-mori' }),
  customer = await login('CUSTOMER'),
  staff = await login('STAFF', { staffId: 'staff-aoi' });
let workspace = await call(owner, 'merchant/workspace');
check(
  workspace.store.id === 'store-nagi' && !('pspAccount' in workspace.store),
  'scoped workspace',
);
check(
  workspace.listings.every((x) => x.storeId === 'store-nagi'),
  'scoped team',
);
await call(customer, 'merchant/workspace', 'GET', undefined, 403);
const availability = await call(
  null,
  'public/staff-listings/listing-aoi/availability?offeringId=store-nagi-60',
);
const start = availability.slots.find((s) => s > Date.now() + 5 * 3600_000);
check(start, 'future slot');
const quote = await call(
  customer,
  'quotes',
  'POST',
  {
    listingId: 'listing-aoi',
    offeringId: 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt: start,
    area: 'shinjuku',
    requiredLanguage: '',
  },
  201,
);
const hold = await call(customer, 'booking-holds', 'POST', { quoteId: quote.id }, 201),
  payment = await call(customer, 'payments/demo-authorizations', 'POST', {
    holdId: hold.id,
    challengePassed: true,
  });
let booking = await call(
  customer,
  'bookings',
  'POST',
  {
    holdId: hold.id,
    quoteId: quote.id,
    paymentId: payment.id,
    termsAccepted: true,
    policyVersion: quote.cancellationPolicy.version,
    address: {
      name: 'Merchant QA',
      area: 'shinjuku',
      type: 'HOTEL',
      detail: 'Merchant QA sample address',
      hotelName: 'Sample Hotel',
      room: 'QA-101',
      hotelPermission: true,
    },
  },
  201,
  'merchant-smoke-order',
);
const candidates = await call(owner, `merchant/bookings/${booking.id}/assignment-candidates`);
check(
  candidates.every((x) => x.storeId === 'store-nagi' && x.staffId !== 'staff-aoi'),
  'real assignment pool',
);
await call(other, `merchant/bookings/${booking.id}/assignment-candidates`, 'GET', undefined, 404);
const blockInput = {
  listingId: 'listing-mio',
  startAt: start - 30 * 60000,
  endAt: start + 90 * 60000,
  reason: 'TRAINING',
};
const block = await call(
  owner,
  'merchant/time-blocks',
  'POST',
  blockInput,
  201,
  'merchant-smoke-block',
);
check(
  (await call(owner, 'merchant/time-blocks', 'POST', blockInput, 201, 'merchant-smoke-block'))
    .id === block.id,
  'block retry',
);
await call(other, `merchant/time-blocks/${block.id}`, 'DELETE', { version: 1 }, 404);
check(
  !(await call(owner, `merchant/bookings/${booking.id}/assignment-candidates`)).some(
    (x) => x.id === 'listing-mio',
  ),
  'blocked team excluded',
);
await call(
  owner,
  'merchant/time-blocks',
  'POST',
  { ...blockInput, listingId: 'listing-aoi' },
  409,
  'merchant-overlap-key',
);
await call(owner, `merchant/time-blocks/${block.id}`, 'DELETE', { version: 99 }, 409);
await call(owner, `merchant/time-blocks/${block.id}`, 'DELETE', { version: 1 });
const service = workspace.offerings.find((x) => x.id === 'store-nagi-60');
await call(
  other,
  `merchant/services/${service.id}`,
  'PUT',
  {
    version: service.version,
    price: service.price,
    transportFee: service.transportFee,
    active: true,
  },
  404,
);
let changed = await call(owner, `merchant/services/${service.id}`, 'PUT', {
  version: service.version,
  price: service.price + 100,
  transportFee: service.transportFee,
  active: false,
});
check(
  !(await call(null, 'public/staff-listings')).offerings.some((x) => x.id === service.id),
  'paused service removed',
);
await call(
  owner,
  `merchant/services/${service.id}`,
  'PUT',
  {
    version: service.version,
    price: service.price,
    transportFee: service.transportFee,
    active: true,
  },
  409,
);
await call(owner, `merchant/services/${service.id}`, 'PUT', {
  version: changed.version,
  price: service.price,
  transportFee: service.transportFee,
  active: true,
});
const rules = await call(owner, 'merchant/settings', 'PUT', {
  version: workspace.store.ruleVersion,
  acceptanceMode: 'MANUAL',
  emergencyContact: workspace.store.emergencyContact,
});
await call(
  owner,
  'merchant/settings',
  'PUT',
  {
    version: workspace.store.ruleVersion,
    acceptanceMode: 'MANUAL',
    emergencyContact: workspace.store.emergencyContact,
  },
  409,
);
await call(owner, 'merchant/settings', 'PUT', {
  version: rules.ruleVersion,
  acceptanceMode: workspace.store.acceptanceMode,
  emergencyContact: workspace.store.emergencyContact,
  confirmAuthorization: true,
});
booking = await call(staff, `staff/tasks/${booking.id}/ack`, 'POST', { version: booking.version });
for (const event of ['EN_ROUTE', 'ARRIVED', 'START', 'COMPLETE']) {
  await advanceVisit(booking, event);
  booking = await call(staff, `staff/tasks/${booking.id}/events`, 'POST', {
    version: booking.version,
    event,
  });
}
booking = await confirmVisit(customer, booking);
check(booking.capturedAmount === quote.total, 'submitted quote remains frozen');
booking = await call(owner, `merchant/bookings/${booking.id}/refunds`, 'POST', {
  version: booking.version,
  amount: 1000,
});
check(booking.refundedAmount === 1000, 'partial refund');
const summary = await call(owner, 'merchant/workspace');
check(
  summary.totals.net === summary.totals.captured - summary.totals.refunded,
  'transactional financial totals',
);
check(
  summary.feeEntries.every((x) => x.storeId === 'store-nagi'),
  'scoped ledger',
);
await call(owner, `merchant/bookings/${booking.id}/refunds`, 'POST', {
  version: booking.version,
  amount: booking.capturedAmount - booking.refundedAmount,
});
for (const locale of ['ja', 'en', 'zh-cn']) {
  const response = await fetch(`${origin}/${locale}/merchant?tab=schedule`);
  check(response.ok, 'merchant SSR');
  check((await response.text()).includes('noindex'), 'private workspace');
}
console.log(
  `PASS: ${checks} merchant HTTP / SSR assertions. Changes restored; test booking fully refunded.`,
);
