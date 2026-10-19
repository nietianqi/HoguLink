import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Actor, Booking, Listing, WorkHandoff } from '@hogulink/contracts';
import {
  fixture,
  booking,
  complete,
  customer,
  shop,
  staff,
  admin,
} from './helpers/experience-fixture.js';
import { DomainError } from '../src/errors.js';
const code = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;
const other: Actor = { ...customer, id: 'another-customer' },
  otherShop: Actor = { ...shop, storeId: 'store-mori' },
  mio: Actor = { ...staff, id: 'mio-account', staffId: 'staff-mio' };
const create = (b: Booking, role: 'STAFF' | 'MERCHANT' = 'MERCHANT') => ({
  bookingVersion: b.version,
  topic: role === 'STAFF' ? 'SERVICE_ISSUE' : 'AFTERCARE_FACTS',
  text: 'Private service facts for the original shop and assigned therapist.',
});
const action = (version: number, action = 'REPLY') => ({
  version,
  action,
  text: 'The actual visit circumstances were checked and recorded here.',
});
test('coordination is scoped to the actual customer, shop and current therapist', () =>
  fixture(async (e) => {
    const b = await booking(e);
    for (const a of [other, otherShop, mio, admin])
      await assert.rejects(() => e.coordination.detail(a, b.id), code('NOT_FOUND'));
    for (const a of [customer, shop, staff])
      assert.equal((await e.coordination.detail(a, b.id)).bookingId, b.id);
  }));
test('public order history has state events without private notes, identities or payment routes', () =>
  fixture(async (e) => {
    let b = await booking(e);
    b = await e.ack(staff, b.id, b.version);
    await e.coordination.create(staff, b.id, create(b, 'STAFF'), randomUUID());
    await e.messages(customer, b.id, 'private customer conversation');
    const c = await e.coordination.detail(customer, b.id),
      serialized = JSON.stringify(c);
    assert(c.timeline.some((a) => a.action === 'BOOKING_CREATED'));
    assert(c.timeline.some((a) => a.action === 'STAFF_ACKNOWLEDGED'));
    assert.deepEqual(c.handoffs, []);
    assert.deepEqual(c.cases, []);
    for (const s of [
      'Private service facts',
      'private customer conversation',
      'actorId',
      'paymentId',
      'customerId',
      'address',
    ])
      assert(!serialized.includes(s));
  }));
test('merchant asks assigned therapist for facts and duplicate creation has one effect', () =>
  fixture(async (e) => {
    const b = await booking(e),
      k = randomUUID(),
      d = create(b),
      h = await e.coordination.create(shop, b.id, d, k);
    assert.equal(h.status, 'WAITING_STAFF');
    assert.equal((await e.coordination.create(shop, b.id, d, k)).id, h.id);
    assert.equal((await e.coordination.inbox(staff)).length, 1);
    await assert.rejects(
      () => e.coordination.create(shop, b.id, { ...d, text: 'Changed request with same key.' }, k),
      code('IDEMPOTENCY_CONFLICT'),
    );
    assert(!JSON.stringify(h).includes('staffId'));
  }));
test('staff reporting and shop requests cannot swap roles or mutate bookings', () =>
  fixture(async (e) => {
    const b = await booking(e),
      h = await e.coordination.create(staff, b.id, create(b, 'STAFF'), randomUUID());
    assert.equal(h.status, 'WAITING_SHOP');
    assert.equal((await e.booking(customer, b.id)).version, b.version);
    await assert.rejects(
      () => e.coordination.create(customer, b.id, create(b), randomUUID()),
      code('FORBIDDEN'),
    );
    await assert.rejects(
      () => e.coordination.create(staff, b.id, create(b), randomUUID()),
      code('INVALID_STATE'),
    );
    await assert.rejects(
      () => e.coordination.create(shop, b.id, create(b, 'STAFF'), randomUUID()),
      code('INVALID_STATE'),
    );
  }));
test('cooperation requests require current order versions and a real active recipient', () =>
  fixture(async (e) => {
    let b = await booking(e);
    b = await e.ack(staff, b.id, b.version);
    await assert.rejects(
      () =>
        e.coordination.create(
          shop,
          b.id,
          { ...create(b), bookingVersion: b.version - 1 },
          randomUUID(),
        ),
      code('VERSION_CONFLICT'),
    );
    await e.repo.transaction(async (tx) => {
      const l = (await tx.get<Listing>('listings', 'listing-aoi'))!;
      await tx.put('listings', { ...l, membershipActive: false });
    });
    await assert.rejects(
      () => e.coordination.create(shop, b.id, create(b), randomUUID()),
      code('INVALID_STATE'),
    );
  }));
