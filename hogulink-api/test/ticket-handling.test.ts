import test from 'node:test';
import assert from 'node:assert/strict';
import { ticketHandlingInput, type Actor, type SupportTicket } from '@hogulink/contracts';
import { Engine } from '../src/engine.js';
import { Repository } from '../src/repository.js';
import { DomainError } from '../src/errors.js';

const admin: Actor = { id: 'admin-one', role: 'ADMIN', verificationLevel: 3 };
const second: Actor = { ...admin, id: 'admin-two' };
const customer: Actor = { id: 'customer', role: 'CUSTOMER', verificationLevel: 1 };
const merchant: Actor = { id: 'owner', role: 'MERCHANT', storeId: 'shop', verificationLevel: 1 };
const staff: Actor = {
  id: 'staff',
  role: 'STAFF',
  storeId: 'shop',
  staffId: 'staff-one',
  verificationLevel: 1,
};
const isCode = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;
const privateNote =
  'PRIVATE-OPS-NOTE: Verify the evidence and contact the reporter before continuing.';
async function fixture(
  fn: (e: Engine, ticket: SupportTicket, clock: { now: number }) => Promise<void>,
  privateCase = false,
) {
  const repo = new Repository(undefined, ':memory:');
  await repo.init();
  const clock = { now: Date.UTC(2026, 9, 18, 0) },
    e = new Engine(repo, () => clock.now);
  const t: SupportTicket = {
    id: 'case-one',
    storeId: 'shop',
    customerId: customer.id,
    reporterId: customer.id,
    reporterRole: 'CUSTOMER',
    category: privateCase ? 'PRIVACY' : 'SERVICE_QUALITY',
    subject: 'A sample support case',
    description: 'Sample case details for focused business tests.',
    visibility: privateCase ? 'PLATFORM_ONLY' : 'SHOP_AND_CUSTOMER',
    priority: 'NORMAL',
    status: 'OPEN',
    version: 1,
    createdAt: clock.now,
    updatedAt: clock.now,
    dueAt: clock.now + 24 * 3600000,
  };
  await repo.transaction((tx) => tx.put('supportTickets', t));
  try {
    await fn(e, t, clock);
  } finally {
    await repo.close();
  }
}
function input(e: Engine, extra = {}) {
  return {
    ticketVersion: 1,
    version: 0,
    team: 'CUSTOMER_SUPPORT',
    state: 'ACTIVE',
    ownership: 'CLAIM',
    followUpAt: e.now() + 3600000,
    note: privateNote,
    ...extra,
  };
}

test('case handling is admin-only even when the requester or shop can view the public case', () =>
  fixture(async (e, t) => {
    for (const actor of [customer, merchant, staff]) {
      await assert.rejects(e.handling.detail(actor, t.id), isCode('FORBIDDEN'));
      await assert.rejects(e.handling.update(actor, t.id, {}), isCode('FORBIDDEN'));
    }
    await assert.rejects(e.handling.detail(admin, 'missing'), isCode('NOT_FOUND'));
  }));
test('unhandled private cases default to the safety group without writing a record', () =>
  fixture(async (e, t) => {
    const d = await e.handling.detail(admin, t.id);
    assert.equal(d.handling.team, 'TRUST_SAFETY');
    assert.equal(d.handling.version, 0);
    assert.equal(d.handling.ownerId, null);
    assert.deepEqual(d.history, []);
    assert.deepEqual(await e.repo.transaction((tx) => tx.list('ticketHandling')), []);
  }, true));
