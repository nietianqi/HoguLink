import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Actor, Booking, SupportTicket } from '@hogulink/contracts';
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
const fail = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;
const other: Actor = { ...customer, id: 'other-address-owner' },
  foreignShop: Actor = { ...shop, storeId: 'store-mori' };
const address = (version = 0, type: 'HOME' | 'HOTEL' = 'HOME') => ({
  version,
  label: 'My place',
  setDefault: false,
  address: {
    name: 'QA Guest',
    type,
    area: 'shinjuku' as const,
    detail: 'QA building 123',
    hotelName: type === 'HOTEL' ? 'QA Hotel' : '',
  },
});
const claim = (b: Booking, amount = b.capturedAmount - b.refundedAmount) => ({
  bookingVersion: b.version,
  amount,
  reason: 'The service needs a refund review with a clear explanation.',
  locale: 'en' as const,
});
const decision = (
  version: number,
  bookingVersion: number,
  action: 'APPROVE' | 'REJECT' | 'WITHDRAW',
  amount = 0,
) => ({
  version,
  bookingVersion,
  action,
  amount,
  text: 'The case was reviewed with the customer and this is the recorded outcome.',
});
test('address book requires a verified customer and never exposes another account', () =>
  fixture(async (e) => {
    for (const a of [shop, staff, admin, { ...customer, verificationLevel: 0 }])
      await assert.rejects(() => e.addresses.list(a), fail('FORBIDDEN'));
    const saved = await e.addresses.save(customer, undefined, address(), randomUUID());
    assert.equal(saved.items.length, 1);
    assert.equal(saved.defaultId, saved.items[0].id);
    assert.deepEqual(await e.addresses.list(other), { version: 0, defaultId: null, items: [] });
    await assert.rejects(
      () => e.addresses.change(other, saved.items[0].id, { version: 0 }, 'REMOVE'),
      fail('NOT_FOUND'),
    );
    assert(!JSON.stringify(saved).includes('customerId'));
  }));
test('address creation replay is idempotent and a changed payload cannot reuse its key', () =>
  fixture(async (e) => {
    const key = randomUUID(),
      first = await e.addresses.save(customer, undefined, address(), key);
    assert.deepEqual(await e.addresses.save(customer, undefined, address(), key), first);
    await assert.rejects(
      () => e.addresses.save(customer, undefined, { ...address(), label: 'Another' }, key),
      fail('IDEMPOTENCY_CONFLICT'),
    );
    assert.equal((await e.addresses.list(customer)).items.length, 1);
  }));
