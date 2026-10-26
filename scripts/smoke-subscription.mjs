import { advanceVisit, bookable, confirmVisit } from './qa-clock.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.SMOKE_API_ORIGIN,
  origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000';
if (!base) throw Error('Use a disposable isolated API database.');
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
const shops = await call('', 'auth/demo-shops'),
  directory = await call('', 'auth/demo-staff');
check(
  shops.length === 3 && directory.length === 6,
  'Fictional login directory is independent from public exposure',
);
check(
  !JSON.stringify([shops, directory]).includes('pspAccount'),
  'Demo directory omits payment routing',
);
await call('', 'admin/subscriptions', undefined, 'GET', 401);
const c = await login('CUSTOMER'),
  m = await login('MERCHANT', { storeId: 'store-nagi' }),
  s = await login('STAFF', { staffId: 'staff-aoi' }),
  a = await login('ADMIN'),
  foreign = await login('MERCHANT', { storeId: 'store-sora' });
for (const actor of [c, m, s]) await call(actor, 'admin/subscriptions', undefined, 'GET', 403);
for (const actor of [c, s]) await call(actor, 'merchant/subscription', undefined, 'GET', 403);
await call(foreign, 'merchant/subscription?storeId=store-nagi', undefined, 'GET', 404);
await call(m, 'merchant/billing/plan-changes', { plan: 'TRIAL' }, 'POST', 404);
const note =
  'Reviewed the annual charge, merchant choices, payment outcome and preserved existing orders.';
const ws = () => call(m, 'merchant/subscription');
async function change(action, extra = {}, status = 200, key = randomUUID()) {
  const w = await ws();
  return call(
    m,
    'merchant/subscription/store-nagi/actions',
    { version: w.subscription.version, action, note, ...extra },
    'POST',
    status,
    key,
  );
}
async function invoice(action, actor = m, extra = {}, status = 200) {
  const w = await ws(),
    i = w.invoices.find((i) => i.status === 'OPEN');
  return call(
    actor,
    `billing/plan-invoices/${i.id}/actions`,
    { version: i.version, subscriptionVersion: w.subscription.version, action, note, ...extra },
    'POST',
    status,
    randomUUID(),
  );
}
let w = await ws();
check(
  w.subscription.status === 'STANDARD' && w.standing.plan === 'STANDARD',
  'Existing Standard plan initialized without fabricating a charge',
);
check(w.invoices.length === 0, 'No annual invoice on Standard');
check(w.stores.length === 1, 'Merchant scope contains its own shop');
check(!JSON.stringify(w).includes('pspAccount'), 'Private payment account omitted');
await change('REQUEST_ANNUAL');
w = await ws();
check(
  w.invoices.length === 1 && w.invoices[0].kind === 'ANNUAL_PLAN_FEE',
  'Annual charge gets an independent invoice',
);
check(w.standing.plan === 'STANDARD', 'Request alone does not activate Annual');
check(w.invoices[0].taxMode === 'EXCLUSIVE_UNASSESSED', 'Demo tax boundary is explicit');
await change('REQUEST_ANNUAL', {}, 409);
await invoice('VOID', m, {}, 403);
await invoice('PAY_FAILED', foreign, {}, 404);
await invoice('PAY_FAILED', a);
w = await ws();
check(
  w.invoices[0].attempts.length === 1 && w.invoices[0].status === 'OPEN',
  'Failed payment remains payable',
);
check(w.standing.plan === 'STANDARD', 'Failed annual payment does not grant benefits');
await invoice('REMIND', a);
await invoice('REMIND', a, {}, 409);
w = await ws();
const i = w.invoices[0],
  body = {
    version: i.version,
    subscriptionVersion: w.subscription.version,
    action: 'PAY_SUCCEEDED',
    reference: 'plan_http_success_' + randomUUID(),
    note,
  },
  key = randomUUID();
