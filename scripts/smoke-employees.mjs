import './qa-clock.mjs';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000',
  apiOrigin = process.env.SMOKE_API_ORIGIN;
if (!apiOrigin) throw new Error('Use npm run smoke:isolated for employee account checks.');
let checks = 0;
const check = (v, message) => {
  assert.ok(v, message);
  checks++;
};
async function call(cookie, path, method = 'GET', body, status = 200, key) {
  const r = await fetch(`${apiOrigin}/v1/${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie && path !== 'auth/demo' ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  assert.equal(r.status, status, `${method} ${path}: ${JSON.stringify(d)}`);
  checks++;
  return d;
}
// RFC 6238 codes, matching the server's authenticator check.
function totp(secret, at) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0,
    value = 0;
  const bytes = [];
  for (const char of secret) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const mac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
const secrets = new Map(),
  lastStep = new Map();
/** The next unused code: the server allows one step of drift and never accepts a step twice. */
async function nextCode(email) {
  const step = Math.max(Math.floor(Date.now() / 30000), (lastStep.get(email) ?? -1) + 1);
  while (step > Math.floor(Date.now() / 30000) + 1) await new Promise((r) => setTimeout(r, 1000));
  lastStep.set(email, step);
  return totp(secrets.get(email), step * 30000);
}
async function enroll(token, email) {
  const invitation = await call('', 'auth/employee/invitation', 'POST', { token });
  check(/^otpauth:\/\/totp\//.test(invitation.totp.uri), 'activation shows authenticator setup');
  secrets.set(email, invitation.totp.secret);
  lastStep.delete(email);
}
async function signIn(path, body) {
  const r = await fetch(`${apiOrigin}/v1/${path}`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(r.status, 200);
  checks++;
  return { actor: await r.json(), cookie: r.headers.get('set-cookie').split(';')[0] };
}
const root = (await signIn('auth/demo', { role: 'ADMIN' })).cookie,
  customer = (await signIn('auth/demo', { role: 'CUSTOMER' })).cookie,
  reason = 'Reviewed this local employee workflow and documented the next handling step.';
const invitations = [];
for (const [adminRole, teams, email] of [
  ['SUPPORT', ['CUSTOMER_SUPPORT'], 'support.http@example.test'],
  ['FINANCE', [], 'finance.http@example.test'],
  ['TRUST_SAFETY', ['TRUST_SAFETY'], 'trust.http@example.test'],
])
  invitations.push(
    await call(
      root,
      'admin/members',
      'POST',
      { name: `HTTP ${adminRole}`, email, adminRole, teams },
      201,
    ),
  );
await call(
  root,
  'admin/members',
  'POST',
  {
    name: 'Duplicate email',
    email: 'SUPPORT.HTTP@EXAMPLE.TEST',
    adminRole: 'SUPPORT',
    teams: ['CUSTOMER_SUPPORT'],
  },
  409,
);
const i = invitations[0];
check(i.delivery === 'MANUAL_LOCAL_ONLY', 'no pretend email delivery');
check(
  !JSON.stringify(await call(root, 'admin/members')).includes(i.token),
  'invitation secret not in directory',
);
for (const invitation of invitations) {
  await enroll(invitation.token, invitation.member.email);
  await call(
    '',
    'auth/employee/activate',
    'POST',
    { token: invitation.token, password: 'short' },
    422,
  );
  await call('', 'auth/employee/activate', 'POST', {
    token: invitation.token,
    password: 'Sample-password-2026!',
    code: await nextCode(invitation.member.email),
  });
  await call(
    '',
    'auth/employee/activate',
    'POST',
    { token: invitation.token, password: 'Sample-password-2026!', code: '000000' },
    410,
  );
}
// A password alone never signs platform staff in.
await call(
  '',
  'auth/employee/login',
  'POST',
  { email: i.member.email, password: 'Sample-password-2026!' },
  401,
);
await call(
  '',
  'auth/employee/login',
  'POST',
  { email: i.member.email, password: 'Wrong-password-2026!' },
  401,
);
const support = await signIn('auth/employee/login', {
    email: i.member.email,
    password: 'Sample-password-2026!',
    code: await nextCode(i.member.email),
  }),
  finance = await signIn('auth/employee/login', {
    email: invitations[1].member.email,
    password: 'Sample-password-2026!',
    code: await nextCode(invitations[1].member.email),
  }),
  trust = await signIn('auth/employee/login', {
    email: invitations[2].member.email,
    password: 'Sample-password-2026!',
    code: await nextCode(invitations[2].member.email),
  });
for (const employee of [support, finance, trust]) {
  await call(employee.cookie, 'admin/members', 'GET', undefined, 403);
  await call(employee.cookie, 'dashboard', 'GET', undefined, 403);
}
await call(finance.cookie, 'support-tickets', 'GET', undefined, 403);
await call(finance.cookie, 'admin/reviews', 'POST', {}, 403);
await call(support.cookie, 'admin/customer-restrictions', 'GET', undefined, 403);
const booking = (await call(customer, 'bookings')).find((b) => b.storeId === 'store-nagi');
check(booking, 'reuse an isolated booking');
let ordinary = await call(
  customer,
  'customer/support-tickets',
  'POST',
  {
    bookingId: booking.id,
    category: 'SERVICE_QUALITY',
    subject: 'Employee dispatch HTTP case',
    description: 'Verify that a qualified active employee can own and reply to this case.',
  },
  201,
  'employee-http-shared',
);
let privateCase = await call(
  customer,
  'customer/support-tickets',
  'POST',
  {
    category: 'PRIVACY',
    subject: 'Protected employee HTTP case',
    description: 'Protected local report should be visible only inside the safety group.',
  },
  201,
  'employee-http-private',
);
await call(support.cookie, `support-tickets/${privateCase.id}`, 'GET', undefined, 404);
await call(trust.cookie, `support-tickets/${ordinary.id}`, 'GET', undefined, 404);
await call(trust.cookie, `support-tickets/${privateCase.id}`);
const path = `admin/support-tickets/${ordinary.id}/handling`,
  privatePath = `admin/support-tickets/${privateCase.id}/handling`;
const payload = {
  ticketVersion: ordinary.version,
  version: 0,
  team: 'CUSTOMER_SUPPORT',
  state: 'ACTIVE',
  ownership: 'ASSIGN',
  assigneeId: support.actor.id,
  followUpAt: Date.now() + 3600000,
  note: reason,
};
await call(support.cookie, path, 'PUT', payload, 403);
await call(root, path, 'PUT', { ...payload, assigneeId: finance.actor.id }, 409);
const work = await call(root, path, 'PUT', payload);
check(work.handling.ownerId === support.actor.id, 'qualified employee assigned');
await call(root, path, 'PUT', payload, 409);
const directory = (await call(root, path)).assignees;
check(
  directory.some((m) => m.id === support.actor.id) &&
    !directory.some((m) => m.id === finance.actor.id),
  'assignee directory includes handlers only',
);
ordinary = await call(support.cookie, `support-tickets/${ordinary.id}/messages`, 'POST', {
  version: ordinary.version,
  text: 'The assigned support employee has reviewed this local service report.',
});
await call(
  root,
  privatePath,
  'PUT',
  {
    ...payload,
    ticketVersion: privateCase.version,
    team: 'TRUST_SAFETY',
    assigneeId: support.actor.id,
  },
  409,
);
await call(root, privatePath, 'PUT', {
  ...payload,
  ticketVersion: privateCase.version,
  team: 'TRUST_SAFETY',
  assigneeId: trust.actor.id,
});
const snapshot = await call(support.cookie, 'admin/workspace');
check(
  snapshot.cases.some((c) => c.id === ordinary.id) &&
    !snapshot.cases.some((c) => c.id === privateCase.id),
  'snapshot respects groups',
);
check(
  snapshot.feeEntries.length === 0 &&
    snapshot.audit.length === 0 &&
    snapshot.system.queue.length === 0,
  'snapshot omits forbidden finance and audit details',
);
let member = (await call(root, 'admin/members')).members.find((m) => m.id === support.actor.id);
const update = (extra) => ({
  version: member.version,
  name: member.name,
  adminRole: member.adminRole,
  teams: member.teams,
  enabled: true,
  reason,
  ...extra,
});
const disabled = await call(root, `admin/members/${member.id}`, 'PUT', update({ enabled: false }));
member = disabled.member;
check(disabled.released === 1, 'disable returns unfinished work to triage');
await call(support.cookie, 'auth/session', 'GET', undefined, 401);
await call(
  support.cookie,
  `support-tickets/${ordinary.id}/messages`,
  'POST',
  { version: ordinary.version, text: 'A disabled employee cannot write another reply.' },
  401,
);
await call(
  '',
  'auth/employee/login',
  'POST',
  { email: member.email, password: 'Sample-password-2026!' },
  401,
);
const unassigned = await call(root, path);
check(
  unassigned.handling.ownerId === null &&
    unassigned.handling.state === 'TRIAGE' &&
    unassigned.history[0].kind === 'OWNER_UNAVAILABLE',
  'unavailable owner recorded without duplicate replies',
);
member = (await call(root, `admin/members/${member.id}`, 'PUT', update())).member;
check(member.status === 'INVITED', 'enable requires fresh activation');
const reset = await call(root, `admin/members/${member.id}/invitation`, 'POST', {
  version: member.version,
  reason,
});
await call('', 'auth/employee/invitation', 'POST', { token: i.token }, 410);
// A new link resets the authenticator too.
await enroll(reset.token, member.email);
await call('', 'auth/employee/activate', 'POST', {
  token: reset.token,
  password: 'Replacement-password-2026!',
  code: await nextCode(member.email),
});
const restored = await signIn('auth/employee/login', {
  email: member.email,
  password: 'Replacement-password-2026!',
  code: await nextCode(member.email),
});
member = (await call(root, 'admin/members')).members.find((m) => m.id === member.id);
await call(root, `admin/members/${member.id}`, 'PUT', update({ adminRole: 'FINANCE', teams: [] }));
await call(restored.cookie, 'auth/session', 'GET', undefined, 401);
const changed = await signIn('auth/employee/login', {
  email: member.email,
  password: 'Replacement-password-2026!',
  code: await nextCode(member.email),
});
check(changed.actor.adminRole === 'FINANCE', 'new login uses updated role');
await call(changed.cookie, 'support-tickets', 'GET', undefined, 403);
const owner = (await call(root, 'admin/members')).members.find((m) => m.id === 'demo-admin');
await call(
  root,
  'admin/members/demo-admin',
  'PUT',
  {
    version: owner.version,
    name: owner.name,
    adminRole: 'FINANCE',
    teams: [],
    enabled: false,
    reason,
  },
  409,
);
for (const t of [ordinary, privateCase])
  await call(root, `support-tickets/${t.id}/actions`, 'POST', {
    version: t.version,
    action: 'RESOLVE',
    text: 'Resolved this isolated employee workflow without changing bookings or payments.',
  });
for (const locale of ['ja', 'en', 'zh-cn'])
  for (const path of ['admin?tab=members', 'admin/login', 'admin/activate?token=invalid']) {
    const r = await fetch(`${origin}/${locale}/${path}`),
      html = await r.text();
    check(r.ok && html.includes('noindex'), `${locale} private employee page`);
    if (path.includes('activate'))
      check(html.includes('no-referrer'), 'invitation page suppresses referrer');
  }
console.log(
  `Employee HTTP smoke passed: ${checks} checks. Invitations, permissions, dispatch and session revocation verified in memory.`,
);