test('default changes and edits use the entire address book version to prevent lost updates', () =>
  fixture(async (e) => {
    let book = await e.addresses.save(customer, undefined, address(), randomUUID());
    book = await e.addresses.save(
      customer,
      undefined,
      { ...address(book.version, 'HOTEL'), label: 'Hotel' },
      randomUUID(),
    );
    const [a, b] = book.items;
    const results = await Promise.allSettled([
      e.addresses.change(customer, a.id, { version: book.version }, 'DEFAULT'),
      e.addresses.change(customer, b.id, { version: book.version }, 'DEFAULT'),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      results.filter((r) => r.status === 'rejected' && fail('VERSION_CONFLICT')(r.reason)).length,
      1,
    );
    await assert.rejects(
      () => e.addresses.save(customer, a.id, address(book.version)),
      fail('VERSION_CONFLICT'),
    );
  }));
test('deleting the default chooses a valid fallback and replay cannot resurrect removed data', () =>
  fixture(async (e) => {
    const key = randomUUID();
    let book = await e.addresses.save(customer, undefined, address(), key),
      a = book.items[0].id;
    book = await e.addresses.save(customer, undefined, address(book.version), randomUUID());
    const b = book.items[1].id;
    book = await e.addresses.change(customer, a, { version: book.version }, 'REMOVE');
    assert.equal(book.defaultId, b);
    await assert.rejects(
      () => e.addresses.save(customer, undefined, address(), key),
      fail('ADDRESS_REMOVED'),
    );
    book = await e.addresses.change(customer, b, { version: book.version }, 'REMOVE');
    assert.equal(book.defaultId, null);
    assert.equal(book.items.length, 0);
  }));
test('saved addresses reject transient hotel permissions, rooms, unknown areas and missing hotel names', () =>
  fixture(async (e) => {
    for (const fields of [
      { room: '123' },
      { hotelPermission: true },
      { area: 'outside-area' },
      { ownerId: other.id },
    ])
      await assert.rejects(() =>
        e.addresses.save(
          customer,
          undefined,
          { ...address(), address: { ...address().address, ...fields } },
          randomUUID(),
        ),
      );
    await assert.rejects(() =>
      e.addresses.save(
        customer,
        undefined,
        { ...address(0, 'HOTEL'), address: { ...address(0, 'HOTEL').address, hotelName: '' } },
        randomUUID(),
      ),
    );
    const home = await e.addresses.save(
      customer,
      undefined,
      { ...address(), address: { ...address().address, hotelName: 'Stale hotel' } },
      randomUUID(),
    );
    assert.equal(home.items[0].address.hotelName, '');
  }));
test('address book is bounded to ten and existing records can be edited or removed at the limit', () =>
  fixture(async (e) => {
    let book = await e.addresses.list(customer);
    for (let i = 0; i < 10; i++)
      book = await e.addresses.save(customer, undefined, address(book.version), randomUUID());
    await assert.rejects(
      () => e.addresses.save(customer, undefined, address(book.version), randomUUID()),
      fail('ADDRESS_LIMIT'),
    );
    book = await e.addresses.save(customer, book.items[0].id, {
      ...address(book.version),
      label: 'Updated',
    });
    assert.equal(book.items.length, 10);
    book = await e.addresses.change(
      customer,
      book.items[0].id,
      { version: book.version },
      'REMOVE',
    );
    book = await e.addresses.save(customer, undefined, address(book.version), randomUUID());
    assert.equal(book.items.length, 10);
  }));
test('checkout submission recovery returns only the existing owned order without price revalidation or new charge', () =>
  fixture(async (e, clock) => {
    const b = await booking(e);
    assert.deepEqual(await e.checkoutSubmission(customer, b.holdId), { bookingId: b.id });
    await assert.rejects(() => e.checkoutSubmission(other, b.holdId), fail('NOT_FOUND'));
    await assert.rejects(() => e.checkoutSubmission(shop, b.holdId), fail('FORBIDDEN'));
    clock.now = b.quote.endAt + 86400000;
    assert.equal((await e.checkoutSubmission(customer, b.holdId)).bookingId, b.id);
    assert.equal((await e.bookings(customer)).length, 1);
  }));
test('refund requests require an ended charged booking and never turn an authorization into a refund', () =>
  fixture(async (e, clock) => {
    const b = await booking(e);
    await assert.rejects(
      () => e.refunds.request(customer, b.id, { ...claim(b), amount: 100 }, randomUUID()),
      fail('REFUND_UNAVAILABLE'),
    );
    for (const actor of [shop, staff, admin])
      await assert.rejects(
        () => e.refunds.request(actor, b.id, { ...claim(b), amount: 100 }, randomUUID()),
        fail('FORBIDDEN'),
      );
    await assert.rejects(() => e.refunds.overview(other, b.id), fail('NOT_FOUND'));
    const ended = await complete(e, clock, b);
    assert.equal((await e.refunds.overview(customer, b.id)).canRequest, true);
    await assert.rejects(
      () => e.refunds.request(customer, b.id, claim(ended, ended.capturedAmount + 1), randomUUID()),
      fail('REFUND_UNAVAILABLE'),
    );
  }));
test('a refund request atomically creates one order-linked shared case and replays once', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock),
      key = randomUUID(),
      input = claim(b);
    const r = await e.refunds.request(customer, b.id, input, key);
    assert.equal((await e.refunds.request(customer, b.id, input, key)).id, r.id);
    const detail = await e.care.detail(customer, r.ticketId);
    assert.equal(detail.ticket.refundRequestId, r.id);
    assert.equal(detail.ticket.bookingId, b.id);
    assert.equal(detail.ticket.category, 'PRICE_OR_REFUND');
    assert.equal(detail.refundPending, true);
    await assert.rejects(
      () => e.refunds.request(customer, b.id, { ...input, amount: 100 }, key),
      fail('IDEMPOTENCY_CONFLICT'),
    );
    await assert.rejects(
      () => e.refunds.request(customer, b.id, input, randomUUID()),
      fail('REFUND_REQUEST_EXISTS'),
    );
    assert.equal((await e.refunds.overview(customer, b.id)).cases.length, 1);
    assert.equal((await e.refunds.overview(customer, b.id)).requests.length, 1);
  }));
