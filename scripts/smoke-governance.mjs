import { advanceVisit, confirmVisit } from './qa-clock.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.SMOKE_API_ORIGIN,
  origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000';
if (!base) throw Error('Use smoke:isolated with disposable data.');
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
await call('', 'admin/order-monitor', undefined, 'GET', 401);
const c = await login('CUSTOMER'),
  m = await login('MERCHANT', { storeId: 'store-nagi' }),
  s = await login('STAFF', { staffId: 'staff-aoi' }),
  a = await login('ADMIN'),
  foreign = await login('MERCHANT', { storeId: 'store-mori' });
for (const cookie of [c, m, s]) await call(cookie, 'admin/order-monitor', undefined, 'GET', 403);
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
  return call(
    c,
    'bookings',
    {
      quoteId: q.id,
      holdId: h.id,
      paymentId: p.id,
      termsAccepted: true,
      policyVersion: q.cancellationPolicy.version,
      address: {
        name: 'QA Guest',
        area: 'shinjuku',
        type: 'HOTEL',
        detail: 'Isolated governance QA building',
        hotelName: 'QA Hotel',
        room: 'QA-201',
        hotelPermission: true,
      },
    },
    'POST',
    201,
    randomUUID(),
  );
}
let b = await book(2);
b = await call(s, `staff/tasks/${b.id}/ack`, { version: b.version });
for (const event of ['EN_ROUTE', 'ARRIVED', 'START', 'COMPLETE']) {
  await advanceVisit(b, event);
  b = await call(s, `staff/tasks/${b.id}/events`, { version: b.version, event });
}
b = await confirmVisit(c, b);
const r = await call(
  c,
  `customer/bookings/${b.id}/refund-requests`,
  {
    bookingVersion: b.version,
    amount: 2000,
    reason: 'Please verify the actual visit facts and arrange a reasonable refund.',
    locale: 'en',
  },
  'POST',
  201,
  randomUUID(),
);
let h = await call(
  m,
  `bookings/${b.id}/handoffs`,
  {
    bookingVersion: b.version,
    topic: 'AFTERCARE_FACTS',
    ticketId: r.ticketId,
    text: 'Please confirm actual service facts for this shared aftercare case.',
  },
  'POST',
  201,
  randomUUID(),
);
h = await call(
  s,
  `work-handoffs/${h.id}/actions`,
  {
    version: h.version,
    action: 'REPLY',
    text: 'Therapist private facts for shop review only; do not forward this original text.',
  },
  'POST',
  200,
  randomUUID(),
);
let t = (await call(m, `support-tickets/${r.ticketId}`)).ticket;
t = await call(m, `support-tickets/${t.id}/messages`, {
  version: t.version,
  text: 'The shop checked the therapist findings and confirms a partial service discrepancy.',
});
t = await call(c, `support-tickets/${t.id}/actions`, {
  version: t.version,
  action: 'ESCALATE',
  text: 'Please coordinate the shared case after reviewing both parties statements.',
});
let d = await call(a, `support-tickets/${t.id}/decision`),
  detail = await call(a, `support-tickets/${t.id}`);
const body = {
    ticketVersion: detail.ticket.version,
    version: 0,
    bookingVersion: d.bookingVersion,
    refundVersion: d.refundVersion,
    outcome: 'REFUND',
    amount: 1500,
    summary:
      'The customer report and shop statement were checked against the actual completed order.',
    reason: 'The original shop should process a 1500 JPY partial refund and explain its follow-up.',
    evidenceIds: detail.messages.filter((m) => m.role === 'MERCHANT').map((m) => m.id),
    merchantUnreachable: false,
  },
  key = randomUUID();
