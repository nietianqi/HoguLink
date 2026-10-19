import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type {
  Actor,
  AdminMember,
  Booking,
  OrderAlert,
  SupportTicket,
  TicketHandling,
  TicketMessage,
} from '@hogulink/contracts';
import {
  fixture,
  booking,
  complete,
  customer,
  shop,
  staff,
  admin,
} from './helpers/experience-fixture.js';
import type { Engine } from '../src/engine.js';
import { DomainError } from '../src/errors.js';
const code = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;
async function dispute(e: Engine, clock: { now: number }, reply = true) {
  const b = await complete(e, clock),
    r = await e.refunds.request(
      customer,
      b.id,
      {
        bookingVersion: b.version,
        amount: 2000,
        reason: 'The service circumstances need a detailed review and a partial refund.',
        locale: 'en',
      },
      randomUUID(),
    );
  let t = (await e.care.detail(customer, r.ticketId)).ticket;
  if (reply)
    t = await e.care.reply(
      shop,
      t.id,
      t.version,
      'The therapist checked the actual visit facts and the shop confirms its statement.',
    );
  t = await e.care.action(customer, t.id, {
    version: t.version,
    action: 'ESCALATE',
    text: 'Please review both statements and coordinate a suitable resolution.',
  });
  return { b, r, t };
}
async function proposal(e: Engine, t: SupportTicket, outcome = 'REFUND', amount = 1000) {
  const d = await e.governance.detail(admin, t.id),
    detail = await e.care.detail(admin, t.id);
  return {
    ticketVersion: detail.ticket.version,
    version: d.current?.version ?? 0,
    bookingVersion: d.bookingVersion,
    refundVersion: d.refundVersion,
    outcome,
    amount,
    summary: 'The original report and the shop statement were reviewed against the actual order.',
    reason: 'The shop should process the proposed amount through the pending refund request.',
    evidenceIds: detail.messages
      .filter((m) => m.role === 'MERCHANT' && m.kind === 'MESSAGE')
      .map((m) => m.id),
    merchantUnreachable: false,
  };
}
async function refund(
  e: Engine,
  r: { id: string; ticketId: string },
  amount = 1000,
  action = 'APPROVE',
) {
  const d = (await e.refunds.forTicket(shop, r.ticketId))!;
  return e.refunds.decide(
    shop,
    r.id,
    {
      version: d.request.version,
      bookingVersion: d.bookingVersion,
      action,
      amount,
      text: 'The original shop reviewed and processed this refund request.',
    },
    randomUUID(),
  );
}
async function close(e: Engine, id: string) {
  const t = (await e.care.detail(admin, id)).ticket;
  return e.care.action(admin, id, {
    version: t.version,
    action: 'RESOLVE',
    text: 'The actual execution result has been checked and this case can be resolved.',
  });
}
async function employee(e: Engine, overrides: Partial<AdminMember> = {}): Promise<Actor> {
  const m: AdminMember = {
    id: 'member_governance',
    name: 'Case Agent',
    email: 'case@example.test',
    status: 'ACTIVE',
    adminRole: 'SUPPORT',
    teams: ['CUSTOMER_SUPPORT'],
    version: 1,
    sessionVersion: 1,
    createdAt: e.now(),
    updatedAt: e.now(),
    ...overrides,
  };
  await e.repo.transaction((tx) => tx.put('adminMembers', m));
  return {
    id: m.id,
    role: 'ADMIN',
    verificationLevel: 3,
    adminRole: m.adminRole,
    adminTeams: m.teams,
    adminSessionVersion: 1,
  };
}
test('monitor rejects every non-platform role', () =>
  fixture(async (e) => {
    for (const a of [customer, shop, staff])
      await assert.rejects(() => e.governance.monitor(a), code('FORBIDDEN'));
  }));