await call(m, `billing/plan-invoices/${i.id}/actions`, body, 'POST', 200, key);
const replay = await call(m, `billing/plan-invoices/${i.id}/actions`, body, 'POST', 200, key);
check(replay.status === 'PAID', 'Successful payment retry returns original receipt');
await call(
  m,
  `billing/plan-invoices/${i.id}/actions`,
  { ...body, note: note + ' changed' },
  'POST',
  409,
  key,
);
w = await ws();
check(
  w.standing.plan === 'ANNUAL' && w.subscription.status === 'ANNUAL_ACTIVE',
  'Paid Annual access activates',
);
check(w.invoices[0].attempts.length === 2, 'Payment attempt history retained');
check(w.subscription.annualEndsAt > w.subscription.annualStartedAt, 'Annual coverage recorded');
await call(
  a,
  `billing/plan-invoices/${i.id}/actions`,
  {
    version: w.invoices[0].version,
    subscriptionVersion: w.subscription.version,
    action: 'VOID',
    note,
  },
  'POST',
  409,
  randomUUID(),
);
await change('REQUEST_ANNUAL', {}, 409);
const finance = await call(m, 'merchant/billing');
check(
  finance.rows.length === 0 && finance.totals.net === 0,
  'Annual charge not mixed into service proceeds',
);
check(finance.billing.plan === 'ANNUAL', 'Finance shows current billing standing');
await change('SELECT_STANDARD');
w = await ws();
check(
  w.subscription.renewal === 'STANDARD' && w.standing.plan === 'ANNUAL',
  'Scheduled downgrade preserves paid Annual term',
);
await change('SET_OVERDUE_ACTION', { overdueAction: 'SUSPEND' });
w = await ws();
check(w.subscription.overdueAction === 'SUSPEND', 'Merchant overdue preference is versioned');
const oldVersion = w.subscription.version;
await change('SET_OVERDUE_ACTION', { overdueAction: 'DOWNGRADE' });
await call(
  m,
  'merchant/subscription/store-nagi/actions',
  { version: oldVersion, action: 'SELECT_STANDARD', note },
  'POST',
  409,
  randomUUID(),
);
const tw = await call(foreign, 'merchant/subscription');
check(
  tw.subscription.status === 'TRIALING' && tw.trialDays === 90,
  'First publication starts one Trial',
);
check(tw.invoices.length === 0 && tw.standing.plan === 'TRIAL', 'Trial has no annual charge');
const q = await call(
    c,
    'quotes',
    {
      listingId: 'listing-aoi',
      offeringId: 'store-nagi-60',
      bookingMode: 'SCHEDULED',
      nominationType: 'NOMINATED',
      startAt: bookable(Date.now() + 2 * 86400000),
      area: 'shinjuku',
    },
    'POST',
    201,
  ),
  h = await call(c, 'booking-holds', { quoteId: q.id }, 'POST', 201),
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
      name: 'Subscription QA',
      area: 'shinjuku',
      type: 'HOTEL',
      detail: 'Private isolated subscription QA address',
      hotelName: 'QA Hotel',
      room: 'QA-301',
      hotelPermission: true,
    },
  },
  'POST',
  201,
  randomUUID(),
);
b = await call(s, `staff/tasks/${b.id}/ack`, { version: b.version });
for (const event of ['EN_ROUTE', 'ARRIVED', 'START', 'COMPLETE']) {
  await advanceVisit(b, event);
  b = await call(s, `staff/tasks/${b.id}/events`, { version: b.version, event });
}
b = await confirmVisit(c, b);
check(
  b.captureFeeRateBps === 500,
  'Future scheduled downgrade does not prematurely change capture rate',
);
check(
  b.platformFee === Math.floor((b.capturedAmount - b.quote.transportFee) * 0.05),
  'Capture records actual Annual fee separately',
);
const request = await call(
  c,
  `customer/bookings/${b.id}/refund-requests`,
  { bookingVersion: b.version, amount: 1000, reason: note, locale: 'en' },
  'POST',
  201,
  randomUUID(),
);
await call(
  m,
  `refund-requests/${request.id}/decision`,
  {
    version: request.version,
    bookingVersion: b.version,
    action: 'APPROVE',
    amount: 1000,
    text: note,
  },
  'POST',
  200,
  randomUUID(),
);
const after = await call(m, 'merchant/billing');
check(
  after.rows.length === 2 && after.rows.some((r) => r.kind === 'REFUND'),
  'Order aftercare adds separate financial reversal',
);
check(after.billing.openAnnualAmount === 0, 'Service refund does not reopen annual fee');
const annual = await ws();
check(
  annual.invoices[0].status === 'PAID' && annual.invoices[0].amount === 100000,
  'Service refund leaves annual receipt unchanged',
);
const admin = await call(a, 'admin/subscriptions?storeId=store-nagi');
check(admin.stores.length === 3, 'Platform billing queue covers fictional shops');
check(
  admin.history.some((e) => e.action === 'PAY_FAILED') &&
    admin.history.some((e) => e.action === 'PAY_SUCCEEDED'),
  'Cross-role billing history preserved',
);
for (const l of ['ja', 'en', 'zh-cn'])
  for (const portal of ['merchant', 'admin']) {
    const r = await fetch(`${origin}/${l}/${portal}?tab=finance&section=plans`);
    check(r.status === 200, `${l} ${portal} SSR`);
    const html = await r.text();
    check(
      html.includes('HoguLink') && !html.includes('Private isolated subscription QA'),
      'SSR does not disclose private order data',
    );
  }
console.log(
  `Subscription HTTP smoke passed: ${checks} checks. Trial, annual invoice, retries, renewal choices, permissions, capture and aftercare linkage verified.`,
);
