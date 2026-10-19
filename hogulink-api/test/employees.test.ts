import test from 'node:test';
import assert from 'node:assert/strict';
import { type Actor, type AdminMember, type SupportTicket } from '@hogulink/contracts';
import { Repository } from '../src/repository.js';
import { Engine } from '../src/engine.js';
import { bootstrapAdmin } from '../src/employees.js';
import { authorizeAdminRoute, currentAdmin } from '../src/admin-access.js';
import { DomainError } from '../src/errors.js';
const root: Actor = { id: 'demo-admin', role: 'ADMIN', verificationLevel: 3 };
const password = 'Sample-password-2026!';
const reason = 'Reviewed this local account change and the related handling responsibilities.';
const code = (value: string) => (e: unknown) => e instanceof DomainError && e.code === value;
async function fixture(fn: (e: Engine, clock: { now: number }) => Promise<void>) {
  const repo = new Repository(undefined, ':memory:');
  await repo.init();
  const clock = { now: Date.UTC(2026, 9, 18) };
  await bootstrapAdmin(repo, clock.now);
  const e = new Engine(repo, () => clock.now);
  try {
    await fn(e, clock);
  } finally {
    await repo.close();
  }
}
async function member(
  e: Engine,
  adminRole: AdminMember['adminRole'] = 'SUPPORT',
  teams: AdminMember['teams'] = ['CUSTOMER_SUPPORT'],
  suffix = 'one',
) {
  const invitation = await e.employees.create(root, {
    name: `Employee ${suffix}`,
    email: `${suffix}@example.test`,
    adminRole,
    teams,
  });
  await e.employees.activate({ token: invitation.token, password });
  const actor = await e.employees.login({ email: invitation.member.email, password });
  return { actor, invitation };
}
async function ticket(
  e: Engine,
  id = 'case-one',
  category: SupportTicket['category'] = 'SERVICE_QUALITY',
) {
  const t: SupportTicket = {
    id,
    customerId: 'customer',
    reporterId: 'customer',
    reporterRole: 'CUSTOMER',
    category,
    subject: 'Sample service case',
    description: 'Local support case details for permission checks.',
    visibility: category === 'PRIVACY' ? 'PLATFORM_ONLY' : 'SHOP_AND_CUSTOMER',
    priority: 'NORMAL',
    status: 'OPEN',
    version: 1,
    createdAt: e.now(),
    updatedAt: e.now(),
    dueAt: e.now() + 86400000,
  };
  await e.repo.transaction((tx) => tx.put('supportTickets', t));
  return t;
}
const work = (e: Engine, extra = {}) => ({
  ticketVersion: 1,
  version: 0,
  team: 'CUSTOMER_SUPPORT',
  state: 'ACTIVE',
  ownership: 'ASSIGN',
  followUpAt: e.now() + 3600000,
  note: reason,
  ...extra,
});
async function edit(e: Engine, id: string, extra = {}) {
  const m = (await e.employees.list(root)).members.find((m) => m.id === id)!;
  return e.employees.update(root, id, {
    version: m.version,
    name: m.name,
    adminRole: m.adminRole,
    teams: m.teams,
    enabled: true,
    reason,
    ...extra,
  });
}

test('employee invitations normalize unique email and expose no token or password hash in directories or audit', () =>
  fixture(async (e) => {
    const i = await e.employees.create(root, {
      name: 'Local Support',
      email: ' SUPPort@Example.Test ',
      adminRole: 'SUPPORT',
      teams: ['CUSTOMER_SUPPORT'],
    });
    assert.equal(i.member.email, 'support@example.test');
    assert.match(i.token, /^[a-f0-9]{64}$/);
    await assert.rejects(
      e.employees.create(root, {
        name: 'Duplicate',
        email: 'support@example.test',
        adminRole: 'FINANCE',
        teams: [],
      }),
      code('EMAIL_EXISTS'),
    );
    const list = JSON.stringify(await e.employees.list(root)),
      audit = JSON.stringify(await e.repo.transaction((tx) => tx.list('audit')));
    assert.equal(list.includes(i.token), false);
    assert.equal(list.includes('inviteHash'), false);
    assert.equal(audit.includes(i.token), false);
    assert.equal(audit.includes('support@example.test'), false);
    await assert.rejects(
      e.employees.list({ id: 'customer', role: 'CUSTOMER', verificationLevel: 1 }),
      code('FORBIDDEN'),
    );
  }));
