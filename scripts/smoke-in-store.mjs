import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { advanceTo, advanceVisit, bookable } from './qa-clock.mjs';
const base = process.env.SMOKE_API_ORIGIN,
  origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000';
if (!base || !process.env.SMOKE_CLOCK_TOKEN) throw new Error('Use the isolated smoke harness.');
let checks = 0;
const check = (value, label) => {
  assert.ok(value, label);
  checks++;
};
async function call(
  cookie,
  path,
  body,
  status = 200,
  method = body === undefined ? 'GET' : 'POST',
) {
  const r = await fetch(`${base}/v1/${path}`, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie,
      ...(body === undefined
        ? {}
        : { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await r.json();
  assert.equal(r.status, status, `${path}: ${JSON.stringify(value)}`);
  checks++;
  return value;
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
const c = await login('CUSTOMER'),
  m = await login('MERCHANT'),
  a = await login('ADMIN'),
  s = await login('STAFF', { staffId: 'staff-aoi' }),
  other = await login('MERCHANT', { storeId: 'store-mori' });
const draft = {
  version: 0,
  enabled: true,
  address: 'QA disposable venue in Shinjuku (test data)',
  area: 'shinjuku',
  latitude: 35.69,
  longitude: 139.7,
  contact: '03-0000-0000',
  directions: 'Disposable fixture only',
  photos: ['/images/h5-home-banner.png'],
  businessHours: { startMinute: 540, endMinute: 1320 },
  turnoverMinutes: 15,
  nominationFee: 300,
  resources: [{ id: 'test-bed', name: 'QA bed', active: true }],
};
let venue = await call(m, 'merchant/venue', draft, 200, 'PUT');
check(venue.status === 'PENDING', 'New venue needs platform review');
await call(c, 'merchant/venue', draft, 403, 'PUT');
await call(c, 'admin/venues', undefined, 403);
let catalog = await call('', 'public/staff-listings?fulfillmentMode=IN_STORE');
check(!catalog.stores.length, 'An unapproved venue cannot sell appointments');
const workspace = await call(m, 'merchant/workspace');
const source = workspace.offerings.find((o) => o.id === 'store-nagi-60');
await call(
  m,
  'merchant/team/listing-aoi/service-modes',
  { modes: ['HOME_VISIT', 'IN_STORE'] },
  200,
  'PUT',
);
await call(
  m,
  'merchant/team/listing-mio/service-modes',
  { modes: ['HOME_VISIT', 'IN_STORE'] },
  200,
  'PUT',
);
await call(
  m,
  'merchant/services/store-nagi-60/in-store',
  { version: source.version, price: 6000 },
  201,
);
const queue = await call(a, 'admin/venues');
check(
  queue.some((x) => x.storeId === workspace.store.id && x.venue.status === 'PENDING'),
  'Platform receives venue review',
);
venue = await call(a, `admin/venues/${workspace.store.id}/review`, {
  version: venue.version,
  decision: 'APPROVED',
  note: 'Checked the disposable reception fixture, location and capacity.',
});
catalog = await call('', 'public/staff-listings?fulfillmentMode=IN_STORE');
check(
  catalog.offerings.some((o) => o.id === 'store-nagi-60-in-store' && o.price === 6000),
  'Mode-specific menu is public',
);
check(
  catalog.stores.find((x) => x.id === workspace.store.id).venue.capacity === 1,
  'Only public capacity is exposed',
);
check(
  !('resources' in catalog.stores.find((x) => x.id === workspace.store.id).venue),
  'Internal resource names are private',
);
// Venue photos are platform uploads, private until an approved venue shows them.
const pixel =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
async function photoStatus(cookie, url) {
  const r = await fetch(`${base}${url}`, { headers: cookie ? { Cookie: cookie } : {} });
  await r.arrayBuffer();
  return r.status;
}
const uploaded = await call(m, 'merchant/venue/photos', { mime: 'image/png', data: pixel }, 201);
check((await photoStatus('', uploaded.url)) === 404, 'An unreviewed venue photo is not public');
check((await photoStatus(m, uploaded.url)) === 200, 'The uploading shop can preview its photo');
check((await photoStatus(other, uploaded.url)) === 404, 'Another shop cannot see the photo');
await call(
  m,
  'merchant/venue',
  { ...draft, version: venue.version, photos: ['https://example.com/front.jpg'] },
  422,
  'PUT',
);
const edited = await call(
  m,
  'merchant/venue',
  { ...draft, version: venue.version, photos: [uploaded.url] },
  200,
  'PUT',
);
check(edited.status === 'PENDING', 'Changed photos wait for review');
check(
  (await call('', 'public/staff-listings?fulfillmentMode=IN_STORE')).stores.some(
    (x) => x.id === workspace.store.id,
  ),
  'The approved venue keeps taking bookings during the review',
);
venue = await call(a, `admin/venues/${workspace.store.id}/review`, {
  version: edited.version,
  decision: 'APPROVED',
  note: 'Checked the uploaded reception photo.',
});
check((await photoStatus('', uploaded.url)) === 200, 'An approved venue photo is public');
const service = {
  listingId: 'listing-aoi',
  offeringId: 'store-nagi-60-in-store',
  fulfillmentMode: 'IN_STORE',
  bookingMode: 'SCHEDULED',
  nominationType: 'NOMINATED',
  startAt: bookable(Date.now() + 3 * 3600000),
  requiredLanguage: '',
};
const availability = await call(
  '',
  `public/stores/${workspace.store.slug}/free-availability?fulfillmentMode=IN_STORE&offeringId=${service.offeringId}`,
);
check(availability.slots.length > 0, 'Shop-arranged in-store appointments have times');
const directory = await call('', 'public/h5/therapists?fulfillmentMode=IN_STORE&duration=60');
check(
  directory.items.some((x) => x.total === 6300 && x.transportFee === 0 && !x.badges.instantNow),
  'H5 total uses in-store fees',
);
const q = await call(c, 'quotes', service, 201);
check(
  q.total === 6300 && q.transportFee === 0 && q.venue.address === draft.address,
  'Quote freezes price and actual venue',
);
const q2 = await call(c, 'quotes', { ...service, listingId: 'listing-mio' }, 201);
const h = await call(c, 'booking-holds', { quoteId: q.id }, 201);
const calendarPath = `merchant/venue/calendar?date=${new Date(q.startAt + 9 * 3600000).toISOString().slice(0, 10)}`;
check(
  (await call(m, calendarPath)).entries.some(
    (row) => row.phase === 'CHECKOUT_HOLD' && row.resourceId === h.resourceId,
  ),
  'Calendar shows the temporary resource reservation',
);
await call(c, calendarPath, undefined, 403);
check(!(await call(other, calendarPath)).entries.length, 'Calendar is scoped to the merchant shop');
await call(c, 'booking-holds', { quoteId: q2.id }, 409);
const payment = await call(c, 'payments/demo-authorizations', {
  holdId: h.id,
  challengePassed: true,
});
await call(
  c,
  'bookings',
  {
    quoteId: q.id,
    holdId: h.id,
    paymentId: payment.id,
    termsAccepted: true,
    policyVersion: q.cancellationPolicy.version,
  },
  400,
);
let b = await call(
  c,
  'bookings',
  {
    quoteId: q.id,
    holdId: h.id,
    paymentId: payment.id,
    termsAccepted: true,
    policyVersion: q.cancellationPolicy.version,
    contact: { name: 'QA Guest', phone: '090-0000-0000' },
  },
  201,
);
check(
  !b.address &&
    b.resourceId &&
    b.resourceName === 'QA bed' &&
    b.checkInCode &&
    b.contact.name === 'QA Guest',
  'In-store booking needs contact, no residential address',
);
b = await call(m, `merchant/bookings/${b.id}/accept`, { version: b.version });
b = await call(s, `staff/tasks/${b.id}/ack`, { version: b.version });
b = await call(c, `bookings/${b.id}`);
check(
  !(await call(m, `bookings/${b.id}`)).checkInCode,
  'Merchant does not receive the customer code',
);
check(!(await call(s, `bookings/${b.id}`)).checkInCode, 'Staff does not receive the customer code');
const current = await call(c, `bookings/${b.id}`);
await call(
  other,
  `merchant/bookings/${b.id}/check-in`,
  { version: current.version, code: current.checkInCode },
  404,
);
await advanceTo(current.quote.startAt);
await call(
  m,
  `merchant/bookings/${b.id}/check-in`,
  { version: current.version, code: '000000000000' },
  409,
);
await call(s, `staff/tasks/${b.id}/events`, { version: current.version, event: 'EN_ROUTE' }, 409);
await call(s, `staff/tasks/${b.id}/events`, { version: current.version, event: 'START' }, 409);
b = await call(m, `merchant/bookings/${b.id}/check-in`, {
  version: current.version,
  code: current.checkInCode,
});
check(b.checkIn && !b.startedAt, 'Check-in does not start service');
await call(
  m,
  `merchant/bookings/${b.id}/check-in`,
  { version: b.version, code: current.checkInCode },
  409,
);
b = await call(s, `staff/tasks/${b.id}/events`, { version: b.version, event: 'START' });
const activeCalendar = await call(m, calendarPath);
check(
  activeCalendar.entries.some(
    (row) => row.bookingId === b.id && row.phase === 'IN_SERVICE' && row.ongoing,
  ),
  'Calendar shows the running service',
);
check(
  !JSON.stringify(activeCalendar).includes('QA Guest') &&
    !JSON.stringify(activeCalendar).includes(current.checkInCode),
  'Calendar does not disclose customer contact or verification code',
);
await call(s, `staff/tasks/${b.id}/events`, { version: b.version, event: 'COMPLETE' }, 409);
await advanceVisit(b, 'COMPLETE');
b = await call(s, `staff/tasks/${b.id}/events`, { version: b.version, event: 'COMPLETE' });
check(
  b.status === 'AWAITING_COMPLETION' && b.capturedAmount === 0,
  'Staff completion still requires acceptance',
);
b = await call(c, `bookings/${b.id}/completion`, {
  version: b.version,
  action: 'CONFIRM',
  expectedAmount: q.total,
});
check(
  b.status === 'COMPLETED' && b.capturedAmount === 6300,
  'Customer confirms once through the existing completion flow',
);
const rebook = await call(c, `customer/bookings/${b.id}/rebook`);
check(rebook.fulfillmentMode === 'IN_STORE', 'Rebooking preserves service mode');
const w = await call(m, 'merchant/workspace');
await call(m, 'merchant/home-visits', { version: w.store.ruleVersion, enabled: false }, 200, 'PUT');
check(
  (
    await call(
      '',
      `public/stores/${w.store.slug}/free-availability?fulfillmentMode=IN_STORE&offeringId=${service.offeringId}`,
    )
  ).slots.length > 0,
  'In-store only shops retain shop-arranged booking',
);
for (const locale of ['ja', 'en', 'zh-cn'])
  for (const path of ['', '/services', '/therapists', '/discover?tab=shops']) {
    const url = `${origin}/${locale}${path}${path.includes('?') ? '&' : '?'}fulfillmentMode=IN_STORE`;
    const r = await fetch(url);
    const html = await r.text();
    check(r.status === 200, `${locale} in-store SSR ${path}`);
    check(html.includes('fulfillmentMode'), `${locale} preserves mode in public links`);
  }
console.log(
  `In-store HTTP smoke passed: ${checks} checks. Review, capacity, checkout, check-in, service, acceptance and rebooking verified with disposable data.`,
);
