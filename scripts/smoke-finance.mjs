import { advanceVisit, confirmVisit } from './qa-clock.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.SMOKE_API_ORIGIN,
  origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000';
if (!base) throw Error('Use disposable isolated API data.');
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
await call('', 'admin/finance', undefined, 'GET', 401);
const c = await login('CUSTOMER'),
  m = await login('MERCHANT', { storeId: 'store-nagi' }),
  s = await login('STAFF', { staffId: 'staff-aoi' }),
  a = await login('ADMIN'),
  foreign = await login('MERCHANT', { storeId: 'store-mori' });
for (const actor of [c, m, s]) await call(actor, 'admin/finance', undefined, 'GET', 403);
await call(foreign, 'merchant/billing?storeId=store-nagi', undefined, 'GET', 404);
async function book(days) {
  const q = await call(
      c,
      'quotes',
      {
        listingId: 'listing-aoi',
        offeringId: 'store-nagi-60',
        bookingMode: 'SCHEDULED',
        nominationType: 'NOMINATED',
        startAt: Date.now() + days * 86400000,
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
        name: 'Finance QA',
        area: 'shinjuku',
        type: 'HOTEL',
        detail: 'Private isolated finance QA address',
        hotelName: 'QA Hotel',
        room: 'QA-201',
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
  return b;
}
const workspace = () => call(a, 'admin/finance?storeId=store-nagi');
const note = 'Verified the original order, provider observation and refund ledger together.';
async function match(row, extra = {}) {
  return call(
    a,
    `admin/finance/store-nagi/entries/${row.id}/report`,
    {
      version: row.report?.version ?? 0,
      reference: 'demo_' + row.id.replaceAll('-', '_'),
      captured: row.captured,
      refunded: row.refunded,
      platformFee: row.platformFee,
      processorFee: 0,
      net: row.captured - row.refunded - row.platformFee,
      note,
      ...extra,
    },
    'POST',
    200,
    randomUUID(),
  );
}
let b = await book(2),
  d = await workspace();
check(
  d.rows.length === 1 && d.rows[0].captured === b.capturedAmount,
  'Actual completion produces one captured entry',
);
check(
  !JSON.stringify(d).includes('Private isolated') && !JSON.stringify(d).includes('customerId'),
  'Finance projections redact personal and payment routing data',
);
const statementBody = { month: d.month, token: d.token },
  key = randomUUID(),
  statement = await call(
    m,
    'merchant/billing/store-nagi/statements',
    statementBody,
    'POST',
    201,
    key,
  );
check(
  (await call(m, 'merchant/billing/store-nagi/statements', statementBody, 'POST', 201, key)).id ===
    statement.id,
  'Statement retries reuse the immutable snapshot',
);
let r = await call(
  c,
  `customer/bookings/${b.id}/refund-requests`,
  { bookingVersion: b.version, amount: 1000, reason: note, locale: 'en' },
  'POST',
  201,
  randomUUID(),
);
d = await workspace();
check(
  d.openRows[0].hold && d.openRows[0].holdReason === 'AFTERCARE',
  'Active refund requests prevent settlement verification',
);
await match(d.rows[0]);
d = await workspace();
await call(
  a,
  'admin/finance/store-nagi/settlements',
  { token: d.token, note },
  'POST',
  409,
  randomUUID(),
);
let rd = await call(m, `support-tickets/${r.ticketId}/refund-request`);
await call(
  m,
  `refund-requests/${r.id}/decision`,
  {
    version: rd.request.version,
    bookingVersion: rd.bookingVersion,
    action: 'APPROVE',
    amount: 1000,
    text: note,
  },
  'POST',
  200,
  randomUUID(),
);
d = await workspace();
const refund = d.rows.find((e) => e.kind === 'REFUND');
check(
  refund.refunded === 1000 && refund.platformFee <= 0 && !!refund.reversalOf,
  'Refund ledger and fee reversal are linked to the original capture',
);
check(d.statements[0].refunded === 0, 'Previous statement remains immutable after refund');
await match(refund, { refunded: 900 });
d = await workspace();
check(
  d.rows.find((e) => e.id === refund.id).report.status === 'DIFFERENCE',
  'Provider component differences stay visible',
);
const refundCredit = d.rows.find((e) => e.id === refund.id);
await match(refundCredit, {
  processorFee: -30,
  net: -refundCredit.refunded - refundCredit.platformFee + 30,
});
d = await workspace();
check(
  d.rows.find((e) => e.id === refund.id).report.processorFee === -30,
  'Provider fee credit is recorded separately from the platform fee reversal',
);
check(d.canPrepare, 'Corrected reports and resolved normal refund case permit verification');
const nextStatement = await call(
  m,
  'merchant/billing/store-nagi/statements',
  { month: d.month, token: d.token },
  'POST',
  201,
  randomUUID(),
);
check(
  nextStatement.revision === 2 && nextStatement.refunded === 1000,
  'A new bill revision includes the refund without rewriting history',
);
let batch = await call(
  a,
  'admin/finance/store-nagi/settlements',
  { token: d.token, note },
  'POST',
  201,
  randomUUID(),
);
const act = (actor, action, status = 200, extra = {}) =>
  call(
    actor,
    `finance/settlements/${batch.id}/actions`,
    { version: batch.version, action, note, ...extra },
    'POST',
    status,
    randomUUID(),
  );
await act(a, 'RECORD', 409, { reference: 'demo_early_payout' });
await act(foreign, 'CONFIRM', 404);
batch = await act(m, 'DISPUTE');
batch = await act(a, 'RESPOND');
batch = await act(m, 'CONFIRM');
batch = await act(a, 'FAIL');
check(
  batch.state === 'FAILED' && (await workspace()).openRows.length === 2,
  'Provider failure does not settle or consume the entries',
);
batch = await act(a, 'RETRY');
batch = await act(m, 'CONFIRM');
batch = await act(a, 'RECORD', 200, { reference: 'demo_final_payout' });
check(
  batch.state === 'RECORDED' && (await workspace()).openRows.length === 0,
  'Provider result is recorded only after original shop confirmation',
);
b = await call(c, `bookings/${b.id}`);
b = await call(m, `merchant/bookings/${b.id}/refunds`, { version: b.version, amount: 500 });
d = await workspace();
check(
  d.openRows.length === 1 && d.totals.unsettled < 0,
  'Refund after recorded settlement becomes a negative carry-forward',
);
await match(d.openRows[0]);
d = await workspace();
await call(
  a,
  'admin/finance/store-nagi/settlements',
  { token: d.token, note },
  'POST',
  409,
  randomUUID(),
);
await book(3);
d = await workspace();
for (const row of d.openRows) if (row.report?.status !== 'MATCHED') await match(row);
d = await workspace();
batch = await call(
  a,
  'admin/finance/store-nagi/settlements',
  { token: d.token, note },
  'POST',
  201,
  randomUUID(),
);
check(
  batch.entryIds.length === 2 && batch.net >= 0,
  'Later income offsets the refund adjustment once',
);
for (const locale of ['ja', 'en', 'zh-cn'])
  for (const page of ['merchant?tab=finance', 'admin?tab=finance'])
    check((await fetch(`${origin}/${locale}/${page}`)).ok, `${locale}/${page} serves`);
console.log(
  `Finance HTTP smoke passed: ${checks} checks. Capture, refunds, bill revisions, provider differences, shop disputes, failures, recording and carry-forward verified.`,
);