test('approaching response alerts are stable, deduplicated and redact customer details', () =>
  fixture(async (e, clock) => {
    const b = await booking(e);
    clock.now = b.deadline - 4 * 60000;
    const a = (await e.governance.monitor(admin)).alerts.find((a) => a.bookingId === b.id)!;
    assert.equal(a.kind, 'RESPONSE_DUE');
    const again = (await e.governance.monitor(admin)).alerts.find((x) => x.id === a.id)!;
    assert.equal(again.version, a.version);
    assert.equal(again.generation, 1);
    const serialized = JSON.stringify(again);
    for (const value of ['Private QA address', 'customerId', 'paymentId', 'QA Guest', 'room'])
      assert(!serialized.includes(value));
    const events = await e.repo.transaction((tx) => tx.list<any>('outbox'));
    assert.equal(
      events.filter((x) => x.type === 'ORDER_ALERT_OPENED' && x.target === a.id).length,
      1,
    );
  }));
test('following an alert preserves the condition and records only private notes', () =>
  fixture(async (e, clock) => {
    const b = await booking(e);
    clock.now = b.deadline - 60000;
    const a = (await e.governance.monitor(admin)).alerts.find((x) => x.bookingId === b.id)!;
    const watched = await e.governance.watch(admin, a.id, {
      version: a.version,
      action: 'WATCH',
      followUpAt: clock.now + 600000,
      note: 'Private internal triage note for this order.',
    });
    assert.equal(watched.state, 'WATCHING');
    const finance = await employee(e, { id: 'member_readonly', adminRole: 'FINANCE' }),
      readonly = (await e.governance.monitor(finance)).alerts.find((x) => x.id === a.id)!;
    assert.equal(readonly.note, undefined);
    assert.equal(readonly.ownerId, undefined);
    assert.equal(readonly.state, 'WATCHING');
    assert.equal(
      (await e.governance.monitor(admin)).alerts.find((x) => x.id === a.id)!.state,
      'WATCHING',
    );
    assert(
      !JSON.stringify(await e.repo.transaction((tx) => tx.list('outbox'))).includes(
        'Private internal triage',
      ),
    );
    await assert.rejects(
      () =>
        e.governance.watch(admin, a.id, {
          version: a.version,
          action: 'WATCH',
          followUpAt: clock.now + 600000,
          note: 'A stale follow-up must not overwrite the current owner.',
        }),
      code('VERSION_CONFLICT'),
    );
  }));
test('a confirmed response automatically recovers its alert without admin dismissal', () =>
  fixture(async (e, clock) => {
    let b = await booking(e);
    clock.now = b.deadline - 60000;
    const a = (await e.governance.monitor(admin)).alerts.find((x) => x.bookingId === b.id)!;
    b = await e.ack(staff, b.id, b.version);
    assert.equal(
      (await e.governance.monitor(admin)).alerts.find((x) => x.id === a.id)!.state,
      'RESOLVED',
    );
    await assert.rejects(
      () =>
        e.governance.watch(admin, a.id, {
          version: a.version,
          action: 'WATCH',
          followUpAt: clock.now + 600000,
          note: 'A recovered condition cannot be marked active.',
        }),
      code('VERSION_CONFLICT'),
    );
  }));
test('late scheduled and instant arrival alerts recover after actual arrival', () =>
  fixture(async (e, clock) => {
    let b = await booking(e);
    b = await e.ack(staff, b.id, b.version);
    clock.now = b.quote.startAt + 15 * 60000;
    const a = (await e.governance.monitor(admin)).alerts.find((x) => x.kind === 'LATE_ARRIVAL')!;
    assert(a);
    b = await e.event(staff, b.id, b.version, 'EN_ROUTE');
    b = await e.event(staff, b.id, b.version, 'ARRIVED');
    assert.equal(
      (await e.governance.monitor(admin)).alerts.find((x) => x.id === a.id)!.state,
      'RESOLVED',
    );
    b = await e.event(staff, b.id, b.version, 'START');
    clock.now = b.startedAt! + b.quote.endAt - b.quote.startAt;
    b = await e.event(staff, b.id, b.version, 'COMPLETE');
    clock.now += 86400000;
    await e.repo.transaction(async (tx) => {
      for (const l of await tx.list<any>('listings'))
        await tx.put('listings', { ...l, dutyUpdatedAt: clock.now });
    });
    let instant = await booking(e, { mode: 'INSTANT' });
    instant = await e.ack(staff, instant.id, instant.version, 30);
    clock.now = instant.arrival!.promisedAt + 15 * 60000;
    assert(
      (await e.governance.monitor(admin)).alerts.some(
        (x) => x.bookingId === instant.id && x.kind === 'LATE_ARRIVAL',
      ),
    );
  }));