test('associated care must be shared with the original shop and belong to this order', () =>
  fixture(async (e) => {
    const b = await booking(e),
      ticket = await e.care.create(
        customer,
        {
          bookingId: b.id,
          category: 'SERVICE_QUALITY',
          subject: 'Service follow-up',
          description: 'Please review the actual service circumstances.',
        },
        randomUUID(),
      );
    assert.equal(
      (await e.coordination.create(shop, b.id, { ...create(b), ticketId: ticket.id }, randomUUID()))
        .status,
      'WAITING_STAFF',
    );
    const privateCase = await e.care.create(
      customer,
      {
        bookingId: b.id,
        category: 'PRIVACY',
        subject: 'Private issue',
        description: 'Private platform-only evidence and personal details.',
      },
      randomUUID(),
    );
    await assert.rejects(
      () =>
        e.coordination.create(shop, b.id, { ...create(b), ticketId: privateCase.id }, randomUUID()),
      code('NOT_FOUND'),
    );
    const visible = await e.coordination.detail(shop, b.id);
    assert.equal(visible.cases.length, 1);
    assert.equal(visible.cases[0].id, ticket.id);
    assert.deepEqual((await e.coordination.detail(staff, b.id)).cases, []);
  }));
test('replies alternate the pending role; only original shop can resolve and reopen', () =>
  fixture(async (e) => {
    const b = await booking(e);
    let h = await e.coordination.create(shop, b.id, create(b), randomUUID());
    for (const a of [customer, otherShop, mio])
      await assert.rejects(() => e.coordination.action(a, h.id, action(h.version), randomUUID()));
    h = await e.coordination.action(staff, h.id, action(h.version), randomUUID());
    assert.equal(h.status, 'WAITING_SHOP');
    await assert.rejects(
      () => e.coordination.action(staff, h.id, action(h.version, 'RESOLVE'), randomUUID()),
      code('FORBIDDEN'),
    );
    h = await e.coordination.action(shop, h.id, action(h.version, 'RESOLVE'), randomUUID());
    assert.equal(h.status, 'RESOLVED');
    await assert.rejects(
      () => e.coordination.action(staff, h.id, action(h.version), randomUUID()),
      code('INVALID_STATE'),
    );
    h = await e.coordination.action(shop, h.id, action(h.version, 'REOPEN'), randomUUID());
    assert.equal(h.status, 'WAITING_SHOP');
    h = await e.coordination.action(shop, h.id, action(h.version), randomUUID());
    assert.equal(h.status, 'WAITING_STAFF');
    assert.equal((await e.booking(customer, b.id)).status, b.status);
  }));
test('concurrent handoff decisions have one winner and replay records one reply', () =>
  fixture(async (e) => {
    const b = await booking(e),
      h = await e.coordination.create(shop, b.id, create(b), randomUUID()),
      d = action(h.version),
      k = randomUUID();
    const [a, c] = await Promise.allSettled([
      e.coordination.action(staff, h.id, d, k),
      e.coordination.action(shop, h.id, action(h.version, 'RESOLVE'), randomUUID()),
    ]);
    assert.equal([a, c].filter((x) => x.status === 'fulfilled').length, 1);
    if (a.status === 'fulfilled') {
      const r = await e.coordination.action(staff, h.id, d, k);
      assert.equal(r.messages.length, 2);
    }
  }));
test('reassignment revokes old order access while retaining address-free cooperation with original therapist', () =>
  fixture(async (e) => {
    let b = await booking(e);
    const h = await e.coordination.create(shop, b.id, create(b), randomUUID());
    b = await e.assign(shop, b.id, b.version, 'listing-mio', true);
    b = await e.consent(customer, b.id, b.version, true);
    await assert.rejects(() => e.coordination.detail(staff, b.id), code('NOT_FOUND'));
    const inbox = await e.coordination.inbox(staff);
    assert.equal(inbox[0].id, h.id);
    assert(!JSON.stringify(inbox).includes('address'));
    assert(!JSON.stringify(inbox).includes('payment'));
    assert.deepEqual(await e.coordination.inbox(mio), []);
    await e.coordination.action(staff, h.id, action(h.version), randomUUID());
    await e.repo.transaction(async (tx) => {
      const l = (await tx.get<Listing>('listings', 'listing-aoi'))!;
      await tx.put('listings', { ...l, membershipActive: false });
    });
    assert.deepEqual(await e.coordination.inbox(staff), []);
    await assert.rejects(
      () => e.coordination.action(staff, h.id, action(2), randomUUID()),
      code('NOT_FOUND'),
    );
  }));
