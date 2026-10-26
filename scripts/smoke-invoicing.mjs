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
await call('', 'admin/invoicing', undefined, 401);
const c = await login('CUSTOMER'),
  m = await login('MERCHANT', { storeId: 'store-nagi' }),
  s = await login('STAFF', { staffId: 'staff-aoi' }),
  a = await login('ADMIN'),
  f = await login('ADMIN', { adminPersona: 'FINANCE' }),
  foreign = await login('MERCHANT', { storeId: 'store-sora' });
const fa = await call(f, 'auth/session');
check(fa.adminRole === 'FINANCE', 'Distinct finance session uses limited finance permissions');
for (const x of [c, s, m]) await call(x, 'admin/invoicing', undefined, 403);
for (const x of [c, s]) await call(x, 'merchant/invoicing', undefined, 403);
await call(foreign, 'merchant/invoicing?storeId=store-nagi', undefined, 404);
await call(f, 'admin/employees', undefined, 403);
const note = 'Reviewed the source, recipient snapshot, original invoice and refund history.',
  attest = { source: true, recipient: true, history: true, demo: true };
const ws = (actor = m) =>
  call(actor, `${actor === m ? 'merchant' : 'admin'}/invoicing?storeId=store-nagi`);
const finance = () => call(a, 'admin/finance?storeId=store-nagi');
async function reconcile() {
  let w = await finance();
  for (const row of w.rows)
    await call(f, `admin/finance/store-nagi/entries/${row.id}/report`, {
      version: row.report?.version ?? 0,
      reference: 'demo_' + row.id,
      captured: row.captured,
      refunded: row.refunded,
      platformFee: row.platformFee,
      processorFee: 0,
      net: row.captured - row.refunded - row.platformFee,
      note,
    });
  w = await finance();
  await call(m, 'merchant/billing/store-nagi/statements', { month: w.month, token: w.token }, 201);
}
async function apply(kind, actor = m) {
  const w = await ws(actor),
    source = w.sources.find((x) => x.kind === kind && !x.blockedReason);
  check(!!source, kind + ' source is eligible');
  return call(actor, `${actor === m ? 'merchant' : 'admin'}/invoicing/store-nagi/requests`, {
    sourceKey: source.key,
    sourceToken: source.token,
    ...(kind === 'CREDIT_NOTE' ? {} : { profileVersion: w.profile.version }),
    note,
  });
}
async function action(r, act, actor = f, status = 200, extra = {}) {
  return call(
    actor,
    `billing/invoice-requests/${r.id}/actions`,
    {
      version: r.version,
      action: act,
      note,
      ...(['REVIEW', 'APPROVE', 'ISSUE', 'ISSUE_FAILED'].includes(act) ? { checks: attest } : {}),
      ...extra,
    },
    status,
  );
}
async function issue(r) {
  r = await action(r, 'REVIEW');
  await action(r, 'APPROVE', f, 403);
  r = await action(r, 'APPROVE', a);
  await action(r, 'ISSUE', a, 409);
  r = await action(r, 'ISSUE', f);
  return (await ws()).documents.find((d) => d.id === r.documentId);
}
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
      name: 'Invoice QA',
      area: 'shinjuku',
      type: 'HOTEL',
      detail: 'PRIVATE_INVOICE_CUSTOMER_ADDRESS',
      hotelName: 'QA Hotel',
      room: '201',
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
let w = await ws();
check(
  w.sources.some((x) => x.blockedReason === 'INVOICE_STATEMENT_REQUIRED'),
  'Current bill is required',
);
await reconcile();
w = await ws();
check(
  !JSON.stringify(w).includes('PRIVATE_INVOICE_CUSTOMER_ADDRESS'),
  'Customer addresses omitted',
);
check(
  w.sources.find((x) => x.kind === 'PLATFORM_FEE').amount === b.platformFee,
  'Invoice covers fees only',
);
let r = await apply('PLATFORM_FEE');
await apply('PLATFORM_FEE', m).then(
  () => assert.fail('duplicate source'),
  (e) => {
    assert.match(e.message, /source is eligible/);
    checks++;
  },
);
r = await action(r, 'RETURN');
w = await ws();
let current = w.requests.find((x) => x.id === r.id);
r = await action(r, 'RESUBMIT', m, 200, {
  sourceToken: current.currentSource.token,
  profileVersion: w.profile.version,
});
r = await action(r, 'REVIEW');
await action(r, 'APPROVE', m, 403);
r = await action(r, 'APPROVE', a);
r = await action(r, 'ISSUE_FAILED');
check(r.state === 'APPROVED' && r.attempts.length === 1, 'Failure leaves approval intact');
r = await action(r, 'ISSUE');
w = await ws();
const original = w.documents[0];
check(
  original.amount === b.platformFee &&
    original.taxAmount === null &&
    original.issuer.registrationNumber === null,
  'No service gross or fabricated tax',
);
const frozen = JSON.stringify(original);
let refund = await call(
  c,
  `customer/bookings/${b.id}/refund-requests`,
  { bookingVersion: b.version, amount: 1000, reason: note, locale: 'en' },
  201,
);
const rd = await call(m, `support-tickets/${refund.ticketId}/refund-request`);
await call(m, `refund-requests/${refund.id}/decision`, {
  version: rd.request.version,
  bookingVersion: rd.bookingVersion,
  action: 'APPROVE',
  amount: 1000,
  text: note,
});
w = await ws();
check(
  w.sources.some(
    (x) => x.kind === 'CREDIT_NOTE' && x.blockedReason === 'INVOICE_RECONCILIATION_REQUIRED',
  ),
  'Refund proceeds independently and credit waits for reconciliation',
);
await reconcile();
const credit = await issue(await apply('CREDIT_NOTE', f));
check(
  credit.kind === 'CREDIT_NOTE' &&
    credit.amount ===
      (await finance()).rows
        .filter((row) => row.reversalOf && row.bookingId === b.id)
        .reduce((sum, row) => sum - row.platformFee, 0) &&
    credit.originalInvoiceRootId === original.rootId,
  'Fee refund produces original-linked credit',
);
check(
  JSON.stringify((await ws()).documents.find((d) => d.id === original.id)) === frozen,
  'Original invoice remains immutable',
);
let plan = await call(m, 'merchant/subscription');
await call(m, 'merchant/subscription/store-nagi/actions', {
  version: plan.subscription.version,
  action: 'REQUEST_ANNUAL',
  note,
});
plan = await call(m, 'merchant/subscription');
const annual = plan.invoices.find((x) => x.status === 'OPEN');
check(
  !(await ws()).sources.some((x) => x.kind === 'ANNUAL_FEE'),
  'Unpaid annual charge cannot be invoiced',
);
await call(m, `billing/plan-invoices/${annual.id}/actions`, {
  version: annual.version,
  subscriptionVersion: plan.subscription.version,
  action: 'PAY_SUCCEEDED',
  reference: 'plan_invoice_' + randomUUID(),
  note,
});
const paidPlan = await call(m, 'merchant/subscription');
const annualDoc = await issue(await apply('ANNUAL_FEE'));
check(annualDoc.amount === annual.amount, 'Invoice uses frozen paid annual amount');
check(
  JSON.stringify((await call(m, 'merchant/subscription')).subscription) ===
    JSON.stringify(paidPlan.subscription),
  'Issuance does not mutate subscription',
);
w = await ws();
await call(m, 'merchant/invoicing/store-nagi/profile', {
  version: w.profile.version,
  recipient: {
    name: 'QA Corrected Recipient',
    address: 'Tokyo isolated invoice office',
    email: 'invoice@example.test',
    taxId: '',
  },
});
const correction = await issue(await apply('CORRECTION'));
check(
  correction.revision === 2 &&
    !!correction.correctsId &&
    correction.recipient.name === 'QA Corrected Recipient',
  'Correction appends revision with updated recipient',
);
await action(r, 'ISSUE', f, 409);
for (const l of ['ja', 'en', 'zh-cn'])
  for (const role of ['merchant', 'admin']) {
    const response = await fetch(`${origin}/${l}/${role}?tab=finance&section=invoices`);
    check(response.status === 200, 'Three-language invoice route SSR');
    const html = await response.text();
    check(html.includes('HoguLink'), 'SSR body available');
  }
console.log(`Invoicing / financial approval: ${checks} checks passed (isolated data).`);