test('service overrun follows actual service start and recovers on completion', () =>
  fixture(async (e, clock) => {
    let b = await booking(e);
    b = await e.ack(staff, b.id, b.version);
    clock.now = b.quote.startAt;
    for (const event of ['EN_ROUTE', 'ARRIVED', 'START'])
      b = await e.event(staff, b.id, b.version, event);
    clock.now = b.startedAt! + (b.quote.endAt - b.quote.startAt) + 30 * 60000;
    assert(
      (await e.governance.monitor(admin)).alerts.some(
        (a) => a.kind === 'SERVICE_OVERRUN' && a.state === 'OPEN',
      ),
    );
    b = await e.event(staff, b.id, b.version, 'COMPLETE');
    assert.equal(
      (await e.governance.monitor(admin)).alerts.find((a) => a.kind === 'SERVICE_OVERRUN')!.state,
      'RESOLVED',
    );
  }));
test('staff decline and no-show reports are monitored', () =>
  fixture(async (e) => {
    let b = await booking(e);
    b = await e.decline(staff, b.id, b.version, 'Cannot fulfill this assigned visit.');
    assert((await e.governance.monitor(admin)).alerts.some((a) => a.kind === 'ASSIGNMENT_BLOCKED'));
    await e.repo.transaction((tx) =>
      tx.put('bookings', {
        ...b,
        version: b.version + 1,
        noShow: {
          status: 'REPORTED',
          startedAt: e.now(),
          waitUntil: e.now(),
          contacts: [],
          reportedAt: e.now(),
        },
      }),
    );
    assert((await e.governance.monitor(admin)).alerts.some((a) => a.kind === 'NO_SHOW_REVIEW'));
  }));
test('case alerts honor employee team and safety visibility', () =>
  fixture(async (e, clock) => {
    const { t, b } = await dispute(e, clock);
    await e.repo.transaction(async (tx) => {
      await tx.put('supportTickets', { ...t, dueAt: clock.now - 1 });
      await tx.put('safetyEvents', {
        id: 'private_safety',
        bookingId: b.id,
        storeId: b.storeId,
        staffId: 'staff-aoi',
        status: 'OPEN',
        type: 'SOS',
        version: 1,
        createdAt: clock.now,
      });
    });
    const support = await employee(e),
      finance = await employee(e, { id: 'member_finance', adminRole: 'FINANCE' }),
      other = await employee(e, { id: 'member_other', teams: ['MERCHANT_OPERATIONS'] });
    assert((await e.governance.monitor(support)).alerts.some((a) => a.ticketId === t.id));
    assert(!(await e.governance.monitor(support)).alerts.some((a) => a.kind === 'SAFETY_OPEN'));
    for (const a of [finance, other])
      assert(!(await e.governance.monitor(a)).alerts.some((x) => x.ticketId === t.id));
    assert((await e.governance.monitor(admin)).alerts.some((a) => a.kind === 'SAFETY_OPEN'));
    await assert.rejects(
      () =>
        e.governance.watch(finance, 'missing', {
          version: 1,
          action: 'WATCH',
          followUpAt: clock.now + 60000,
          note: 'Read-only finance cannot follow an alert.',
        }),
      code('FORBIDDEN'),
    );
  }));
test('employee sessions are revalidated before monitoring and decision writes', () =>
  fixture(async (e, clock) => {
    const { t } = await dispute(e, clock),
      a = await employee(e),
      d = await proposal(e, t);
    await e.repo.transaction(async (tx) => {
      const m = (await tx.get<AdminMember>('adminMembers', a.id))!;
      await tx.put('adminMembers', { ...m, status: 'DISABLED', sessionVersion: 2 });
    });
    await assert.rejects(() => e.governance.monitor(a), code('UNAUTHENTICATED'));
    await assert.rejects(
      () => e.governance.publish(a, t.id, d, randomUUID()),
      code('UNAUTHENTICATED'),
    );
  }));