test('cooperation on completed service does not read customer private cases or execute refunds', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock);
    let h = await e.coordination.create(shop, b.id, create(b), randomUUID());
    h = await e.coordination.action(staff, h.id, action(h.version), randomUUID());
    await e.coordination.action(shop, h.id, action(h.version, 'RESOLVE'), randomUUID());
    const after = await e.booking(customer, b.id);
    assert.equal(after.refundedAmount, 0);
    assert.equal(after.status, 'COMPLETED');
    assert.equal(after.version, b.version);
  }));
test('bounded cooperation quota rejects without leaving partial records', () =>
  fixture(async (e) => {
    const b = await booking(e);
    for (let i = 0; i < 10; i++) await e.coordination.create(shop, b.id, create(b), randomUUID());
    await assert.rejects(
      () => e.coordination.create(shop, b.id, create(b), randomUUID()),
      code('HANDOFF_LIMIT'),
    );
    assert.equal((await e.coordination.detail(shop, b.id)).handoffs.length, 10);
  }));
test('conversation cap still permits a shop resolution', () =>
  fixture(async (e) => {
    const b = await booking(e),
      h = await e.coordination.create(shop, b.id, create(b), randomUUID());
    await e.repo.transaction(async (tx) => {
      const stored = (await tx.get<WorkHandoff>('workHandoffs', h.id))!;
      stored.messages = Array.from({ length: 50 }, () => stored.messages[0]);
      await tx.put('workHandoffs', stored);
    });
    await assert.rejects(
      () => e.coordination.action(staff, h.id, action(h.version), randomUUID()),
      code('HANDOFF_LIMIT'),
    );
    assert.equal(
      (await e.coordination.action(shop, h.id, action(h.version, 'RESOLVE'), randomUUID())).status,
      'RESOLVED',
    );
  }));
test('input validation rejects foreign fields and short facts', () =>
  fixture(async (e) => {
    const b = await booking(e);
    for (const fields of [
      { text: 'tiny' },
      { recipientId: 'other' },
      { topic: 'SOS' },
      { bookingVersion: 0 },
    ])
      await assert.rejects(() =>
        e.coordination.create(shop, b.id, { ...create(b), ...fields }, randomUUID()),
      );
  }));
test('consent rechecks language, visit constraints and offering eligibility without silently switching', () =>
  fixture(async (e) => {
    let b = await booking(e);
    b = await e.assign(shop, b.id, b.version, 'listing-mio', true);
    await e.repo.transaction(async (tx) => {
      const l = (await tx.get<Listing>('listings', 'listing-mio'))!;
      await tx.put('listings', { ...l, offeringIds: [] });
    });
    await assert.rejects(
      () => e.consent(customer, b.id, b.version, true),
      code('INVALID_ASSIGNMENT'),
    );
    const after = await e.booking(customer, b.id);
    assert.equal(after.assignedStaffId, 'staff-aoi');
    assert.equal(after.replacementConsent, 'PENDING');
    assert.equal(after.version, b.version);
    b = await e.consent(customer, b.id, b.version, false);
    assert.equal(b.status, 'CANCELLED');
    assert.equal(b.capturedAmount, 0);
  }));
test('old therapist cannot read customer messages while replacement consent is pending', () =>
  fixture(async (e) => {
    let b = await booking(e);
    b = await e.ack(staff, b.id, b.version);
    await e.messages(customer, b.id, 'Private customer information for the current visit.');
    b = await e.assign(shop, b.id, b.version, 'listing-mio', true);
    assert.equal((await e.booking(staff, b.id)).address, undefined);
    await assert.rejects(() => e.messages(staff, b.id), code('FORBIDDEN'));
    await assert.rejects(
      () => e.messages(staff, b.id, 'I must not continue now.'),
      code('FORBIDDEN'),
    );
  }));
