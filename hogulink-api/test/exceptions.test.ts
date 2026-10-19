import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Actor, Booking, Hold, Listing, Store } from '@hogulink/contracts';
import { Engine } from '../src/engine.js';
import { Repository } from '../src/repository.js';
import { seed } from '../src/seed.js';
import { DomainError } from '../src/errors.js';

const customer: Actor = { id: 'exception-customer', role: 'CUSTOMER', verificationLevel: 1 };
const owner: Actor = {
  id: 'exception-owner',
  role: 'MERCHANT',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const staff: Actor = {
  id: 'exception-staff',
  role: 'STAFF',
  staffId: 'staff-aoi',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const minute = 60000;
const code = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;
async function fixture(fn: (e: Engine, clock: { now: number }) => Promise<void>) {
  const repo = new Repository(undefined, ':memory:');
  await repo.init();
  await seed(repo);
  const clock = { now: Date.UTC(2026, 9, 18, 0) },
    e = new Engine(repo, () => clock.now);
  await repo.transaction(async (tx) => {
    for (const l of await tx.list<Listing>('listings'))
      await tx.put('listings', { ...l, dutyUpdatedAt: clock.now });
  });
  try {
    await fn(e, clock);
  } finally {
    await repo.close();
  }
}
const input = (e: Engine, extra = {}) => ({
  listingId: 'listing-aoi',
  offeringId: 'store-nagi-60',
  bookingMode: 'SCHEDULED',
  nominationType: 'NOMINATED',
  startAt: e.now() + 180 * minute,
  area: 'shinjuku',
  requiredLanguage: '',
  ...extra,
});
async function prepare(e: Engine, extra = {}) {
  const q = await e.quote(customer, input(e, extra)),
    h = await e.hold(customer, q.id);
  return { q, h };
}
async function book(e: Engine, extra = {}) {
  const { q, h } = await prepare(e, extra),
    p = await e.authorizeDemo(customer, h.id, true);
  return e.createBooking(
    customer,
    {
      quoteId: q.id,
      holdId: h.id,
      paymentId: p.id,
      termsAccepted: true,
      policyVersion: q.cancellationPolicy.version,
      address: {
        name: 'Exception Guest',
        area: 'shinjuku',
        type: 'HOTEL',
        detail: 'Private exception test address',
        hotelName: 'Demo Hotel',
        room: '101',
        hotelPermission: true,
      },
    },
    randomUUID(),
  );
}
async function confirmed(e: Engine, extra = {}) {
  const b = await book(e, extra);
  return e.ack(staff, b.id, b.version);
}
async function arrived(e: Engine, clock: { now: number }) {
  let b = await confirmed(e);
  clock.now = b.quote.startAt;
  for (const event of ['EN_ROUTE', 'ARRIVED']) b = await e.event(staff, b.id, b.version, event);
  return b;
}
const act = (
  e: Engine,
  b: Booking,
  action: 'CONTACT' | 'REPORT' | 'CONFIRM' | 'DISMISS',
  actor = action === 'CONTACT' || action === 'REPORT' ? staff : owner,
  key: string = randomUUID(),
) =>
  e.noShowAction(
    actor,
    b.id,
    { action, version: b.version, text: 'Recorded visit contact and policy review for this test.' },
    key,
  );
async function reported(e: Engine, clock: { now: number }) {
  let b = await arrived(e, clock);
  b = await act(e, b, 'CONTACT');
  clock.now += 2 * minute;
  b = await act(e, b, 'CONTACT');
  clock.now = b.noShow!.waitUntil;
  return act(e, b, 'REPORT');
}

test('AT-19 failed authentication commits release, voids unused security and permits a new hold only', () =>
  fixture(async (e) => {
    const { q, h } = await prepare(e),
      p = await e.authorizeDemo(customer, h.id, true);
    await assert.rejects(e.authorizeDemo(customer, h.id, false), code('PAYMENT_FAILED'));
    assert.equal((await e.repo.transaction((tx) => tx.get<Hold>('holds', h.id)))?.active, false);
    assert.equal(
      (await e.repo.transaction((tx) => tx.get<{ status: string }>('payments', p.id)))?.status,
      'VOIDED',
    );
    assert.equal((await e.bookings(customer)).length, 0);
    await assert.rejects(e.authorizeDemo(customer, h.id, true), code('HOLD_EXPIRED'));
    assert.ok((await e.hold(customer, q.id)).id !== h.id);
  }));
test('AT-19 another customer cannot release a checkout by reporting payment failure', () =>
  fixture(async (e) => {
    const { h } = await prepare(e);
    await assert.rejects(
      e.authorizeDemo({ ...customer, id: 'intruder' }, h.id, false),
      code('HOLD_EXPIRED'),
    );
    assert.equal((await e.repo.transaction((tx) => tx.get<Hold>('holds', h.id)))?.active, true);
  }));
async function secondMember(e: Engine) {
  await e.repo.transaction(async (tx) => {
    const l = (await tx.get<Listing>('listings', 'listing-haru'))!;
    await tx.put('listings', {
      ...l,
      id: 'second-sora-member',
      staffId: 'second-sora-person',
      slug: 'second-sora',
    });
  });
}
test('AT-23 a second active authorization exits SOLO once, versions rules and requires both confirmations', () =>
  fixture(async (e) => {
    await secondMember(e);
    await e.run(async () => {});
    await e.run(async () => {});
    const s = (await e.repo.transaction((tx) => tx.get<Store>('stores', 'store-sora')))!;
    assert.equal(s.acceptanceMode, 'MANUAL');
    assert.equal(s.ruleVersion, 2);
    const audits = await e.repo.transaction((tx) => tx.list<{ action: string }>('audit'));
    assert.equal(audits.filter((a) => a.action === 'SOLO_EXITED').length, 1);
    let b = await book(e, { listingId: 'listing-haru', offeringId: 'store-sora-60' });
    assert.equal(b.status, 'REQUESTED');
    b = await e.accept({ ...owner, storeId: 'store-sora' }, b.id, b.version);
    assert.equal(b.status, 'ACCEPTED');
    assert.equal(b.staffTaskStatus, 'OFFERED');
    b = await e.ack({ ...staff, staffId: 'staff-haru', storeId: 'store-sora' }, b.id, b.version);
    assert.equal(b.status, 'CONFIRMED');
  }));
for (const cause of ['SECOND_STORE', 'OWNER_UNVERIFIED', 'OWNER_CHANGED'] as const)
  test(`SOLO exits for ${cause}`, () =>
    fixture(async (e) => {
      await e.repo.transaction(async (tx) => {
        const s = (await tx.get<Store>('stores', 'store-sora'))!,
          l = (await tx.get<Listing>('listings', 'listing-haru'))!;
        if (cause === 'SECOND_STORE')
          await tx.put('stores', {
            ...s,
            id: 'second-sora-shop',
            slug: 'second-sora-shop',
            acceptanceMode: 'MANUAL',
          });
        else if (cause === 'OWNER_UNVERIFIED')
          await tx.put('listings', { ...l, identityVerified: false });
        else await tx.put('stores', { ...s, ownerStaffId: 'another-owner' });
      });
      await e.run(async () => {});
      assert.equal(
        (await e.repo.transaction((tx) => tx.get<Store>('stores', 'store-sora')))?.acceptanceMode,
        'MANUAL',
      );
    }));
test('SOLO publication pause alone does not revoke verified ownership', () =>
  fixture(async (e) => {
    await e.repo.transaction(async (tx) => {
      const l = (await tx.get<Listing>('listings', 'listing-haru'))!;
      await tx.put('listings', { ...l, publicationStatus: 'SUSPENDED' });
    });
    await e.run(async () => {});
    assert.equal(
      (await e.repo.transaction((tx) => tx.get<Store>('stores', 'store-sora')))?.acceptanceMode,
      'SOLO',
    );
  }));
for (const mode of ['SCHEDULED', 'INSTANT'])
  test(`pre-existing ${mode} SOLO request is handled without an invalid atomic ACK`, () =>
    fixture(async (e) => {
      let b = await book(e, {
        listingId: 'listing-haru',
        offeringId: 'store-sora-60',
        bookingMode: mode,
        startAt: e.now() + 90 * minute,
      });
      await secondMember(e);
      b = await e.accept({ ...owner, storeId: 'store-sora' }, b.id, b.version);
      assert.equal(b.status, mode === 'SCHEDULED' ? 'ACCEPTED' : 'CANCELLED');
      assert.equal(b.capturedAmount, 0);
      assert.notEqual(b.staffTaskStatus, 'ACKNOWLEDGED');
      if (mode === 'INSTANT') assert.equal(b.paymentStatus, 'VOIDED');
    }));
test('AT-24 withdrawal opens pending resolution, permits a proposal, and never extends the original window', () =>
  fixture(async (e, clock) => {
    let b = await confirmed(e);
    b = await e.decline(staff, b.id, b.version, 'No longer available for this task');
    assert.equal(b.status, 'CONFIRMED');
    assert.equal(b.replacementConsent, 'PENDING');
    assert.equal(b.proposedListingId, undefined);
    await assert.rejects(e.consent(customer, b.id, b.version, true), code('PROPOSAL_REQUIRED'));
    const candidates = await e.assignmentCandidates(owner, b.id);
    assert(candidates.length);
    const deadline = b.replacementDeadline!;
    clock.now += 5 * minute;
    b = await e.assign(owner, b.id, b.version, candidates[0].id, true);
    assert.equal(b.replacementDeadline, deadline);
    b = await e.consent(customer, b.id, b.version, true);
    assert.equal(b.quote.nominationFee, 0);
    assert.equal(b.selectedStaffId, 'staff-aoi');
  }));
test('AT-24 a customer may decline before any replacement is proposed and pays nothing', () =>
  fixture(async (e) => {
    let b = await confirmed(e);
    b = await e.decline(staff, b.id, b.version, 'Unable to perform confirmed visit');
    b = await e.consent(customer, b.id, b.version, false);
    assert.equal(b.status, 'CANCELLED');
    assert.equal(b.capturedAmount, 0);
    assert.equal(b.paymentStatus, 'VOIDED');
  }));
test('AT-24 waiting for a candidate expires and releases both payment and capacity', () =>
  fixture(async (e, clock) => {
    let b = await confirmed(e);
    b = await e.decline(staff, b.id, b.version, 'Unable to perform confirmed visit');
    clock.now = b.replacementDeadline!;
    await e.run(async () => {});
    b = await e.booking(customer, b.id);
    assert.equal(b.status, 'EXPIRED');
    assert.equal(b.paymentStatus, 'VOIDED');
  }));
test('FREE withdrawal stays in shop assignment flow without customer consent', () =>
  fixture(async (e) => {
    let b = await book(e, { nominationType: 'FREE' });
    b = await e.assign(owner, b.id, b.version, 'listing-aoi');
    b = await e.ack(staff, b.id, b.version);
    b = await e.decline(staff, b.id, b.version, 'Please assign another eligible colleague');
    assert.equal(b.replacementConsent, 'NOT_REQUIRED');
    assert((await e.assignmentCandidates(owner, b.id)).length);
  }));
test('no-show policy is frozen on new quotes and contact before arrival is rejected', () =>
  fixture(async (e) => {
    const b = await confirmed(e);
    assert.equal(b.quote.cancellationPolicy.noShow?.waitMinutes, 15);
    await assert.rejects(act(e, b, 'CONTACT'), code('INVALID_STATE'));
  }));
test('no-show contact is idempotent, creates a real conversation message and enforces spacing', () =>
  fixture(async (e, clock) => {
    const b = await arrived(e, clock),
      key = randomUUID();
    let next = await act(e, b, 'CONTACT', staff, key);
    assert.equal((await act(e, b, 'CONTACT', staff, key)).version, next.version);
    assert.equal(next.noShow?.contacts.length, 1);
    assert.equal((await e.messages(customer, b.id)).length, 1);
    await assert.rejects(act(e, next, 'CONTACT'), code('CONTACT_TOO_SOON'));
    clock.now += 2 * minute;
    next = await act(e, next, 'CONTACT');
    assert.equal(next.noShow?.contacts.length, 2);
    const audit = JSON.stringify(await e.repo.transaction((tx) => tx.list('audit')));
    assert(!audit.includes('Recorded visit contact'));
  }));
test('no-show requires two contacts and the exact waiting deadline; reporting itself never charges', () =>
  fixture(async (e, clock) => {
    let b = await arrived(e, clock);
    b = await act(e, b, 'CONTACT');
    await assert.rejects(act(e, b, 'REPORT'), code('NO_SHOW_NOT_READY'));
    clock.now += 2 * minute;
    b = await act(e, b, 'CONTACT');
    clock.now = b.noShow!.waitUntil - 1;
    await assert.rejects(act(e, b, 'REPORT'), code('NO_SHOW_NOT_READY'));
    clock.now++;
    b = await act(e, b, 'REPORT');
    assert.equal(b.noShow?.status, 'REPORTED');
    assert.equal(b.capturedAmount, 0);
    assert.equal(b.platformFee, 0);
  }));
test('arriving early cannot start the no-show timer before the scheduled service start', () =>
  fixture(async (e) => {
    let b = await confirmed(e);
    for (const event of ['EN_ROUTE', 'ARRIVED']) b = await e.event(staff, b.id, b.version, event);
    b = await act(e, b, 'CONTACT');
    assert.equal(b.noShow!.waitUntil, b.quote.startAt + 15 * minute);
  }));
test('customer replies block no-show reporting and charging while allowing shop dismissal', () =>
  fixture(async (e, clock) => {
    let b = await reported(e, clock);
    await e.messages(customer, b.id, 'I am at reception, please wait for me.');
    await assert.rejects(act(e, b, 'CONFIRM'), code('CUSTOMER_RESPONDED'));
    b = await act(e, b, 'DISMISS');
    assert.equal(b.noShow?.status, 'DISMISSED');
    assert.equal(b.capturedAmount, 0);
  }));
test('only the assigned active therapist records evidence and only this shop confirms the fee', () =>
  fixture(async (e, clock) => {
    const b = await reported(e, clock);
    await assert.rejects(act(e, b, 'CONFIRM', staff), code('FORBIDDEN'));
    await assert.rejects(act(e, b, 'CONFIRM', customer), code('FORBIDDEN'));
    await assert.rejects(
      act(e, b, 'CONFIRM', { ...owner, storeId: 'store-mori' }),
      code('NOT_FOUND'),
    );
    await assert.rejects(
      act(e, b, 'CONTACT', { ...staff, staffId: 'staff-ren' }),
      code('NOT_FOUND'),
    );
  }));
test('AT-26 shop review captures only the agreed fee, releases capacity, and retries never double charge', () =>
  fixture(async (e, clock) => {
    const b = await reported(e, clock),
      key = randomUUID();
    let closed = await act(e, b, 'CONFIRM', owner, key);
    assert.equal(closed.status, 'CANCELLED');
    assert.equal(closed.cancelReason, 'CUSTOMER_NO_SHOW');
    assert.equal(closed.capturedAmount, 2310);
    assert.equal(closed.platformFee, 0);
    const payment = await e.repo.transaction((tx) =>
      tx.get<{ capturedAmount: number; voidedAmount: number }>('payments', b.paymentId),
    );
    assert.equal(payment?.capturedAmount, 2310);
    assert.equal(payment?.voidedAmount, 6390);
    assert.equal((await act(e, b, 'CONFIRM', owner, key)).capturedAmount, 2310);
    const fees = await e.repo.transaction((tx) =>
      tx.list<{ type: string; amount: number }>('feeEntries'),
    );
    assert.equal(fees.length, 1);
    assert.equal(fees[0].type, 'NO_SHOW');
    assert.equal(fees[0].amount, 0);
    assert.equal(
      await e.repo.transaction((tx) => tx.conflicts('staff-aoi', b.quote.startAt, b.quote.endAt)),
      false,
    );
    await assert.rejects(act(e, closed, 'CONFIRM'), code('INVALID_STATE'));
    closed = await e.refund(owner, closed.id, closed.version, closed.capturedAmount);
    assert.equal(closed.paymentStatus, 'REFUNDED');
    assert.equal(closed.platformFee, 0);
  }));
test('concurrent no-show decisions have one financial winner', () =>
  fixture(async (e, clock) => {
    const b = await reported(e, clock);
    const results = await Promise.allSettled([act(e, b, 'CONFIRM'), act(e, b, 'CONFIRM')]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await e.booking(customer, b.id)).capturedAmount, 2310);
  }));
test('starting service or shop cancellation dismisses pending no-show evidence without a no-show fee', () =>
  fixture(async (e, clock) => {
    let b = await reported(e, clock);
    b = await e.event(staff, b.id, b.version, 'START');
    assert.equal(b.noShow?.status, 'DISMISSED');
    await assert.rejects(act(e, b, 'CONFIRM'), code('INVALID_STATE'));
    assert.equal(b.capturedAmount, 0);
  }));
test('legacy bookings without a frozen no-show agreement cannot be charged under new policy', () =>
  fixture(async (e, clock) => {
    const b = await arrived(e, clock);
    await e.repo.transaction((tx) =>
      tx.put('bookings', {
        ...b,
        quote: {
          ...b.quote,
          cancellationPolicy: { ...b.quote.cancellationPolicy, noShow: undefined },
        },
      }),
    );
    await assert.rejects(act(e, b, 'CONTACT'), code('NO_SHOW_POLICY_REQUIRED'));
  }));
test('no-show ignores client clocks, rejects unknown fields, short evidence, prohibited content and missing retry keys', () =>
  fixture(async (e, clock) => {
    const b = await arrived(e, clock);
    await assert.rejects(
      e.noShowAction(
        staff,
        b.id,
        {
          version: b.version,
          action: 'CONTACT',
          text: 'valid evidence message',
          now: e.now() + 9999999,
        },
        randomUUID(),
      ),
    );
    await assert.rejects(
      e.noShowAction(
        staff,
        b.id,
        { version: b.version, action: 'CONTACT', text: 'short' },
        randomUUID(),
      ),
    );
    await assert.rejects(act(e, b, 'CONTACT', staff, ''), code('IDEMPOTENCY_REQUIRED'));
    await assert.rejects(
      e.noShowAction(
        staff,
        b.id,
        {
          version: b.version,
          action: 'CONTACT',
          text: 'This contains happy ending prohibited content',
        },
        randomUUID(),
      ),
      code('CONTENT_BLOCKED'),
    );
  }));
test('expired payment security prevents no-show capture and keeps the report open', () =>
  fixture(async (e, clock) => {
    const b = await reported(e, clock);
    await e.repo.transaction(async (tx) => {
      const p = (await tx.get<{ id: string }>('payments', b.paymentId))!;
      await tx.put('payments', { ...p, expiresAt: e.now() });
    });
    await assert.rejects(act(e, b, 'CONFIRM'), code('PAYMENT_REQUIRED'));
    assert.equal((await e.booking(customer, b.id)).noShow?.status, 'REPORTED');
  }));

test('shop cancellation dismisses no-show review without charging or retaining capacity', () =>
  fixture(async (e, clock) => {
    let b = await reported(e, clock);
    b = await e.cancel(owner, b.id, b.version);
    assert.equal(b.noShow?.status, 'DISMISSED');
    assert.equal(b.capturedAmount, 0);
    assert.equal(b.paymentStatus, 'VOIDED');
  }));
test('a late first contact starts a new full waiting period and retry keys cannot change operation', () =>
  fixture(async (e, clock) => {
    let b = await arrived(e, clock);
    clock.now += 5 * minute;
    const key = randomUUID();
    b = await act(e, b, 'CONTACT', staff, key);
    assert.equal(b.noShow?.waitUntil, b.quote.startAt + 20 * minute);
    await assert.rejects(act(e, b, 'REPORT', staff, key), code('IDEMPOTENCY_CONFLICT'));
    assert.equal((await e.booking(customer, b.id)).noShow?.contacts.length, 1);
  }));
test('no-show review notes are shared with the customer but excluded from general admin snapshots', () =>
  fixture(async (e, clock) => {
    const b = await reported(e, clock);
    assert.equal(
      (await e.booking(customer, b.id)).noShow?.reviewNote,
      'Recorded visit contact and policy review for this test.',
    );
    const admin: Actor = { id: 'admin', role: 'ADMIN', verificationLevel: 3 };
    assert.equal(
      (await e.bookings(admin)).find((x) => x.id === b.id)?.noShow?.reviewNote,
      undefined,
    );
    assert.equal(
      (await e.admin.snapshot(admin)).bookings.find((x) => x.id === b.id)?.noShow?.reviewNote,
      undefined,
    );
  }));