test('recurrent follow-up alerts start a new occurrence with a fresh owner', () =>
  fixture(async (e, clock) => {
    const { t } = await dispute(e, clock);
    const h: TicketHandling = {
      id: t.id,
      version: 1,
      team: 'CUSTOMER_SUPPORT',
      ownerId: admin.id,
      state: 'ACTIVE',
      followUpAt: clock.now - 1,
      updatedAt: clock.now,
    };
    await e.repo.transaction((tx) => tx.put('ticketHandling', h));
    const a = (await e.governance.monitor(admin)).alerts.find((x) => x.kind === 'FOLLOW_UP_DUE')!;
    await e.governance.watch(admin, a.id, {
      version: a.version,
      action: 'WATCH',
      followUpAt: clock.now + 60000,
      note: 'The case is under review by this platform operator.',
    });
    h.followUpAt = clock.now + 120000;
    h.version++;
    await e.repo.transaction((tx) => tx.put('ticketHandling', h));
    assert.equal(
      (await e.governance.monitor(admin)).alerts.find((x) => x.id === a.id)!.state,
      'RESOLVED',
    );
    clock.now += 180000;
    const again = (await e.governance.monitor(admin)).alerts.find((x) => x.id === a.id)!;
    assert.equal(again.generation, 2);
    assert.equal(again.state, 'OPEN');
    assert.equal(again.ownerId, undefined);
  }));
test('platform refund proposal never moves money; shop execution enables resolution', () =>
  fixture(async (e, clock) => {
    const { b, r, t } = await dispute(e, clock),
      d = await proposal(e, t),
      key = randomUUID(),
      decision = await e.governance.publish(admin, t.id, d, key);
    assert.equal((await e.booking(customer, b.id)).refundedAmount, 0);
    assert.equal((await e.governance.detail(customer, t.id)).state, 'AWAITING_SHOP');
    assert.equal((await e.governance.publish(admin, t.id, d, key)).id, decision.id);
    await assert.rejects(
      () => e.governance.publish(admin, t.id, { ...d, amount: 500 }, key),
      code('IDEMPOTENCY_CONFLICT'),
    );
    await assert.rejects(() => close(e, t.id), code('DECISION_UNVERIFIED'));
    await refund(e, r);
    assert.equal((await e.governance.detail(customer, t.id)).state, 'READY_TO_CLOSE');
    assert.equal((await close(e, t.id)).status, 'RESOLVED');
    assert.equal((await e.booking(customer, b.id)).refundedAmount, 1000);
    assert.equal((await e.governance.detail(shop, t.id)).current!.amount, 1000);
  }));
test('all four optimistic versions are required before publishing a decision', () =>
  fixture(async (e, clock) => {
    const { t } = await dispute(e, clock),
      d = await proposal(e, t);
    for (const field of ['ticketVersion', 'version', 'bookingVersion', 'refundVersion'] as const)
      await assert.rejects(
        () => e.governance.publish(admin, t.id, { ...d, [field]: d[field] + 1 }, randomUUID()),
        code('VERSION_CONFLICT'),
      );
  }));
test('decision references must be unique statements from the same case', () =>
  fixture(async (e, clock) => {
    const { t } = await dispute(e, clock),
      d = await proposal(e, t);
    for (const evidenceIds of [['foreign-message'], [...d.evidenceIds, ...d.evidenceIds]])
      await assert.rejects(
        () => e.governance.publish(admin, t.id, { ...d, evidenceIds }, randomUUID()),
        code('INVALID_EVIDENCE'),
      );
    await assert.rejects(
      () => e.governance.publish(admin, t.id, { ...d, evidenceIds: [] }, randomUUID()),
      code('EVIDENCE_REQUIRED'),
    );
  }));
test('missing shop statements require an explicit exception after 24 hours', () =>
  fixture(async (e, clock) => {
    const { t } = await dispute(e, clock, false),
      d = { ...(await proposal(e, t)), merchantUnreachable: true };
    await assert.rejects(
      () => e.governance.publish(admin, t.id, d, randomUUID()),
      code('EVIDENCE_REQUIRED'),
    );
    clock.now += 24 * 3600000;
    assert(
      (
        await e.governance.publish(
          admin,
          t.id,
          await proposal(e, t).then((d) => ({ ...d, merchantUnreachable: true })),
          randomUUID(),
        )
      ).merchantUnreachable,
    );
  }));