test('refund request scope excludes other customers, other shops and staff including ticket reads', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock),
      r = await e.refunds.request(customer, b.id, claim(b), randomUUID());
    for (const actor of [other, foreignShop])
      await assert.rejects(() => e.refunds.forTicket(actor, r.ticketId), fail('NOT_FOUND'));
    await assert.rejects(() => e.refunds.forTicket(staff, r.ticketId), fail('FORBIDDEN'));
    for (const actor of [other, foreignShop])
      await assert.rejects(
        () =>
          e.refunds.decide(
            actor,
            r.id,
            decision(r.version, b.version, actor.role === 'CUSTOMER' ? 'WITHDRAW' : 'REJECT'),
            randomUUID(),
          ),
        fail('NOT_FOUND'),
      );
    await assert.rejects(
      () =>
        e.refunds.decide(admin, r.id, decision(r.version, b.version, 'APPROVE', 100), randomUUID()),
      fail('FORBIDDEN'),
    );
    assert(!JSON.stringify(await e.refunds.forTicket(shop, r.ticketId)).includes('customerId'));
  }));
test('pending financial claims cannot be hidden by a generic resolve or close action', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock),
      r = await e.refunds.request(customer, b.id, claim(b), randomUUID()),
      ticket = (await e.care.detail(shop, r.ticketId)).ticket;
    await assert.rejects(
      () =>
        e.care.action(shop, ticket.id, {
          version: ticket.version,
          action: 'RESOLVE',
          text: 'The support case is considered resolved.',
        }),
      fail('REFUND_PENDING'),
    );
    assert.equal((await e.refunds.forTicket(customer, r.ticketId))?.request.status, 'PENDING');
    assert.equal((await e.bookings(customer))[0].refundedAmount, 0);
  }));
test('approval refunds exactly once with financial ledger reversal and resolves an ordinary case', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock),
      r = await e.refunds.request(customer, b.id, claim(b), randomUUID()),
      key = randomUUID(),
      input = decision(r.version, b.version, 'APPROVE', r.amount);
    const approved = await e.refunds.decide(shop, r.id, input, key);
    assert.equal(approved.status, 'APPROVED');
    assert.equal((await e.refunds.decide(shop, r.id, input, key)).id, r.id);
    const current = (await e.bookings(customer))[0];
    assert.equal(current.refundedAmount, b.capturedAmount);
    assert.equal(current.paymentStatus, 'REFUNDED');
    assert.equal((await e.care.detail(customer, r.ticketId)).ticket.status, 'RESOLVED');
    assert.equal((await e.refunds.overview(customer, b.id)).canRequest, false);
    await e.repo.transaction(async (tx) => {
      const ledger = (
        await tx.list<{ bookingId: string; type: string; amount: number }>('feeEntries')
      ).filter((x) => x.bookingId === b.id && x.type === 'REFUND');
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].amount, -b.platformFee);
    });
  }));
test('partial approval records the actual refunded amount and retains the remaining claim opportunity', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock),
      r = await e.refunds.request(customer, b.id, claim(b), randomUUID());
    const next = await e.refunds.decide(
      shop,
      r.id,
      decision(r.version, b.version, 'APPROVE', 1000),
      randomUUID(),
    );
    assert.equal(next.status, 'PARTIALLY_APPROVED');
    assert.equal(next.approvedAmount, 1000);
    const overview = await e.refunds.overview(customer, b.id);
    assert.equal(overview.remaining, b.capturedAmount - 1000);
    assert.equal(overview.canRequest, true);
    assert.equal(overview.bookingVersion, (await e.bookings(customer))[0].version);
    assert.ok(overview.bookingVersion! > b.version);
  }));
