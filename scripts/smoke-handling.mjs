import './qa-clock.mjs';
import assert from 'node:assert/strict';
const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000',
  apiOrigin = process.env.SMOKE_API_ORIGIN;
if (!apiOrigin || !['127.0.0.1', 'localhost'].includes(new URL(apiOrigin).hostname))
  throw new Error('Use npm run smoke:isolated for case handling checks.');
let checks = 0;
function check(v, message) {
  assert.ok(v, message);
  checks++;
}
async function call(cookie, path, method = 'GET', body, status = 200, key) {
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
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(value)}`);
  checks++;
  return value;
}
async function login(role, extra = {}) {
  const r = await fetch(`${apiOrigin}/v1/auth/demo`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, ...extra }),
  });
  check(r.ok, 'login');
  return r.headers.get('set-cookie').split(';')[0];
}
const customer = await login('CUSTOMER'),
  merchant = await login('MERCHANT', { storeId: 'store-nagi' }),
  staff = await login('STAFF', { staffId: 'staff-aoi' }),
  admin = await login('ADMIN');
const booking = (await call(customer, 'bookings')).find((b) => b.storeId === 'store-nagi');
check(booking, 'Reuse an existing isolated booking without consuming holds');
let ticket = await call(
  customer,
  'customer/support-tickets',
  'POST',
  {
    bookingId: booking.id,
    category: 'SERVICE_QUALITY',
    subject: 'Follow-up workflow HTTP case',
    description: 'Please check the local service record and confirm the follow-up plan.',
  },
  201,
  'handling-http-shared',
);
const privateCase = await call(
  customer,
  'customer/support-tickets',
  'POST',
  {
    category: 'PRIVACY',
    subject: 'Confidential handling HTTP case',
    description: 'Only the platform should review this private local support report.',
  },
  201,
  'handling-http-private',
);
const path = `admin/support-tickets/${ticket.id}/handling`,
  privatePath = `admin/support-tickets/${privateCase.id}/handling`;
const note = 'HANDLING_PRIVATE_HTTP_NOTE: review records and document the next operational action.';
let h = (await call(admin, path)).handling;
const input = (extra = {}) => ({
  ticketVersion: ticket.version,
  version: h.version,
  team: 'CUSTOMER_SUPPORT',
  state: 'WAITING_CUSTOMER',
  ownership: 'CLAIM',
  followUpAt: Date.now() + 3600000,
  note,
  ...extra,
});
await call('', path, 'GET', undefined, 401);
for (const cookie of [customer, merchant, staff]) {
  await call(cookie, path, 'GET', undefined, 403);
  await call(cookie, path, 'PUT', input(), 403);
}
let result = await call(admin, path, 'PUT', input());
h = result.handling;
check(h.ownerId === 'demo-admin' && h.state === 'WAITING_CUSTOMER', 'persist ownership and state');
check(result.history[0].note === note, 'persist private note');
await call(admin, path, 'PUT', input({ version: 0 }), 409);
await call(admin, path, 'PUT', input({ ownerId: 'invented' }), 422);
await call(admin, path, 'PUT', input({ note: 'short' }), 422);
await call(admin, path, 'PUT', input({ followUpAt: Date.now() - 1000 }), 409);
const publicDetail = await call(customer, `support-tickets/${ticket.id}`);
check(
  publicDetail.ticket.dueAt === ticket.dueAt,
  'internal follow-up cannot extend response target',
);
for (const cookie of [customer, merchant, admin]) {
  check(
    !JSON.stringify(await call(cookie, 'support-tickets')).includes('HANDLING_PRIVATE_HTTP_NOTE'),
    'notes excluded from ticket list',
  );
  const detail = await call(cookie, `support-tickets/${ticket.id}`);
  check(
    !JSON.stringify(detail).includes('HANDLING_PRIVATE_HTTP_NOTE') && !('handling' in detail),
    'notes excluded from public detail',
  );
}
let snapshot = await call(admin, 'admin/workspace');
check(
  snapshot.caseHandling.some((x) => x.id === ticket.id && x.ownerId === 'demo-admin'),
  'queue reflects owner',
);
check(
  !JSON.stringify(snapshot).includes('HANDLING_PRIVATE_HTTP_NOTE'),
  'queue and shared audit omit note text',
);
ticket = await call(customer, `support-tickets/${ticket.id}/messages`, 'POST', {
  version: ticket.version,
  text: 'Customer supplied the requested additional information.',
});
result = await call(admin, path);
h = result.handling;
check(h.state === 'ACTIVE' && h.followUpAt <= Date.now(), 'reporter reply wakes work queue');
check(result.history[0].kind === 'REPLY_RECEIVED', 'reply resumption logged');
await call(admin, path, 'PUT', input({ ticketVersion: 1 }), 409);
result = await call(admin, path, 'PUT', input({ state: 'WAITING_MERCHANT', ownership: 'KEEP' }));
h = result.handling;
ticket = await call(merchant, `support-tickets/${ticket.id}/messages`, 'POST', {
  version: ticket.version,
  text: 'The shop supplied the requested service records.',
});
result = await call(admin, path);
h = result.handling;
check(h.state === 'ACTIVE', 'shop reply resumes awaiting work');
ticket = await call(admin, `support-tickets/${ticket.id}/actions`, 'POST', {
  version: ticket.version,
  action: 'RESOLVE',
  text: 'Reviewed the local case and recorded a resolution.',
});
result = await call(admin, path);
h = result.handling;
check(h.state === 'DONE', 'resolution completes internal handling');
await call(admin, path, 'PUT', input(), 409);
ticket = await call(customer, `support-tickets/${ticket.id}/actions`, 'POST', {
  version: ticket.version,
  action: 'REOPEN',
  text: 'Please review the new local evidence before closing.',
});
result = await call(admin, path);
h = result.handling;
check(h.state === 'ACTIVE' && h.ownerId === 'demo-admin', 'reopen restores owner and work');
result = await call(
  admin,
  path,
  'PUT',
  input({ state: 'TRIAGE', team: 'MERCHANT_OPERATIONS', ownership: 'RELEASE' }),
);
h = result.handling;
check(h.ownerId === null && h.team === 'MERCHANT_OPERATIONS', 'explicit release and team routing');
await call(admin, path, 'PUT', input({ ownership: 'KEEP' }), 409);
const privateInput = {
  ticketVersion: privateCase.version,
  version: 0,
  team: 'TRUST_SAFETY',
  state: 'WAITING_MERCHANT',
  ownership: 'CLAIM',
  followUpAt: Date.now() + 3600000,
  note,
};
await call(admin, privatePath, 'PUT', privateInput, 409);
await call(merchant, `support-tickets/${privateCase.id}`, 'GET', undefined, 404);
const privateHandling = await call(admin, privatePath);
check(
  privateHandling.handling.team === 'TRUST_SAFETY' && privateHandling.history.length === 0,
  'private routing failure is atomic',
);
for (const t of [ticket, privateCase])
  await call(admin, `support-tickets/${t.id}/actions`, 'POST', {
    version: t.version,
    action: 'RESOLVE',
    text: 'Completed this isolated workflow check without changing the booking.',
  });
snapshot = await call(admin, 'admin/workspace');
check(
  snapshot.caseHandling.find((x) => x.id === ticket.id).state === 'DONE',
  'finished queue updated',
);
for (const locale of ['ja', 'en', 'zh-cn']) {
  const r = await fetch(`${origin}/${locale}/admin/support?case=${ticket.id}`),
    html = await r.text();
  check(r.ok && html.includes('noindex'), `${locale} private support page`);
}
console.log(
  `Case handling HTTP smoke passed: ${checks} checks. Test cases resolved; no booking or payment changes.`,
);