test('a present shop statement cannot be bypassed by claiming no response', () =>
  fixture(async (e, clock) => {
    const { t } = await dispute(e, clock);
    clock.now += 25 * 3600000;
    await assert.rejects(
      async () =>
        e.governance.publish(
          admin,
          t.id,
          { ...(await proposal(e, t)), merchantUnreachable: true },
          randomUUID(),
        ),
      code('EVIDENCE_REQUIRED'),
    );
  }));
test('decision amounts cannot exceed the request or remaining funds', () =>
  fixture(async (e, clock) => {
    const { t } = await dispute(e, clock),
      d = await proposal(e, t);
    for (const amount of [0, 2001])
      await assert.rejects(
        () => e.governance.publish(admin, t.id, { ...d, amount }, randomUUID()),
        code('REFUND_BALANCE_CHANGED'),
      );
    await assert.rejects(
      () =>
        e.governance.publish(admin, t.id, { ...d, outcome: 'NO_REFUND', amount: 1 }, randomUUID()),
      code('REFUND_BALANCE_CHANGED'),
    );
  }));
test('partial execution of a larger platform proposal needs renewed review', () =>
  fixture(async (e, clock) => {
    const { r, t } = await dispute(e, clock);
    await e.governance.publish(admin, t.id, await proposal(e, t, 'REFUND', 1500), randomUUID());
    await refund(e, r, 1000);
    assert.equal((await e.governance.detail(admin, t.id)).state, 'NEEDS_REVIEW');
    await assert.rejects(() => close(e, t.id), code('DECISION_UNVERIFIED'));
    assert(
      (await e.governance.monitor(admin)).alerts.some(
        (a) => a.kind === 'DECISION_REVIEW' && a.ticketId === t.id,
      ),
    );
  }));
test('shop rejection and customer withdrawal cannot falsely complete a refund proposal', () =>
  fixture(async (e, clock) => {
    const { r, t } = await dispute(e, clock);
    await e.governance.publish(admin, t.id, await proposal(e, t), randomUUID());
    await refund(e, r, 0, 'REJECT');
    assert.equal((await e.governance.detail(customer, t.id)).state, 'NEEDS_REVIEW');
  }));
test('customer withdrawal leaves the escalated platform case open for review', () =>
  fixture(async (e, clock) => {
    const { r, t } = await dispute(e, clock);
    await e.governance.publish(admin, t.id, await proposal(e, t), randomUUID());
    const d = (await e.refunds.forTicket(customer, t.id))!;
    await e.refunds.decide(
      customer,
      r.id,
      {
        version: d.request.version,
        bookingVersion: d.bookingVersion,
        action: 'WITHDRAW',
        amount: 0,
        text: 'I withdraw the refund request but the platform must still review the case.',
      },
      randomUUID(),
    );
    assert.equal((await e.governance.detail(admin, t.id)).state, 'NEEDS_REVIEW');
    assert.equal((await e.care.detail(customer, t.id)).ticket.status, 'PLATFORM_ESCALATED');
  }));
test('no-refund proposal is verified only by the actual shop rejection', () =>
  fixture(async (e, clock) => {
    const { r, t } = await dispute(e, clock);
    await e.governance.publish(admin, t.id, await proposal(e, t, 'NO_REFUND', 0), randomUUID());
    assert.equal((await e.governance.detail(admin, t.id)).state, 'AWAITING_SHOP');
    await refund(e, r, 0, 'REJECT');
    assert.equal((await e.governance.detail(admin, t.id)).state, 'READY_TO_CLOSE');
    await close(e, t.id);
  }));