await call(
  a,
  `support-tickets/${t.id}/decision`,
  { ...body, evidenceIds: ['foreign-message'] },
  'POST',
  422,
  randomUUID(),
);
await call(
  a,
  `support-tickets/${t.id}/decision`,
  { ...body, bookingVersion: body.bookingVersion + 1 },
  'POST',
  409,
  randomUUID(),
);
const decision = await call(a, `support-tickets/${t.id}/decision`, body, 'POST', 201, key);
check(
  (await call(a, `support-tickets/${t.id}/decision`, body, 'POST', 201, key)).id === decision.id,
  'Decision replay is idempotent',
);
check(
  (await call(c, `bookings/${b.id}`)).refundedAmount === 0,
  'Platform proposal does not move customer funds',
);
check(
  (await call(c, `support-tickets/${t.id}/decision`)).state === 'AWAITING_SHOP',
  'Customer sees shop execution pending',
);
await call(foreign, `support-tickets/${t.id}/decision`, undefined, 'GET', 404);
await call(s, `support-tickets/${t.id}/decision`, undefined, 'GET', 403);
detail = await call(a, `support-tickets/${t.id}`);
await call(
  a,
  `support-tickets/${t.id}/actions`,
  {
    version: detail.ticket.version,
    action: 'RESOLVE',
    text: 'Do not close before the shop executes the actual refund.',
  },
  'POST',
  409,
);
const rd = await call(m, `support-tickets/${t.id}/refund-request`),
  moneyBody = {
    version: rd.request.version,
    bookingVersion: rd.bookingVersion,
    action: 'APPROVE',
    amount: 1000,
    text: 'The shop approves a smaller partial refund after reviewing all facts.',
  };
await call(a, `refund-requests/${r.id}/decision`, moneyBody, 'POST', 403, randomUUID());
await call(m, `refund-requests/${r.id}/decision`, moneyBody, 'POST', 200, randomUUID());
check(
  (await call(c, `support-tickets/${t.id}/decision`)).state === 'NEEDS_REVIEW',
  'Mismatched execution requires review',
);
let mon = await call(a, 'admin/order-monitor');
const alert = mon.alerts.find((x) => x.kind === 'DECISION_REVIEW' && x.ticketId === t.id);
check(!!alert, 'Decision mismatch creates a linked platform alert');
const watch = {
  version: alert.version,
  action: 'WATCH',
  followUpAt: Date.now() + 30 * 60000,
  note: 'Private operator note: verify the mismatch before case closure.',
};
await call(a, `admin/order-alerts/${alert.id}/follow-up`, watch);
await call(a, `admin/order-alerts/${alert.id}/follow-up`, watch, 'POST', 409);
mon = await call(a, 'admin/order-monitor');
check(
  mon.alerts.find((x) => x.id === alert.id).state === 'WATCHING',
  'Watching does not clear the underlying discrepancy',
);
check(
  !JSON.stringify(await call(c, `support-tickets/${t.id}`)).includes('Private operator note'),
  'Internal monitoring notes never enter the customer case',
);
check(
  !JSON.stringify(await call(a, `support-tickets/${t.id}`)).includes('Therapist private facts'),
  'Unshared therapist handoff is not exposed to platform case',
);
d = await call(a, `support-tickets/${t.id}/decision`);
detail = await call(a, `support-tickets/${t.id}`);
const revision = {
  ...body,
  ticketVersion: detail.ticket.version,
  version: d.current.version,
  bookingVersion: d.bookingVersion,
  refundVersion: d.refundVersion,
  outcome: 'FOLLOW_UP',
  amount: 0,
  reason:
    'The actual 1000 JPY refund was checked; the shop must explain the remaining discrepancy and corrective action.',
};
await call(a, `support-tickets/${t.id}/decision`, revision, 'POST', 201, randomUUID());
check(
  (await call(c, `support-tickets/${t.id}/decision`)).state === 'AWAITING_SHOP',
  'Revised follow-up waits for a real shop receipt',
);
detail = await call(m, `support-tickets/${t.id}`);
const receipt = {
    version: 2,
    ticketVersion: detail.ticket.version,
    text: 'The shop explained the actual partial refund and completed the agreed service correction.',
  },
  receiptKey = randomUUID();