test('claiming persists private notes while leaving public tickets, messages and deadlines unchanged', () =>
  fixture(async (e, t) => {
    const d = await e.handling.update(admin, t.id, input(e));
    assert.equal(d.handling.ownerId, admin.id);
    assert.equal(d.handling.version, 1);
    assert.equal(d.history[0].note, privateNote);
    assert.deepEqual((await e.care.detail(customer, t.id)).ticket, t);
    for (const actor of [customer, merchant, admin]) {
      const publicData = JSON.stringify([
        await e.care.list(actor),
        await e.care.detail(actor, t.id),
      ]);
      assert.equal(publicData.includes('PRIVATE-OPS-NOTE'), false);
      assert.equal(publicData.includes('ownerId'), false);
    }
    const snapshot = await e.admin.snapshot(admin);
    assert.equal(snapshot.caseHandling[0].ownerId, admin.id);
    assert.equal(JSON.stringify(snapshot).includes('PRIVATE-OPS-NOTE'), false);
    const queue = await e.repo.transaction((tx) => tx.list('outbox'));
    assert.deepEqual(queue, []);
  }));
test('both public ticket and private handling versions guard concurrent updates atomically', () =>
  fixture(async (e, t) => {
    await e.handling.update(admin, t.id, input(e));
    await assert.rejects(e.handling.update(second, t.id, input(e)), isCode('VERSION_CONFLICT'));
    await e.care.reply(customer, t.id, 1, 'Additional customer details');
    await assert.rejects(
      e.handling.update(admin, t.id, input(e, { version: 1 })),
      isCode('VERSION_CONFLICT'),
    );
    assert.equal((await e.handling.detail(admin, t.id)).history.length, 1);
  }));
test('a second administrator must explicitly release ownership; group changes return work to triage', () =>
  fixture(async (e, t) => {
    await e.handling.update(admin, t.id, input(e));
    await assert.rejects(
      e.handling.update(second, t.id, input(e, { version: 1 })),
      isCode('ALREADY_ASSIGNED'),
    );
    await assert.rejects(
      e.handling.update(
        second,
        t.id,
        input(e, { version: 1, team: 'TRUST_SAFETY', ownership: 'KEEP' }),
      ),
      isCode('OWNER_REQUIRED'),
    );
    const released = await e.handling.update(
      second,
      t.id,
      input(e, { version: 1, team: 'TRUST_SAFETY', state: 'TRIAGE', ownership: 'RELEASE' }),
    );
    assert.equal(released.handling.ownerId, null);
    const claimed = await e.handling.update(
      second,
      t.id,
      input(e, { version: 2, team: 'TRUST_SAFETY' }),
    );
    assert.equal(claimed.handling.ownerId, second.id);
    assert.equal(claimed.history.length, 3);
  }));
test('private reports cannot wait for shop replies; invalid schedules and unknown fields are rejected', () =>
  fixture(async (e, t) => {
    await assert.rejects(
      e.handling.update(admin, t.id, input(e, { state: 'WAITING_MERCHANT' })),
      isCode('PRIVATE_CASE'),
    );
    for (const followUpAt of [e.now(), e.now() - 1, e.now() + 7 * 86400000 + 1])
      await assert.rejects(
        e.handling.update(admin, t.id, input(e, { followUpAt })),
        isCode('INVALID_FOLLOW_UP'),
      );
    for (const extra of [{ note: 'short' }, { ownerId: 'invented-agent' }, { state: 'DONE' }])
      assert.equal(ticketHandlingInput.safeParse(input(e, extra)).success, false);
    assert.equal((await e.handling.detail(admin, t.id)).handling.version, 0);
  }, true));
test('requester and staff follow-up messages resume waiting work immediately', () =>
  fixture(async (e, t) => {
    await e.handling.update(admin, t.id, input(e, { state: 'WAITING_CUSTOMER' }));
    await e.care.reply(customer, t.id, 1, 'The requested additional evidence');
    let h = await e.handling.detail(admin, t.id);
    assert.equal(h.handling.state, 'ACTIVE');
    assert.equal(h.handling.followUpAt, e.now());
    assert.equal(h.history[0].kind, 'REPLY_RECEIVED');
    const updated = (await e.care.detail(customer, t.id)).ticket;
    await e.repo.transaction((tx) =>
      tx.put('supportTickets', {
        ...updated,
        reporterId: staff.id,
        reporterRole: 'STAFF',
        visibility: 'PLATFORM_ONLY',
      }),
    );
    await e.handling.update(
      admin,
      t.id,
      input(e, {
        ticketVersion: updated.version,
        version: h.handling.version,
        state: 'WAITING_CUSTOMER',
        ownership: 'KEEP',
      }),
    );
    await e.care.reply(staff, t.id, updated.version, 'Staff provided additional facts');
    h = await e.handling.detail(admin, t.id);
    assert.equal(h.handling.state, 'ACTIVE');
    assert.equal(h.history[0].kind, 'REPLY_RECEIVED');
  }));