test('follow-up resolution requires a shop execution receipt and never moves money', () =>
  fixture(async (e, clock) => {
    const { r, t, b } = await dispute(e, clock);
    await refund(e, r, 0, 'REJECT');
    await e.governance.publish(admin, t.id, await proposal(e, t, 'FOLLOW_UP', 0), randomUUID());
    await assert.rejects(() => close(e, t.id), code('DECISION_UNVERIFIED'));
    const detail = await e.care.detail(shop, t.id),
      d = {
        version: detail.decision!.current!.version,
        ticketVersion: detail.ticket.version,
        text: 'The shop completed the agreed explanation and follow-up with the therapist.',
      },
      k = randomUUID();
    await e.governance.acknowledge(shop, t.id, d, k);
    await e.governance.acknowledge(shop, t.id, d, k);
    assert.equal((await e.governance.detail(customer, t.id)).state, 'READY_TO_CLOSE');
    assert.equal((await e.booking(customer, b.id)).refundedAmount, 0);
    await close(e, t.id);
  }));
test('new follow-up revisions invalidate earlier execution receipts', () =>
  fixture(async (e, clock) => {
    const { t, r } = await dispute(e, clock);
    await refund(e, r, 0, 'REJECT');
    await e.governance.publish(admin, t.id, await proposal(e, t, 'FOLLOW_UP', 0), randomUUID());
    let detail = await e.care.detail(shop, t.id);
    await e.governance.acknowledge(
      shop,
      t.id,
      {
        version: 1,
        ticketVersion: detail.ticket.version,
        text: 'The agreed follow-up explanation was completed by the shop.',
      },
      randomUUID(),
    );
    await e.governance.publish(admin, t.id, await proposal(e, t, 'FOLLOW_UP', 0), randomUUID());
    assert.equal((await e.governance.detail(admin, t.id)).state, 'AWAITING_SHOP');
    assert.equal((await e.governance.detail(admin, t.id)).receipt, null);
  }));
test('customer reopening invalidates the previously verified resolution', () =>
  fixture(async (e, clock) => {
    const { t, r } = await dispute(e, clock);
    await e.governance.publish(admin, t.id, await proposal(e, t), randomUUID());
    await refund(e, r);
    const done = await close(e, t.id);
    await e.care.action(customer, t.id, {
      version: done.version,
      action: 'REOPEN',
      text: 'I dispute the previous conclusion and request a new platform review.',
    });
    assert.equal((await e.governance.detail(admin, t.id)).state, 'NEEDS_REVIEW');
    await assert.rejects(() => close(e, t.id), code('DECISION_UNVERIFIED'));
  }));
test('other shops, therapists and customers cannot publish or acknowledge platform decisions', () =>
  fixture(async (e, clock) => {
    const { t } = await dispute(e, clock),
      d = await proposal(e, t);
    for (const a of [customer, shop, staff])
      await assert.rejects(() => e.governance.publish(a, t.id, d, randomUUID()), code('FORBIDDEN'));
    for (const a of [customer, admin, staff])
      await assert.rejects(
        () =>
          e.governance.acknowledge(
            a,
            t.id,
            { version: 1, ticketVersion: t.version, text: 'A forbidden acknowledgment attempt.' },
            randomUUID(),
          ),
        code('FORBIDDEN'),
      );
    await assert.rejects(
      () => e.governance.detail({ ...shop, storeId: 'store-mori' }, t.id),
      code('NOT_FOUND'),
    );
    await assert.rejects(
      () => e.governance.detail({ ...customer, id: 'other' }, t.id),
      code('NOT_FOUND'),
    );
    await assert.rejects(() => e.governance.detail(staff, t.id), code('FORBIDDEN'));
  }));
test('support employees must claim cases and cannot cross team boundaries', () =>
  fixture(async (e, clock) => {
    const { t } = await dispute(e, clock),
      a = await employee(e),
      d = await proposal(e, t);
    await assert.rejects(
      () => e.governance.publish(a, t.id, d, randomUUID()),
      code('OWNER_REQUIRED'),
    );
    await e.repo.transaction((tx) =>
      tx.put<TicketHandling>('ticketHandling', {
        id: t.id,
        version: 1,
        team: 'CUSTOMER_SUPPORT',
        ownerId: a.id,
        state: 'ACTIVE',
        followUpAt: clock.now + 3600000,
        updatedAt: clock.now,
      }),
    );
    assert(await e.governance.publish(a, t.id, d, randomUUID()));
    const outsider = await employee(e, {
      id: 'member_outside',
      adminRole: 'OPERATIONS',
      teams: ['MERCHANT_OPERATIONS'],
    });
    await assert.rejects(() => e.governance.detail(outsider, t.id), code('NOT_FOUND'));
  }));
