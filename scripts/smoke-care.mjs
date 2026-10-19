import './qa-clock.mjs';
import assert from 'node:assert/strict';
const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000';
const apiOrigin = process.env.SMOKE_API_ORIGIN || origin;
let cookie = '',
  assertions = 0;
let booking, feedback;
let changedRestriction = false,
  changedBlock = false;
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
  const response = await fetch(`${apiOrigin}/v1/${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie && path !== 'auth/demo' ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  assertions++;
  if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return data;
}
const login = (role, extra = {}) => request('auth/demo', { role, ...extra });
const caseAction = (ticket, action, extra = {}) =>
  request(`support-tickets/${ticket.id}/actions`, {
    version: ticket.version,
    action,
    text: 'HTTP demo review completed with documented evidence.',
    ...extra,
  });
const quoteInput = {
  listingId: 'listing-aoi',
  offeringId: 'store-nagi-60',
  bookingMode: 'SCHEDULED',
  nominationType: 'NOMINATED',
  startAt: Date.now() + 9 * 24 * 60 * 60_000,
  area: 'shinjuku',
  requiredLanguage: '',
};
const newQuote = () => ({ ...quoteInput, startAt: quoteInput.startAt + 3 * 60 * 60_000 });
try {
  await login('ADMIN');
  const priorRestriction = (await request('admin/customer-restrictions')).find(
    (r) => r.id === 'demo-customer',
  );
  check(
    !priorRestriction?.active || priorRestriction.expiresAt < Date.now(),
    'Run smoke only with an unrestricted demo customer',
  );
  await login('MERCHANT', { storeId: 'store-nagi' });
  const priorBlock = (await request('merchant/customer-blocks')).find(
    (b) => b.customerId === 'demo-customer',
  );
  check(!priorBlock?.active, 'Run smoke only when the demo customer is not blocked');
  await login('CUSTOMER');
  const quote = await request('quotes', quoteInput, 'POST', 201);
  const hold = await request('booking-holds', { quoteId: quote.id }, 'POST', 201);
  const payment = await request('payments/demo-authorizations', {
    holdId: hold.id,
    challengePassed: true,
  });
  booking = await request(
    'bookings',
    {
      holdId: hold.id,
      quoteId: quote.id,
      paymentId: payment.id,
      address: {
        name: 'Care HTTP Demo',
        area: 'shinjuku',
        type: 'HOTEL',
        detail: 'Demo address 123',
        hotelName: 'Care Demo Hotel',
        room: 'CARE-101',
        hotelPermission: true,
      },
      termsAccepted: true,
      policyVersion: quote.cancellationPolicy.version,
    },
    'POST',
    201,
    { 'Idempotency-Key': crypto.randomUUID() },
  );
  const input = {
    bookingId: booking.id,
    category: 'SERVICE_QUALITY',
    subject: 'HTTP care smoke request',
    description: 'Please review the service explanation in this local HTTP demo.',
  };
  const key = crypto.randomUUID();
  let ordinary = await request('customer/support-tickets', input, 'POST', 201, {
    'Idempotency-Key': key,
  });
  const retry = await request('customer/support-tickets', input, 'POST', 201, {
    'Idempotency-Key': key,
  });
  check(ordinary.id === retry.id, 'case create retries are idempotent');
  let sensitive = await request(
    'customer/support-tickets',
    { ...input, category: 'PRIVACY', subject: 'HTTP confidential report' },
    'POST',
    201,
    { 'Idempotency-Key': crypto.randomUUID() },
  );
  check(sensitive.visibility === 'PLATFORM_ONLY', 'sensitive complaint bypasses shop');
  await login('MERCHANT', { storeId: 'store-mori' });
  await request(`support-tickets/${ordinary.id}`, undefined, 'GET', 404);
  await login('MERCHANT', { storeId: 'store-nagi' });
  await request(`support-tickets/${sensitive.id}`, undefined, 'GET', 404);
  ordinary = await request(`support-tickets/${ordinary.id}/messages`, {
    version: ordinary.version,
    text: 'The shop has provided the requested explanation.',
  });
  check(ordinary.status === 'OPEN', 'shop response is recorded');
  await login('CUSTOMER');
  ordinary = await caseAction(ordinary, 'ESCALATE');
  check(ordinary.status === 'PLATFORM_ESCALATED', 'customer can escalate');
  await login('MERCHANT', { storeId: 'store-nagi' });
  await request(
    `support-tickets/${ordinary.id}/actions`,
    { version: ordinary.version, action: 'RESOLVE', text: 'Shop cannot bypass platform review.' },
    'POST',
    403,
  );
  await login('STAFF', { staffId: 'staff-aoi' });
  feedback = await request(
    'staff/customer-feedback',
    { bookingId: booking.id, text: 'HTTP private staff safety concern for platform review.' },
    'POST',
    201,
  );
  await login('CUSTOMER');
  await request(`support-tickets/${feedback.id}`, undefined, 'GET', 404);
  await request('quotes', newQuote(), 'POST', 403);
  await login('MERCHANT', { storeId: 'store-nagi' });
  await request(`support-tickets/${feedback.id}`, undefined, 'GET', 404);
  let block = (await request('merchant/customer-blocks')).find(
    (x) => x.customerId === 'demo-customer',
  );
  check(block.reviewRequired, 'staff report creates a shop review hold');
  await request(
    'merchant/customer-blocks/demo-customer',
    { active: false, reason: 'Shop attempted to bypass safety review', version: block.version },
    'PUT',
    403,
  );
  await login('ADMIN');
  feedback = await caseAction(feedback, 'RESOLVE', { releaseShopBlock: true });
  ordinary = await caseAction(ordinary, 'RESOLVE');
  sensitive = await caseAction(sensitive, 'RESOLVE');
  await login('CUSTOMER');
  ordinary = await caseAction(ordinary, 'CLOSE');
  check(ordinary.status === 'CLOSED', 'reporter can close the resolved case');
  await request('quotes', newQuote(), 'POST', 201);
  await login('ADMIN');
  let restriction = await request('admin/customer-restrictions', {
    customerId: 'demo-customer',
    active: true,
    reason: 'HTTP private internal investigation reason',
    expiresAt: Date.now() + 60 * 60_000,
    version: priorRestriction?.version ?? 0,
  });
  changedRestriction = true;
  await login('CUSTOMER');
  await request('quotes', newQuote(), 'POST', 403);
  const publicRestriction = (await request('customer/restrictions'))[0];
  check(!('reason' in publicRestriction), 'private restriction rationale is not exposed');
  let appeal = await request(
    'customer/restriction-appeals',
    {
      version: publicRestriction.version,
      text: 'Please reconsider the demo restriction using the available evidence.',
    },
    'POST',
    201,
  );
  await login('MERCHANT', { storeId: 'store-nagi' });
  await request(`support-tickets/${appeal.id}`, undefined, 'GET', 404);
  await login('ADMIN');
  appeal = await caseAction(appeal, 'RESOLVE', { releaseRestriction: true });
  check(appeal.status === 'RESOLVED', 'appeal decision is recorded');
  changedRestriction = false;
  await login('CUSTOMER');
  check((await request('customer/restrictions')).length === 0, 'appeal release restores account');
  await request('quotes', newQuote(), 'POST', 201);
  await login('MERCHANT', { storeId: 'store-nagi' });
  block = (await request('merchant/customer-blocks')).find((x) => x.customerId === 'demo-customer');
  block = await request(
    'merchant/customer-blocks/demo-customer',
    { active: true, reason: 'HTTP shop-only internal block reason', version: block?.version ?? 0 },
    'PUT',
  );
  changedBlock = true;
  await login('CUSTOMER');
  await request('quotes', newQuote(), 'POST', 403);
  await request(
    'quotes',
    { ...newQuote(), listingId: 'listing-yuki', offeringId: 'store-mori-60' },
    'POST',
    201,
  );
  await login('MERCHANT', { storeId: 'store-mori' });
  check(
    !(await request('merchant/customer-blocks')).some((x) => x.customerId === 'demo-customer'),
    'other shop sees no block reason',
  );
  await login('MERCHANT', { storeId: 'store-nagi' });
  await request(
    'merchant/customer-blocks/demo-customer',
    { active: false, reason: 'HTTP shop block reviewed and released', version: block.version },
    'PUT',
  );
  changedBlock = false;
  await login('STAFF', { staffId: 'staff-aoi' });
  const fresh = await request(`bookings/${booking.id}`);
  await request('staff/safety-alerts', {
    bookingId: booking.id,
    version: fresh.version,
    type: 'SOS',
  });
  const safety = (await request('safety-events')).find((x) => x.bookingId === booking.id);
  await login('ADMIN');
  const resolved = await request(`admin/safety-events/${safety.id}/resolve`, {
    version: safety.version,
    text: 'HTTP local response verified the demo safety event.',
  });
  check(resolved.status === 'RESOLVED', 'safety event resolution');
  await login('MERCHANT', { storeId: 'store-nagi' });
  const dashboard = await request('dashboard');
  check(
    !('resolution' in dashboard.safety.find((x) => x.id === safety.id)),
    'legacy dashboard also redacts platform-only safety notes',
  );
  for (const route of [
    '/ja/account/support',
    '/en/merchant/support',
    '/zh-cn/staff/support',
    '/zh-cn/admin/support',
  ]) {
    const response = await fetch(`${origin}${route}`);
    const html = await response.text();
    check(response.ok, `${route} serves`);
    check(html.includes('noindex'), `${route} is private`);
  }
  console.log(
    `PASS: ${assertions} care HTTP / SSR assertions. Cases, restriction appeals, shop isolation and safety handling verified.`,
  );
} finally {
  if (booking) {
    await login('ADMIN');
    if (feedback) {
      const item = (await request(`support-tickets/${feedback.id}`)).ticket;
      if (!['RESOLVED', 'CLOSED'].includes(item.status))
        await caseAction(item, 'RESOLVE', { releaseShopBlock: true });
    }
    if (changedRestriction) {
      const value = (await request('admin/customer-restrictions')).find(
        (x) => x.id === 'demo-customer',
      );
      if (value?.active)
        await request('admin/customer-restrictions', {
          customerId: value.id,
          active: false,
          reason: 'HTTP smoke cleanup released its own restriction',
          expiresAt: value.expiresAt,
          version: value.version,
        });
    }
    await login('MERCHANT', { storeId: 'store-nagi' });
    if (changedBlock) {
      const value = (await request('merchant/customer-blocks')).find(
        (x) => x.customerId === 'demo-customer',
      );
      if (value?.active && !value.reviewRequired)
        await request(
          'merchant/customer-blocks/demo-customer',
          {
            active: false,
            reason: 'HTTP smoke cleanup released its own shop block',
            version: value.version,
          },
          'PUT',
        );
    }
    const value = await request(`bookings/${booking.id}`);
    if (!['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(value.status))
      await request(`merchant/bookings/${booking.id}/cancel`, { version: value.version });
  }
}