test('accepting an invitation is one-use, validates password length, and stores salted hashes only', () =>
  fixture(async (e) => {
    const i = await e.employees.create(root, {
      name: 'Local Finance',
      email: 'finance@example.test',
      adminRole: 'FINANCE',
      teams: [],
    });
    await assert.rejects(e.employees.activate({ token: i.token, password: 'short' }));
    await e.employees.activate({ token: i.token, password });
    await assert.rejects(
      e.employees.activate({ token: i.token, password }),
      code('INVITE_INVALID'),
    );
    await assert.rejects(e.employees.inspect({ token: i.token }), code('INVITE_INVALID'));
    const c = await e.repo.transaction((tx) =>
      tx.get<{ hash: string; inviteHash?: string }>('adminCredentials', i.member.id),
    );
    assert.equal(c?.hash.length, 128);
    assert.equal(JSON.stringify(c).includes(password), false);
    assert.equal(c?.inviteHash, undefined);
    const actor = await e.employees.login({ email: 'FINANCE@EXAMPLE.TEST', password });
    assert.equal(actor.adminRole, 'FINANCE');
    assert.deepEqual(actor.adminTeams, []);
  }));
test('expired or superseded invitations cannot activate and return no account details', () =>
  fixture(async (e, clock) => {
    const i = await e.employees.create(root, {
      name: 'Invited staff',
      email: 'invite@example.test',
      adminRole: 'SUPPORT',
      teams: ['CUSTOMER_SUPPORT'],
    });
    const next = await e.employees.reissue(root, i.member.id, { version: 1, reason });
    await assert.rejects(e.employees.inspect({ token: i.token }), code('INVITE_INVALID'));
    clock.now = next.expiresAt + 1;
    await assert.rejects(
      e.employees.activate({ token: next.token, password }),
      code('INVITE_INVALID'),
    );
  }));
test('group membership must match the role and protected safety work cannot be assigned to support', () =>
  fixture(async (e) => {
    for (const [adminRole, teams] of [
      ['SUPPORT', ['TRUST_SAFETY']],
      ['FINANCE', ['CUSTOMER_SUPPORT']],
      ['TRUST_SAFETY', ['MERCHANT_OPERATIONS']],
      ['OPERATIONS', []],
    ] as const)
      await assert.rejects(
        e.employees.create(root, {
          name: 'Invalid role',
          email: 'invalid@example.test',
          adminRole,
          teams,
        }),
        code('INVALID_TEAM'),
      );
    const m = await member(e);
    await ticket(e, 'private', 'PRIVACY');
    await assert.rejects(e.handling.detail(m.actor, 'private'), code('NOT_FOUND'));
    assert.equal((await e.care.list(m.actor)).length, 0);
    await assert.rejects(
      e.handling.update(root, 'private', work(e, { assigneeId: m.actor.id })),
      code('INVALID_TEAM'),
    );
  }));
test('finance and audit users cannot use case, member, review or legacy aggregate mutation routes', () =>
  fixture(async (e) => {
    const m = await member(e, 'FINANCE', []);
    for (const [path, method] of [
      ['admin/members', 'GET'],
      ['admin/reviews', 'POST'],
      ['admin/enforcement-actions', 'POST'],
      ['support-tickets', 'GET'],
      ['dashboard', 'GET'],
      ['admin/customer-restrictions', 'POST'],
    ])
      assert.throws(() => authorizeAdminRoute(m.actor, path, method), code('FORBIDDEN'));
    await assert.rejects(e.admin.review(m.actor, {}), code('FORBIDDEN'));
    await assert.rejects(e.enforce(m.actor, 'missing', true, reason), code('FORBIDDEN'));
    await assert.rejects(e.employees.list(m.actor), code('FORBIDDEN'));
    const s = await e.admin.snapshot(m.actor);
    assert.deepEqual(s.cases, []);
    assert.deepEqual(s.reviews, []);
    assert.deepEqual(s.audit, []);
    assert.deepEqual(s.system.queue, []);
  }));