test('platform decisions stay out of money-moving endpoints and shared notification bodies', () =>
  fixture(async (e, clock) => {
    const { t, r } = await dispute(e, clock);
    await e.governance.publish(admin, t.id, await proposal(e, t), randomUUID());
    const d = (await e.refunds.forTicket(admin, t.id))!;
    await assert.rejects(
      () =>
        e.refunds.decide(
          admin,
          r.id,
          {
            version: d.request.version,
            bookingVersion: d.bookingVersion,
            action: 'APPROVE',
            amount: 1000,
            text: 'Platform must never execute the shop refund directly.',
          },
          randomUUID(),
        ),
      code('FORBIDDEN'),
    );
    const out = JSON.stringify(await e.repo.transaction((tx) => tx.list('outbox')));
    assert(!out.includes('original report and the shop statement'));
    assert(!out.includes('shop should process'));
  }));
test('manual refunds that consume the balance trigger decision review', () =>
  fixture(async (e, clock) => {
    const { b, t } = await dispute(e, clock);
    await e.governance.publish(admin, t.id, await proposal(e, t), randomUUID());
    await e.refund(shop, b.id, b.version, b.capturedAmount);
    assert.equal((await e.governance.detail(admin, t.id)).state, 'NEEDS_REVIEW');
    await assert.rejects(() => close(e, t.id), code('DECISION_UNVERIFIED'));
  }));
test('ordinary or private cases cannot publish shared financial resolutions', () =>
  fixture(async (e, clock) => {
    const { b, t } = await dispute(e, clock),
      d = await proposal(e, t);
    const p = await e.care.create(
      customer,
      {
        bookingId: b.id,
        category: 'PRIVACY',
        subject: 'Private information report',
        description: 'Private report text must never become a shared platform financial decision.',
      },
      randomUUID(),
    );
    await assert.rejects(
      () => e.governance.publish(admin, p.id, { ...d, ticketVersion: p.version }, randomUUID()),
      code('INVALID_STATE'),
    );
  }));

test('a revised review must reference the latest reopening statement', () =>
  fixture(async (e, clock) => {
    const { t, r } = await dispute(e, clock);
    await e.governance.publish(admin, t.id, await proposal(e, t), randomUUID());
    await refund(e, r);
    const done = await close(e, t.id);
    await e.care.action(customer, t.id, {
      version: done.version,
      action: 'REOPEN',
      text: 'New appeal facts need to be checked instead of silently reusing the old conclusion.',
    });
    const p = await proposal(e, t, 'FOLLOW_UP', 0);
    await assert.rejects(
      () => e.governance.publish(admin, t.id, p, randomUUID()),
      code('APPEAL_EVIDENCE_REQUIRED'),
    );
    const latest = (await e.care.detail(admin, t.id)).messages.find((m) => m.kind === 'REOPEN')!;
    await e.governance.publish(
      admin,
      t.id,
      { ...p, evidenceIds: [...p.evidenceIds, latest.id] },
      randomUUID(),
    );
    assert.equal((await e.governance.detail(customer, t.id)).state, 'AWAITING_SHOP');
  }));
test('alert follow-up requires a future deadline and respects another owner', () =>
  fixture(async (e, clock) => {
    const b = await booking(e);
    clock.now = b.deadline - 60000;
    const a = (await e.governance.monitor(admin)).alerts.find((x) => x.bookingId === b.id)!;
    const body = {
      version: a.version,
      action: 'WATCH',
      followUpAt: clock.now,
      note: 'The next follow-up must be a valid future time.',
    };
    for (const followUpAt of [clock.now, clock.now + 24 * 3600000 + 1])
      await assert.rejects(
        () => e.governance.watch(admin, a.id, { ...body, followUpAt }),
        code('INVALID_FOLLOW_UP'),
      );
    const current = await e.governance.watch(admin, a.id, {
        ...body,
        followUpAt: clock.now + 60000,
      }),
      other = await employee(e);
    await assert.rejects(
      () =>
        e.governance.watch(other, a.id, {
          ...body,
          version: current.version,
          followUpAt: clock.now + 60000,
        }),
      code('FORBIDDEN'),
    );
    const released = await e.governance.watch(admin, a.id, {
      ...body,
      version: current.version,
      action: 'RELEASE',
    });
    assert.equal(released.state, 'OPEN');
    assert.equal(released.ownerId, undefined);
  }));
