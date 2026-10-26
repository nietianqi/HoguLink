import { advanceVisit, bookable, confirmVisit } from './qa-clock.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.SMOKE_API_ORIGIN,
  origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000';
if (!base) throw Error('Use an isolated in-memory API.');
let checks = 0;
const check = (v, m) => {
  assert.ok(v, m);
  checks++;
};
async function call(
  cookie,
  path,
  body,
  status = 200,
  key = body === undefined ? undefined : randomUUID(),
) {
  const r = await fetch(`${base}/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: origin,
        ...(cookie && path !== 'auth/demo' ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    d = await r.json();
  assert.equal(r.status, status, path + ': ' + JSON.stringify(d));
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
const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
  query = { from: day.slice(0, 7) + '-01', to: day, groupBy: 'day' },
  params = new URLSearchParams(query),
  note = 'Verified original transactions and the report scope, time basis and snapshot.';
await call('', `admin/reports?${params}`, undefined, 401);
const c = await login('CUSTOMER'),
  m = await login('MERCHANT', { storeId: 'store-nagi' }),
  s = await login('STAFF', { staffId: 'staff-aoi' }),
  a = await login('ADMIN'),
  f = await login('ADMIN', { adminPersona: 'FINANCE' }),
  foreign = await login('MERCHANT', { storeId: 'store-mori' });
for (const actor of [c, m, s]) await call(actor, `admin/reports?${params}`, undefined, 403);
for (const actor of [c, s]) await call(actor, `merchant/reports?${params}`, undefined, 403);
await call(foreign, `merchant/reports?${params}&storeId=store-nagi`, undefined, 404);
for (const [path, status] of [
  [`from=2026-02-30&to=${day}`, 422],
  [`from=2020-01-01&to=${day}`, 400],
  [`from=${day}&to=${day}&groupBy=hour`, 422],
])
  await call(m, 'merchant/reports?' + path, undefined, status);
const workspace = () => call(m, `merchant/reports?${params}`);
let w = await workspace();
check(
  w.current.captured === 0 && w.current.averageCapture === null,
  'Empty reports have zero totals and no invented average',
);
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
      name: 'Private Reporting Guest',
      area: 'shinjuku',
      type: 'HOTEL',
      detail: 'PRIVATE_REPORT_ADDRESS',
      hotelName: 'QA Hotel',
      room: 'SECRET_ROOM_201',
      hotelPermission: true,
    },
  },
  201,
);
b = await call(s, `staff/tasks/${b.id}/ack`, { version: b.version });
for (const event of ['EN_ROUTE', 'ARRIVED', 'START', 'COMPLETE']) {
  await advanceVisit(b, event);
  b = await call(s, `staff/tasks/${b.id}/events`, { version: b.version, event });
}
b = await confirmVisit(c, b);
// The capture is posted after the real service duration, which can be on a later Japan date.
params.set('to', new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10));
w = await workspace();
check(
  w.current.captured === b.capturedAmount && w.current.platformFee === b.platformFee,
  'Actual capture and frozen platform fee feed report',
);
check(w.current.merchantNetAfterFees === null, 'Unknown PSP fee does not become zero');
for (const privateValue of [
  'PRIVATE_REPORT_ADDRESS',
  'SECRET_ROOM_201',
  'Private Reporting Guest',
  'customerId',
  'paymentId',
  'pspAccount',
])
  check(!JSON.stringify(w).includes(privateValue), 'Report excludes ' + privateValue);
const exportBody = { query: w.query, token: w.token, type: 'money' },
  retry = randomUUID(),
  snapshot = await call(m, 'merchant/reports/export', exportBody, 200, retry);
check(
  snapshot.rows.length === 1 && snapshot.storeIds[0] === 'store-nagi',
  'Export matches source scope',
);
check(
  snapshot.timeZone === 'Asia/Tokyo' && snapshot.currency === 'JPY',
  'Export carries time and currency',
);
check(!JSON.stringify(snapshot).includes('PRIVATE_REPORT'), 'Export omits private fields');
await call(foreign, `merchant/reports/exports/${snapshot.id}`, undefined, 404);
await call(c, `merchant/reports/exports/${snapshot.id}`, undefined, 403);
await call(m, 'merchant/reports/export', { ...exportBody, type: 'summary' }, 409, retry);
await call(m, 'merchant/reports/export', { ...exportBody, amount: 1 }, 422);
await call(m, 'merchant/reports/export', exportBody, 400, '');
for (const type of ['summary', 'trend', 'orders']) {
  const x = await call(m, 'merchant/reports/export', { ...exportBody, type });
  check(x.rowCount > 0, 'Export ' + type + ' includes all rows');
}
const finance = () => call(f, 'admin/finance?storeId=store-nagi');
async function match() {
  for (const r of (await finance()).openRows)
    await call(f, `admin/finance/store-nagi/entries/${r.id}/report`, {
      version: r.report?.version ?? 0,
      reference: 'demo_reporting_' + r.id,
      captured: r.captured,
      refunded: r.refunded,
      platformFee: r.platformFee,
      processorFee: 0,
      net: r.captured - r.refunded - r.platformFee,
      note,
    });
}
await match();
let d = await finance();
await call(m, 'merchant/billing/store-nagi/statements', { month: d.month, token: d.token }, 201);
let iw = await call(m, 'merchant/invoicing'),
  source = iw.sources.find((s) => s.kind === 'PLATFORM_FEE');
let request = await call(m, 'merchant/invoicing/store-nagi/requests', {
  sourceKey: source.key,
  sourceToken: source.token,
  profileVersion: iw.profile.version,
  note,
});
const checksBody = { source: true, recipient: true, history: true, demo: true };
for (const [action, actor] of [
  ['REVIEW', f],
  ['APPROVE', a],
  ['ISSUE', f],
])
  request = await call(actor, `billing/invoice-requests/${request.id}/actions`, {
    version: request.version,
    action,
    checks: checksBody,
    note,
  });
let batch = await call(
  f,
  'admin/finance/store-nagi/settlements',
  { token: (await finance()).token, note },
  201,
);
batch = await call(m, `finance/settlements/${batch.id}/actions`, {
  version: batch.version,
  action: 'CONFIRM',
  note,
});
batch = await call(f, `finance/settlements/${batch.id}/actions`, {
  version: batch.version,
  action: 'RECORD',
  reference: 'demo_reporting_record',
  note,
});
w = await workspace();
check(
  w.current.settlementRecorded === batch.net && w.current.captured === b.capturedAmount,
  'Settlement does not duplicate service sales',
);
check(
  w.current.invoiceIssued === b.platformFee && w.money[0].invoiceNumbers.length === 1,
  'Invoice fee is linked, not added to proceeds',
);
check(
  w.current.merchantNetAfterFees === b.capturedAmount - b.platformFee,
  'Matched PSP fee produces known after-fee amount',
);
const refund = await call(
    c,
    `customer/bookings/${b.id}/refund-requests`,
    { bookingVersion: b.version, amount: 1000, reason: note, locale: 'en' },
    201,
  ),
  rd = await call(m, `support-tickets/${refund.ticketId}/refund-request`);
await call(m, `refund-requests/${refund.id}/decision`, {
  version: rd.request.version,
  bookingVersion: rd.bookingVersion,
  action: 'APPROVE',
  amount: 1000,
  text: note,
});
await call(m, 'merchant/reports/export', exportBody, 409);
check(
  (await call(m, 'merchant/reports/export', exportBody, 200, retry)).id === snapshot.id,
  'Retry preserves original export after refund',
);
check(
  JSON.stringify(await call(m, `merchant/reports/exports/${snapshot.id}`)) ===
    JSON.stringify(snapshot),
  'Saved snapshot does not mutate',
);
w = await workspace();
check(
  w.current.refunded === 1000 && w.current.salesNet === b.capturedAmount - 1000,
  'Refund changes current activity',
);
check(
  w.current.merchantNetAfterFees === null,
  'New unverified refund resets after-PSP total to unknown',
);
check(
  w.balances.unsettledBeforeFees < 0,
  'Refund after settlement appears as negative unsettled carry',
);
let plan = await call(m, 'merchant/subscription');
await call(m, 'merchant/subscription/store-nagi/actions', {
  version: plan.subscription.version,
  action: 'REQUEST_ANNUAL',
  note,
});
plan = await call(m, 'merchant/subscription');
const annual = plan.invoices.find((i) => i.status === 'OPEN');
w = await workspace();
check(
  w.current.annualPaid === 0 && w.balances.openAnnual === annual.amount,
  'Pending annual charge is outstanding, not paid activity',
);
await call(m, `billing/plan-invoices/${annual.id}/actions`, {
  version: annual.version,
  subscriptionVersion: plan.subscription.version,
  action: 'PAY_SUCCEEDED',
  reference: 'plan_reporting_' + randomUUID(),
  note,
});
w = await workspace();
check(
  w.current.annualPaid === annual.amount && w.balances.openAnnual === 0,
  'Paid annual charge has its own timing and balance',
);
check(
  w.current.salesNet === b.capturedAmount - 1000,
  'Annual payment never increases service proceeds',
);
const all = await call(f, `admin/reports?${params}`),
  one = await call(f, `admin/reports?${params}&storeId=store-nagi`);
check(
  all.selectedStoreIds.length === 3 && one.selectedStoreIds.length === 1,
  'Platform supports all-shop and one-shop scopes',
);
check(
  all.current.captured === w.current.captured && one.current.annualPaid === w.current.annualPaid,
  'Platform and merchant use matching source definitions',
);
for (const type of [
  'summary',
  'trend',
  'money',
  'orders',
  'settlements',
  'annual',
  'invoices',
  'shops',
]) {
  const exp = await call(f, 'admin/reports/export', { query: one.query, token: one.token, type });
  check(
    exp.rowCount === exp.rows.length && exp.columns.length === exp.rows[0].length,
    'Rectangular complete export ' + type,
  );
}
check((await workspace()).exports.length > 0, 'Export history is available');
for (const l of ['ja', 'en', 'zh-cn'])
  for (const role of ['merchant', 'admin']) {
    const r = await fetch(`${origin}/${l}/${role}?tab=finance&section=reports`);
    check(r.status === 200, 'Report SSR route ' + l + ' ' + role);
  }
console.log(
  `Reporting HTTP smoke passed: ${checks} checks. Scopes, dates, snapshots, privacy, refund carry, settlement, annual and invoice linkage verified.`,
);