await call(m, `support-tickets/${t.id}/decision/acknowledgment`, receipt, 'POST', 200, receiptKey);
await call(m, `support-tickets/${t.id}/decision/acknowledgment`, receipt, 'POST', 200, receiptKey);
d = await call(c, `support-tickets/${t.id}/decision`);
check(
  d.state === 'READY_TO_CLOSE' && d.history.length === 2 && d.receipt.text === receipt.text,
  'Customer receives version history and verified shop receipt',
);
detail = await call(a, `support-tickets/${t.id}`);
t = await call(a, `support-tickets/${t.id}/actions`, {
  version: detail.ticket.version,
  action: 'RESOLVE',
  text: 'The shop execution and actual refund balance were verified and the platform review is resolved.',
});
mon = await call(a, 'admin/order-monitor');
check(
  mon.alerts.find((x) => x.id === alert.id).state === 'RESOLVED',
  'Final case resolution automatically recovers the mismatch alert',
);
t = await call(c, `support-tickets/${t.id}/actions`, {
  version: t.version,
  action: 'REOPEN',
  text: 'I dispute the prior resolution and request a fresh platform review.',
});
check(
  (await call(c, `support-tickets/${t.id}/decision`)).state === 'NEEDS_REVIEW',
  'Customer reopening invalidates the old verified decision',
);
mon = await call(a, 'admin/order-monitor');
check(
  mon.alerts.find((x) => x.id === alert.id).generation === 2,
  'Reopened discrepancy creates a fresh alert occurrence',
);
check(
  !JSON.stringify(mon).includes('Isolated governance QA building'),
  'Monitor never exposes customer address',
);
d = await call(a, `support-tickets/${t.id}/decision`);
detail = await call(a, `support-tickets/${t.id}`);
const appealRevision = {
  ...revision,
  ticketVersion: detail.ticket.version,
  version: d.current.version,
  bookingVersion: d.bookingVersion,
  refundVersion: d.refundVersion,
};
check(
  (await call(a, `support-tickets/${t.id}/decision`, appealRevision, 'POST', 409, randomUUID()))
    .error.code === 'APPEAL_EVIDENCE_REQUIRED',
  'A new appeal must be part of the reviewed evidence',
);
await call(
  a,
  `support-tickets/${t.id}/decision`,
  {
    ...appealRevision,
    evidenceIds: [
      ...appealRevision.evidenceIds,
      ...detail.messages.filter((m) => m.kind === 'REOPEN').map((m) => m.id),
    ],
  },
  'POST',
  201,
  randomUUID(),
);
let blocked = await book(3);
blocked = await call(s, `staff/tasks/${blocked.id}/decline`, {
  version: blocked.version,
  reason: 'The task needs to be arranged by the original shop.',
});
mon = await call(a, 'admin/order-monitor');
const blockedAlert = mon.alerts.find(
  (x) => x.kind === 'ASSIGNMENT_BLOCKED' && x.bookingId === blocked.id,
);
await call(a, `admin/order-alerts/${blockedAlert.id}/follow-up`, {
  version: blockedAlert.version,
  action: 'WATCH',
  followUpAt: Date.now() + 600000,
  note: 'Private assignment coordination note should remain within the platform.',
});
for (const cookie of [m, s])
  check(
    (await call(cookie, `bookings/${blocked.id}/coordination`)).platformAttention.some(
      (x) => x.kind === 'ASSIGNMENT_BLOCKED',
    ),
    'Shop and actual therapist receive a minimal platform attention hint',
  );
const customerHint = await call(c, `bookings/${blocked.id}/coordination`);
check(
  customerHint.platformAttention.length === 0 &&
    !JSON.stringify(customerHint).includes('Private assignment'),
  'Customer never receives internal assignment alerts or notes',
);
for (const l of ['ja', 'en', 'zh-cn'])
  for (const path of ['admin?tab=orders', 'admin/support', 'merchant/support', 'account/support']) {
    const r = await fetch(`${origin}/${l}/${path}`);
    check(r.ok, `${l}/${path} serves`);
  }
console.log(
  `Governance HTTP smoke passed: ${checks} checks. Monitoring, cross-role facts, platform review, shop execution, receipt, resolution and reopening verified.`,
);