test('only the awaited side resumes work and admin replies preserve waiting state', () =>
  fixture(async (e, t) => {
    await e.handling.update(admin, t.id, input(e, { state: 'WAITING_MERCHANT' }));
    await e.care.reply(admin, t.id, 1, 'Please provide the service record');
    assert.equal((await e.handling.detail(admin, t.id)).handling.state, 'WAITING_MERCHANT');
    await e.care.reply(customer, t.id, 2, 'Customer additional information');
    assert.equal((await e.handling.detail(admin, t.id)).handling.state, 'WAITING_MERCHANT');
    await e.care.reply(merchant, t.id, 3, 'The shop has supplied its service record');
    const h = await e.handling.detail(admin, t.id);
    assert.equal(h.handling.state, 'ACTIVE');
    assert.equal(h.history[0].kind, 'REPLY_RECEIVED');
  }));
test('resolution ends internal work and a reporter reopening returns it to the queue', () =>
  fixture(async (e, t) => {
    await e.handling.update(admin, t.id, input(e, { state: 'WAITING_CUSTOMER' }));
    await e.care.action(admin, t.id, {
      version: 1,
      action: 'RESOLVE',
      text: 'The case was reviewed and resolved.',
    });
    let h = await e.handling.detail(admin, t.id);
    assert.equal(h.handling.state, 'DONE');
    await assert.rejects(
      e.handling.update(admin, t.id, input(e, { ticketVersion: 2, version: h.handling.version })),
      isCode('INVALID_STATE'),
    );
    await e.care.action(customer, t.id, {
      version: 2,
      action: 'REOPEN',
      text: 'Please review this additional evidence.',
    });
    h = await e.handling.detail(admin, t.id);
    assert.equal(h.handling.state, 'ACTIVE');
    assert.equal(h.handling.ownerId, admin.id);
    assert.equal(h.history[0].kind, 'REOPENED');
  }));
test('overdue merchant escalation wakes the internal queue once without extending follow-up silently', () =>
  fixture(async (e, t, clock) => {
    await e.repo.transaction((tx) => tx.put('supportTickets', { ...t, status: 'NEEDS_MERCHANT' }));
    await e.handling.update(admin, t.id, input(e, { state: 'WAITING_MERCHANT' }));
    clock.now = t.dueAt + 1;
    const h = await e.handling.detail(admin, t.id);
    assert.equal(h.handling.state, 'ACTIVE');
    assert.equal(h.handling.followUpAt, clock.now);
    assert.equal(h.history[0].kind, 'ESCALATED');
    assert.equal((await e.care.detail(admin, t.id)).ticket.status, 'PLATFORM_ESCALATED');
    assert.equal((await e.handling.detail(admin, t.id)).history.length, 2);
  }));
test('released cases reopen in triage and never invent an owner', () =>
  fixture(async (e, t) => {
    await e.handling.update(admin, t.id, input(e, { state: 'TRIAGE', ownership: 'RELEASE' }));
    await e.care.action(admin, t.id, {
      version: 1,
      action: 'RESOLVE',
      text: 'Resolution for a triage-only case.',
    });
    await e.care.action(customer, t.id, {
      version: 2,
      action: 'REOPEN',
      text: 'Please reconsider the recorded result.',
    });
    const h = await e.handling.detail(admin, t.id);
    assert.equal(h.handling.state, 'TRIAGE');
    assert.equal(h.handling.ownerId, null);
  }));