test('shop can withdraw an invalid candidate without extending consent time or restoring old therapist access', () =>
  fixture(async (e, clock) => {
    let b = await booking(e);
    b = await e.ack(staff, b.id, b.version);
    b = await e.assign(shop, b.id, b.version, 'listing-mio', true);
    const deadline = b.replacementDeadline,
      version = b.version;
    clock.now += 60000;
    b = await e.withdrawProposal(shop, b.id, {
      version,
      reason: 'The proposed therapist has a new schedule conflict.',
    });
    assert.equal(b.replacementConsent, 'PENDING');
    assert.equal(b.proposedListingId, undefined);
    assert.equal(b.replacementDeadline, deadline);
    assert.equal(b.assignedStaffId, 'staff-aoi');
    assert.equal((await e.booking(staff, b.id)).address, undefined);
    await assert.rejects(
      () =>
        e.withdrawProposal(shop, b.id, {
          version,
          reason: 'This stale action must not run again.',
        }),
      code('VERSION_CONFLICT'),
    );
    await assert.rejects(
      () => e.event(staff, b.id, b.version, 'EN_ROUTE'),
      code('INVALID_TRANSITION'),
    );
    await assert.rejects(
      () => e.consent(customer, b.id, b.version, true),
      code('PROPOSAL_REQUIRED'),
    );
    b = await e.assign(shop, b.id, b.version, 'listing-mio', true);
    assert.equal(b.replacementDeadline, deadline);
    b = await e.consent(customer, b.id, b.version, true);
    assert.equal(b.quote.nominationFee, 0);
    assert.equal(b.staffTaskStatus, 'OFFERED');
  }));
test('withdrawing a candidate releases its calendar protection but keeps the original booking identity', () =>
  fixture(async (e) => {
    let b = await booking(e);
    const original = {
      merchantId: b.merchantId,
      storeId: b.storeId,
      selectedStaffId: b.selectedStaffId,
    };
    b = await e.assign(shop, b.id, b.version, 'listing-mio', true);
    assert(
      await e.repo.transaction((tx) => tx.conflicts('staff-mio', b.quote.startAt, b.quote.endAt)),
    );
    b = await e.withdrawProposal(shop, b.id, {
      version: b.version,
      reason: 'Choose another candidate after checking the schedule.',
    });
    assert.equal(
      await e.repo.transaction((tx) => tx.conflicts('staff-mio', b.quote.startAt, b.quote.endAt)),
      false,
    );
    for (const k of ['merchantId', 'storeId', 'selectedStaffId'] as const)
      assert.equal(b[k], original[k]);
    await assert.rejects(
      () =>
        e.withdrawProposal(staff, b.id, {
          version: b.version,
          reason: 'Staff may not manage customer replacement consent.',
        }),
      code('FORBIDDEN'),
    );
  }));
test('instant replacement excludes a therapist still serving beyond the original planned end', () =>
  fixture(async (e, clock) => {
    const b = await booking(e, { mode: 'INSTANT' });
    await e.repo.transaction(async (tx) => {
      await tx.put('bookings', {
        ...b,
        id: 'overdue-other-visit',
        assignedStaffId: 'staff-ren',
        assignedListingId: 'listing-ren',
        status: 'IN_SERVICE',
        quote: { ...b.quote, startAt: clock.now - 120 * 60000, endAt: clock.now - 60 * 60000 },
      });
    });
    assert(!(await e.assignmentCandidates(shop, b.id)).some((x) => x.id === 'listing-ren'));
    await assert.rejects(
      () => e.assign(shop, b.id, b.version, 'listing-ren', true),
      code('INVALID_ASSIGNMENT'),
    );
  }));
test('recipient quota ensures all unresolved cooperation remains reachable in the bounded inbox', () =>
  fixture(async (e) => {
    const b = await booking(e),
      h = await e.coordination.create(shop, b.id, create(b), randomUUID());
    await e.repo.transaction(async (tx) => {
      const stored = (await tx.get<WorkHandoff>('workHandoffs', h.id))!;
      for (let i = 0; i < 99; i++)
        await tx.put('workHandoffs', {
          ...stored,
          id: `quota-${i}`,
          bookingId: `prior-order-${i}`,
        });
    });
    await assert.rejects(
      () => e.coordination.create(shop, b.id, create(b), randomUUID()),
      code('HANDOFF_LIMIT'),
    );
  }));
test('public history preserves fulfillment order even when events have equal timestamps', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock),
      history = (await e.coordination.detail(customer, b.id)).timeline.map((a) => a.action);
    assert(history.indexOf('STAFF_EN_ROUTE') < history.indexOf('STAFF_ARRIVED'));
    assert(history.indexOf('STAFF_ARRIVED') < history.indexOf('STAFF_START'));
    assert(history.indexOf('STAFF_START') < history.indexOf('STAFF_COMPLETE'));
  }));