test('dispatch validates active recipients and their team while support can act only after owning the case', () =>
  fixture(async (e) => {
    const one = await member(e),
      other = await member(e, 'SUPPORT', ['MERCHANT_OPERATIONS'], 'other');
    const t = await ticket(e);
    await assert.rejects(
      e.care.reply(one.actor, t.id, 1, 'Reply before ownership'),
      code('OWNER_REQUIRED'),
    );
    await assert.rejects(
      e.handling.update(root, t.id, work(e, { assigneeId: other.actor.id })),
      code('INVALID_ASSIGNEE'),
    );
    const d = await e.handling.update(root, t.id, work(e, { assigneeId: one.actor.id }));
    assert.equal(d.handling.ownerId, one.actor.id);
    await assert.rejects(
      e.handling.update(one.actor, t.id, work(e, { version: 1, assigneeId: other.actor.id })),
      code('FORBIDDEN'),
    );
    const replied = await e.care.reply(
      one.actor,
      t.id,
      1,
      'The assigned support employee replied.',
    );
    assert.equal(replied.version, 2);
  }));
test('a non-dispatcher cannot release or edit another employee’s case within the same group', () =>
  fixture(async (e) => {
    const one = await member(e),
      two = await member(e, 'SUPPORT', ['CUSTOMER_SUPPORT'], 'two');
    const t = await ticket(e);
    await e.handling.update(root, t.id, work(e, { assigneeId: one.actor.id }));
    await assert.rejects(
      e.handling.update(
        two.actor,
        t.id,
        work(e, { version: 1, ownership: 'RELEASE', state: 'TRIAGE' }),
      ),
      code('FORBIDDEN'),
    );
    await assert.rejects(
      e.care.reply(two.actor, t.id, 1, 'Another employee tries replying.'),
      code('OWNER_REQUIRED'),
    );
  }));
test('disabling an employee immediately revokes old sessions and releases unfinished work once', () =>
  fixture(async (e) => {
    const { actor } = await member(e);
    const t = await ticket(e);
    await e.handling.update(root, t.id, work(e, { assigneeId: actor.id }));
    const finished = await ticket(e, 'finished');
    await e.handling.update(root, finished.id, work(e, { assigneeId: actor.id }));
    await e.care.action(root, finished.id, {
      version: 1,
      action: 'RESOLVE',
      text: 'Completed before the assigned employee left the team.',
    });
    const changed = await edit(e, actor.id, { enabled: false });
    assert.equal(changed.released, 1);
    await assert.rejects(
      e.repo.transaction((tx) => currentAdmin(tx, actor)),
      code('UNAUTHENTICATED'),
    );
    await assert.rejects(
      e.employees.login({ email: 'one@example.test', password }),
      code('INVALID_CREDENTIALS'),
    );
    const d = await e.handling.detail(root, t.id);
    assert.equal(d.handling.ownerId, null);
    assert.equal(d.handling.state, 'TRIAGE');
    assert.equal(d.history[0].kind, 'OWNER_UNAVAILABLE');
    assert.equal(d.handling.followUpAt, e.now());
    await edit(e, actor.id, { enabled: false });
    assert.equal((await e.handling.detail(root, t.id)).history.length, 2);
    await e.care.action({ id: 'customer', role: 'CUSTOMER', verificationLevel: 1 }, finished.id, {
      version: 2,
      action: 'REOPEN',
      text: 'Review new details after the original handler left.',
    });
    const reopened = await e.handling.detail(root, finished.id);
    assert.equal(reopened.handling.ownerId, null);
    assert.equal(reopened.handling.state, 'TRIAGE');
  }));
test('role or team changes release only the work that loses eligibility and revoke the previous session', () =>
  fixture(async (e) => {
    const { actor } = await member(e, 'OPERATIONS', ['CUSTOMER_SUPPORT', 'MERCHANT_OPERATIONS']);
    await ticket(e, 'a');
    await ticket(e, 'b', 'MERCHANT_UNREACHABLE');
    await e.handling.update(root, 'a', work(e, { assigneeId: actor.id }));
    await e.handling.update(
      root,
      'b',
      work(e, { assigneeId: actor.id, team: 'MERCHANT_OPERATIONS' }),
    );
    const changed = await edit(e, actor.id, { teams: ['CUSTOMER_SUPPORT'] });
    assert.equal(changed.released, 1);
    assert.equal((await e.handling.detail(root, 'a')).handling.ownerId, actor.id);
    assert.equal((await e.handling.detail(root, 'b')).handling.ownerId, null);
    await assert.rejects(
      e.repo.transaction((tx) => currentAdmin(tx, actor)),
      code('UNAUTHENTICATED'),
    );
    const again = await e.employees.login({ email: 'one@example.test', password });
    assert.deepEqual(again.adminTeams, ['CUSTOMER_SUPPORT']);
  }));