test('refund aging, payment review and consent deadlines are based on actual records', () =>
  fixture(async (e, clock) => {
    const { t, b } = await dispute(e, clock);
    clock.now += 24 * 3600000;
    assert(
      (await e.governance.monitor(admin)).alerts.some(
        (x) => x.ticketId === t.id && x.kind === 'REFUND_OVERDUE',
      ),
    );
    await e.repo.transaction((tx) =>
      tx.put('bookings', { ...b, paymentStatus: 'REFUND_PENDING', version: b.version + 1 }),
    );
    assert(
      (await e.governance.monitor(admin)).alerts.some(
        (x) => x.bookingId === b.id && x.kind === 'PAYMENT_REVIEW',
      ),
    );
    const future = await booking(e);
    await e.repo.transaction((tx) =>
      tx.put('bookings', {
        ...future,
        replacementConsent: 'PENDING',
        replacementDeadline: clock.now + 4 * 60000,
        version: future.version + 1,
      }),
    );
    assert(
      (await e.governance.monitor(admin)).alerts.some(
        (x) => x.bookingId === future.id && x.kind === 'CONSENT_DUE',
      ),
    );
  }));
test('even a small manual refund invalidates an unexecuted financial proposal', () =>
  fixture(async (e, clock) => {
    const { b, t } = await dispute(e, clock);
    await e.governance.publish(admin, t.id, await proposal(e, t), randomUUID());
    await e.refund(shop, b.id, b.version, 100);
    assert.equal((await e.governance.detail(admin, t.id)).state, 'NEEDS_REVIEW');
  }));

test('platform arrival follow-up reaches the three order views without internal notes', () =>
  fixture(async (e, clock) => {
    let b = await booking(e);
    b = await e.ack(staff, b.id, b.version);
    clock.now = b.quote.startAt + 15 * 60000;
    const alert = (await e.governance.monitor(admin)).alerts.find(
      (a) => a.kind === 'LATE_ARRIVAL',
    )!;
    await e.governance.watch(admin, alert.id, {
      version: alert.version,
      action: 'WATCH',
      followUpAt: clock.now + 60000,
      note: 'Private employee investigation notes must never reach the parties.',
    });
    for (const a of [customer, shop, staff]) {
      const d = await e.coordination.detail(a, b.id);
      assert.deepEqual(d.platformAttention, [{ kind: 'LATE_ARRIVAL', firstSeenAt: clock.now }]);
      assert(!JSON.stringify(d).includes('Private employee investigation'));
      assert(!JSON.stringify(d.platformAttention).includes('ownerId'));
    }
    b = await e.event(staff, b.id, b.version, 'EN_ROUTE');
    b = await e.event(staff, b.id, b.version, 'ARRIVED');
    // The public hint must recover immediately, even before the next monitor reconciliation.
    for (const a of [customer, shop, staff])
      assert.deepEqual((await e.coordination.detail(a, b.id)).platformAttention, []);
  }));
test('case and financial alerts never expose private reports to order participants', () =>
  fixture(async (e, clock) => {
    const { t, b } = await dispute(e, clock);
    await e.governance.publish(admin, t.id, await proposal(e, t), randomUUID());
    const r = (await e.refunds.forTicket(shop, t.id))!;
    await refund(e, { id: r.request.id, ticketId: t.id }, 0, 'REJECT');
    const a = (await e.governance.monitor(admin)).alerts.find((a) => a.kind === 'DECISION_REVIEW')!;
    await e.governance.watch(admin, a.id, {
      version: a.version,
      action: 'WATCH',
      followUpAt: clock.now + 60000,
      note: 'Internal case investigation must stay within the case team.',
    });
    for (const actor of [customer, shop, staff])
      assert.deepEqual((await e.coordination.detail(actor, b.id)).platformAttention, []);
  }));