test('an external shop refund invalidates stale approval and cannot cause an over-refund', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock),
      r = await e.refunds.request(customer, b.id, claim(b), randomUUID());
    await e.refund(shop, b.id, b.version, 2000);
    await assert.rejects(
      () =>
        e.refunds.decide(
          shop,
          r.id,
          decision(r.version, b.version, 'APPROVE', r.amount),
          randomUUID(),
        ),
      fail('VERSION_CONFLICT'),
    );
    const current = (await e.bookings(customer))[0];
    await assert.rejects(
      () =>
        e.refunds.decide(
          shop,
          r.id,
          decision(r.version, current.version, 'APPROVE', r.amount),
          randomUUID(),
        ),
      fail('REFUND_BALANCE_CHANGED'),
    );
    assert.equal(current.refundedAmount, 2000);
    assert.equal((await e.refunds.forTicket(customer, r.ticketId))?.request.status, 'PENDING');
  }));
test('simultaneous approvals have one winner and one financial effect', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock),
      r = await e.refunds.request(customer, b.id, claim(b), randomUUID()),
      input = decision(r.version, b.version, 'APPROVE', r.amount);
    const result = await Promise.allSettled([
      e.refunds.decide(shop, r.id, input, randomUUID()),
      e.refunds.decide(shop, r.id, input, randomUUID()),
    ]);
    assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await e.bookings(customer))[0].refundedAmount, b.capturedAmount);
  }));
test('rejection moves no money and leaves the case open for customer escalation', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock),
      r = await e.refunds.request(customer, b.id, claim(b), randomUUID());
    await e.refunds.decide(shop, r.id, decision(r.version, b.version, 'REJECT'), randomUUID());
    const ticket = (await e.care.detail(customer, r.ticketId)).ticket;
    assert.equal(ticket.status, 'OPEN');
    assert.equal((await e.bookings(customer))[0].refundedAmount, 0);
    const escalated = await e.care.action(customer, ticket.id, {
      version: ticket.version,
      action: 'ESCALATE',
      text: 'Please ask the platform to review this refund dispute.',
    });
    assert.equal(escalated.status, 'PLATFORM_ESCALATED');
  }));
test('withdrawal moves no funds and an escalated case remains under platform review even after refund', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock),
      r = await e.refunds.request(customer, b.id, claim(b), randomUUID());
    const t = (await e.care.detail(customer, r.ticketId)).ticket;
    await e.care.action(customer, t.id, {
      version: t.version,
      action: 'ESCALATE',
      text: 'Please ask the platform to review this refund dispute.',
    });
    await e.refunds.decide(
      shop,
      r.id,
      decision(r.version, b.version, 'APPROVE', 1000),
      randomUUID(),
    );
    assert.equal((await e.care.detail(customer, t.id)).ticket.status, 'PLATFORM_ESCALATED');
    const current = (await e.bookings(customer))[0],
      second = await e.refunds.request(customer, b.id, claim(current, 1000), randomUUID());
    await e.refunds.decide(
      customer,
      second.id,
      decision(second.version, current.version, 'WITHDRAW'),
      randomUUID(),
    );
    assert.equal((await e.bookings(customer))[0].refundedAmount, 1000);
    assert.equal(
      (await e.refunds.forTicket(customer, second.ticketId))?.request.status,
      'WITHDRAWN',
    );
  }));
test('support quota failure rolls back the entire refund request, with no orphan financial case', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock);
    await e.repo.transaction(async (tx) => {
      for (let i = 0; i < 10; i++)
        await tx.put('supportTickets', {
          id: `quota-${i}`,
          customerId: customer.id,
          reporterId: customer.id,
          reporterRole: 'CUSTOMER',
          status: 'OPEN',
        } as SupportTicket);
    });
    await assert.rejects(
      () => e.refunds.request(customer, b.id, claim(b), randomUUID()),
      fail('SUPPORT_LIMIT'),
    );
    assert.equal((await e.refunds.overview(customer, b.id)).requests.length, 0);
  }));