test('reset access invalidates both old password and invitation while sending active work to triage', () =>
  fixture(async (e) => {
    const { actor } = await member(e);
    const t = await ticket(e);
    await e.handling.update(root, t.id, work(e, { assigneeId: actor.id }));
    const m = (await e.employees.list(root)).members.find((m) => m.id === actor.id)!;
    const i = await e.employees.reissue(root, m.id, { version: m.version, reason });
    assert.equal(i.released, 1);
    await assert.rejects(
      e.employees.login({ email: m.email, password }),
      code('INVALID_CREDENTIALS'),
    );
    await edit(e, m.id, { name: 'Updated pending account' });
    await assert.rejects(
      e.employees.login({ email: m.email, password }),
      code('INVALID_CREDENTIALS'),
    );
    await e.employees.activate({ token: i.token, password: 'Changed-password-2026!' });
    await assert.rejects(
      e.employees.login({ email: m.email, password }),
      code('INVALID_CREDENTIALS'),
    );
    assert.equal(
      (await e.employees.login({ email: m.email, password: 'Changed-password-2026!' })).id,
      m.id,
    );
  }));
test('re-enabling a disabled account requires a fresh invitation and activation', () =>
  fixture(async (e) => {
    const { actor, invitation } = await member(e);
    await edit(e, actor.id, { enabled: false });
    const enabled = await edit(e, actor.id, { enabled: true });
    assert.equal(enabled.member.status, 'INVITED');
    await assert.rejects(
      e.employees.activate({ token: invitation.token, password }),
      code('INVITE_INVALID'),
    );
    await assert.rejects(
      e.employees.login({ email: invitation.member.email, password }),
      code('INVALID_CREDENTIALS'),
    );
    const reissued = await e.employees.reissue(root, actor.id, {
      version: enabled.member.version,
      reason,
    });
    await e.employees.activate({ token: reissued.token, password });
    assert.equal(
      (await e.employees.login({ email: invitation.member.email, password })).id,
      actor.id,
    );
  }));
test('self and bootstrap access are protected and concurrent member edits have one winner', () =>
  fixture(async (e) => {
    await assert.rejects(edit(e, 'demo-admin', { enabled: false }), code('SELF_MANAGEMENT'));
    const { actor } = await member(e, 'OWNER', []);
    const m = (await e.employees.list(root)).members.find((m) => m.id === actor.id)!;
    await assert.rejects(
      e.employees.update(actor, m.id, {
        version: m.version,
        name: m.name,
        adminRole: 'FINANCE',
        teams: [],
        enabled: true,
        reason,
      }),
      code('SELF_MANAGEMENT'),
    );
    const input = {
      version: m.version,
      name: m.name,
      adminRole: 'FINANCE',
      teams: [],
      enabled: true,
      reason,
    };
    const results = await Promise.allSettled([
      e.employees.update(root, m.id, input),
      e.employees.update(root, m.id, input),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.ok(results.some((r) => r.status === 'rejected' && code('VERSION_CONFLICT')(r.reason)));
  }));
test('concurrent case dispatch preserves a single recipient and stale updates do not append duplicate notes', () =>
  fixture(async (e) => {
    const one = await member(e),
      two = await member(e, 'SUPPORT', ['CUSTOMER_SUPPORT'], 'two');
    await ticket(e);
    const results = await Promise.allSettled([
      e.handling.update(root, 'case-one', work(e, { assigneeId: one.actor.id })),
      e.handling.update(root, 'case-one', work(e, { assigneeId: two.actor.id })),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await e.handling.detail(root, 'case-one')).history.length, 1);
  }));
test('customer and merchant views never receive employee directories or internal assignment logs', () =>
  fixture(async (e) => {
    const { actor } = await member(e);
    await ticket(e);
    await e.handling.update(root, 'case-one', work(e, { assigneeId: actor.id }));
    const data = JSON.stringify(
      await e.care.detail({ id: 'customer', role: 'CUSTOMER', verificationLevel: 1 }, 'case-one'),
    );
    assert.equal(data.includes('Employee one'), false);
    assert.equal(data.includes('assignees'), false);
    assert.equal(data.includes(reason), false);
  }));
