import { registerClock, advanceClock, finishVisit } from './helpers/visit-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Actor, Booking, Listing, Store } from '@hogulink/contracts';
import { Repository } from '../src/repository.js';
import { Engine } from '../src/engine.js';
import { seed } from '../src/seed.js';
import { DomainError } from '../src/errors.js';
import { assertDemoRuntime, config } from '../src/config.js';
import { purchaseAnnual } from './helpers/subscription-fixture.js';

const customer: Actor = { id: 'customer-a', role: 'CUSTOMER', verificationLevel: 1 };
const other: Actor = { id: 'customer-b', role: 'CUSTOMER', verificationLevel: 1 };
const owner: Actor = {
  id: 'owner-nagi',
  role: 'MERCHANT',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const staff: Actor = {
  id: 'aoi',
  role: 'STAFF',
  staffId: 'staff-aoi',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const admin: Actor = { id: 'admin', role: 'ADMIN', verificationLevel: 3 };
const reason = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;
async function fixture(fn: (engine: Engine, clock: { value: number }) => Promise<void>) {
  const repo = new Repository(undefined, ':memory:');
  await repo.init();
  await seed(repo);
  const clock = { value: Date.UTC(2026, 9, 18, 0, 0) };
  const engine = new Engine(repo, () => clock.value);
  await repo.transaction(async (tx) => {
    for (const l of await tx.list<Listing>('listings')) {
      l.dutyUpdatedAt = clock.value;
      await tx.put('listings', l);
    }
  });
  registerClock(engine, (at) => {
    clock.value = at;
  });
  try {
    await fn(engine, clock);
  } finally {
    await repo.close();
  }
}
function input(engine: Engine, extra: Record<string, unknown> = {}) {
  return {
    listingId: 'listing-aoi',
    offeringId: 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt: engine.now() + 180 * 60_000,
    area: 'shinjuku',
    requiredLanguage: '',
    ...extra,
  };
}
const address = {
  name: 'Test Guest',
  area: 'shinjuku',
  type: 'HOTEL' as const,
  detail: 'Demo street 1-2-3',
  hotelName: 'Demo Hotel',
  room: '101',
  hotelPermission: true,
};
async function prepare(e: Engine, actor = customer, extra: Record<string, unknown> = {}) {
  const q = await e.quote(actor, input(e, extra));
  const h = await e.hold(actor, q.id);
  const p = await e.authorizeDemo(actor, h.id, true);
  const data = {
    holdId: h.id,
    quoteId: q.id,
    paymentId: p.id,
    address,
    termsAccepted: true as const,
    policyVersion: q.cancellationPolicy.version,
  };
  return { q, h, p, data };
}
async function create(e: Engine, extra: Record<string, unknown> = {}) {
  const p = await prepare(e, customer, extra);
  return e.createBooking(customer, p.data, crypto.randomUUID());
}
async function confirm(e: Engine, b: Booking, actor = staff) {
  return e.ack(actor, b.id, b.version, b.quote.bookingMode === 'INSTANT' ? 45 : undefined);
}
async function complete(e: Engine, b: Booking, actor = staff) {
  const done = await finishVisit(e, b, actor, customer);
  return e.booking(actor, done.id);
}

test('merchant, store and original nomination are derived on the server', () =>
  fixture(async (e) => {
    const b = await create(e);
    assert.equal(b.storeId, 'store-nagi');
    assert.equal(b.merchantId, 'merchant-nagi');
    assert.equal(b.selectedStaffId, 'staff-aoi');
    assert.equal(b.status, 'ACCEPTED');
    assert.equal(b.paymentStatus, 'AUTHORIZED');
    assert.equal(b.merchantAcceptance, 'AUTO_ACCEPTED');
  }));
test('missing or mismatched payment guarantee cannot create a booking', () =>
  fixture(async (e) => {
    const p = await prepare(e);
    await assert.rejects(
      e.createBooking(customer, { ...p.data, paymentId: 'forged' }, 'valid-key-123'),
      reason('PAYMENT_REQUIRED'),
    );
    const q = await prepare(e, customer, { startAt: e.now() + 2 * 24 * 60 * 60_000 });
    await assert.rejects(
      e.createBooking(customer, { ...q.data, paymentId: p.p.id }, 'valid-key-456'),
      reason('PAYMENT_REQUIRED'),
    );
  }));
test('parallel holds for the same global staff time have one winner', () =>
  fixture(async (e) => {
    const a = await e.quote(customer, input(e));
    const b = await e.quote(other, input(e));
    const results = await Promise.allSettled([e.hold(customer, a.id), e.hold(other, b.id)]);
    assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(results.filter((x) => x.status === 'rejected').length, 1);
  }));
test('create retries are idempotent and a reused key cannot change input', () =>
  fixture(async (e) => {
    const p = await prepare(e);
    const [a, b] = await Promise.all([
      e.createBooking(customer, p.data, 'retry-key-123'),
      e.createBooking(customer, p.data, 'retry-key-123'),
    ]);
    assert.equal(a.id, b.id);
    assert.equal((await e.bookings(customer)).length, 1);
    await assert.rejects(
      e.createBooking(
        customer,
        { ...p.data, address: { ...address, room: '202' } },
        'retry-key-123',
      ),
      reason('IDEMPOTENCY_CONFLICT'),
    );
  }));
test('optimistic versions prevent repeat acceptance and duplicate task events', () =>
  fixture(async (e) => {
    const b = await create(e);
    const confirmed = await confirm(e, b);
    await assert.rejects(e.ack(staff, b.id, b.version), reason('VERSION_CONFLICT'));
    await assert.rejects(
      e.event(staff, b.id, confirmed.version, 'COMPLETE'),
      reason('INVALID_TRANSITION'),
    );
  }));
test('confirmation requires the assigned staff; tenant/customer access is isolated', () =>
  fixture(async (e) => {
    const b = await create(e);
    await assert.rejects(e.booking(other, b.id), reason('NOT_FOUND'));
    await assert.rejects(
      e.accept({ ...owner, storeId: 'store-mori' }, b.id, b.version),
      reason('NOT_FOUND'),
    );
    await assert.rejects(
      e.ack({ ...staff, staffId: 'staff-ren' }, b.id, b.version),
      reason('NOT_FOUND'),
    );
    await assert.rejects(e.accept(staff, b.id, b.version), reason('FORBIDDEN'));
  }));
test('exact address is hidden before acknowledgment and after completion, including mutation responses', () =>
  fixture(async (e) => {
    let b = await create(e);
    assert.equal((await e.booking(staff, b.id)).address, undefined);
    b = await confirm(e, b);
    assert.ok((await e.booking(staff, b.id)).address);
    b = await complete(e, b);
    assert.equal(b.address, undefined);
    assert.equal((await e.booking(staff, b.id)).address, undefined);
    assert.ok((await e.booking(customer, b.id)).address);
  }));
test('all four booking mode and nomination combinations are supported', async () => {
  for (const bookingMode of ['INSTANT', 'SCHEDULED'])
    for (const nominationType of ['NOMINATED', 'FREE'])
      await fixture(async (e) => {
        let b = await create(e, { bookingMode, nominationType, startAt: e.now() + 90 * 60_000 });
        assert.equal(b.quote.bookingMode, bookingMode);
        assert.equal(b.quote.nominationType, nominationType);
        if (nominationType === 'FREE') {
          assert.equal(b.selectedStaffId, null);
          assert.equal(b.quote.nominationFee, 0);
          b = await e.assign(owner, b.id, b.version, 'listing-aoi');
        }
        b = await confirm(e, b);
        assert.equal(b.status, 'CONFIRMED');
      });
});
test('manual shops cannot receive instant bookings', () =>
  fixture(async (e) => {
    await assert.rejects(
      e.quote(
        customer,
        input(e, {
          listingId: 'listing-yuki',
          offeringId: 'store-mori-60',
          bookingMode: 'INSTANT',
          startAt: e.now() + 60 * 60_000,
        }),
      ),
      reason('INSTANT_UNAVAILABLE'),
    );
  }));
test('SOLO acceptance atomically records merchant acceptance and staff confirmation', () =>
  fixture(async (e) => {
    let b = await create(e, {
      listingId: 'listing-haru',
      offeringId: 'store-sora-60',
      bookingMode: 'INSTANT',
      startAt: e.now() + 60 * 60_000,
    });
    assert.equal(b.status, 'REQUESTED');
    b = await e.accept({ ...owner, storeId: 'store-sora' }, b.id, b.version);
    assert.equal(b.status, 'CONFIRMED');
    assert.equal(b.merchantAcceptance, 'MANUALLY_ACCEPTED');
    assert.equal(b.staffTaskStatus, 'ACKNOWLEDGED');
    assert.equal(b.acceptanceMode, 'SOLO');
  }));
test('nominated replacement requires explicit consent and preserves original selection', () =>
  fixture(async (e) => {
    let b = await confirm(e, await create(e));
    b = await e.assign(owner, b.id, b.version, 'listing-ren', true);
    assert.equal(b.status, 'CONFIRMED');
    assert.equal(b.assignedStaffId, 'staff-aoi');
    assert.equal(b.replacementConsent, 'PENDING');
    await assert.rejects(e.event(staff, b.id, b.version, 'EN_ROUTE'), reason('INVALID_TRANSITION'));
    b = await e.consent(customer, b.id, b.version, true);
    assert.equal(b.assignedStaffId, 'staff-ren');
    assert.equal(b.selectedStaffId, 'staff-aoi');
    assert.equal(b.selectedStaffListingId, 'listing-aoi');
    assert.equal(b.quote.nominationFee, 0);
    assert.equal(b.staffTaskStatus, 'OFFERED');
    await assert.rejects(e.booking(staff, b.id), reason('NOT_FOUND'));
    b = await confirm(e, b, { ...staff, staffId: 'staff-ren' });
    assert.equal(b.status, 'CONFIRMED');
  }));
test('declining a replacement voids authorization and releases both time reservations', () =>
  fixture(async (e) => {
    let b = await create(e);
    b = await e.assign(owner, b.id, b.version, 'listing-ren', true);
    b = await e.consent(customer, b.id, b.version, false);
    assert.equal(b.status, 'CANCELLED');
    assert.equal(b.paymentStatus, 'VOIDED');
    assert.equal(b.capturedAmount, 0);
    const q = await e.quote(other, input(e));
    assert.ok(await e.hold(other, q.id));
  }));
test('FREE assignment preserves required service language and rejects cross-shop staff', () =>
  fixture(async (e) => {
    const b = await create(e, { nominationType: 'FREE', requiredLanguage: 'zh' });
    await assert.rejects(
      e.assign(owner, b.id, b.version, 'listing-ren'),
      reason('INVALID_ASSIGNMENT'),
    );
    await assert.rejects(
      e.assign(owner, b.id, b.version, 'listing-haru'),
      reason('INVALID_ASSIGNMENT'),
    );
    const a = await e.assign(owner, b.id, b.version, 'listing-aoi');
    assert.equal(a.replacementConsent, 'NOT_REQUIRED');
  }));
test('reservation timeout expires the order, voids payment and unlocks capacity', () =>
  fixture(async (e, clock) => {
    const b = await create(e);
    clock.value = b.deadline + 1;
    const expired = await e.booking(customer, b.id);
    assert.equal(expired.status, 'EXPIRED');
    assert.equal(expired.paymentStatus, 'VOIDED');
    const q = await e.quote(other, input(e, { startAt: b.quote.startAt }));
    assert.ok(await e.hold(other, q.id));
  }));
test('checkout hold TTL blocks submission and invalidates unused demo authorization', () =>
  fixture(async (e, clock) => {
    const p = await prepare(e);
    clock.value = p.h.expiresAt + 1;
    await assert.rejects(
      e.createBooking(customer, p.data, 'expired-key-123'),
      reason('HOLD_EXPIRED'),
    );
    await e.run(async (tx) => {
      assert.equal((await tx.get<{ status: string }>('payments', p.p.id))?.status, 'VOIDED');
    });
  }));
test('L0 cannot reserve capacity and expired standby cannot take instant jobs', () =>
  fixture(async (e, clock) => {
    const q = await e.quote(customer, input(e));
    await assert.rejects(
      e.hold({ ...customer, verificationLevel: 0 }, q.id),
      reason('VERIFICATION_REQUIRED'),
    );
    clock.value += 5 * 60 * 60_000;
    await assert.rejects(
      e.quote(customer, input(e, { bookingMode: 'INSTANT', startAt: e.now() + 60 * 60_000 })),
      reason('SLOT_CONFLICT'),
    );
  }));
test('checkout hold quota is enforced per customer', () =>
  fixture(async (e) => {
    await prepare(e, customer, { startAt: e.now() + 2 * 24 * 60 * 60_000 });
    await prepare(e, customer, { startAt: e.now() + 3 * 24 * 60 * 60_000 });
    const q = await e.quote(customer, input(e, { startAt: e.now() + 4 * 24 * 60 * 60_000 }));
    await assert.rejects(e.hold(customer, q.id), reason('HOLD_LIMIT'));
  }));
test('completion captures once, excludes travel from fee base, uses plan at capture', () =>
  fixture(async (e) => {
    let b = await confirm(e, await create(e));
    await purchaseAnnual(e, owner);
    b = await complete(e, b);
    assert.equal(b.paymentStatus, 'PAID');
    assert.equal(b.capturedAmount, b.quote.total);
    assert.equal(b.platformFee, Math.floor((b.quote.serviceFee + b.quote.nominationFee) * 0.05));
    await assert.rejects(e.event(staff, b.id, b.version, 'COMPLETE'), reason('INVALID_TRANSITION'));
  }));
test('repeated partial refunds never over-reverse or exceed captured amount', () =>
  fixture(async (e) => {
    let b = await complete(e, await confirm(e, await create(e)));
    const fee = b.platformFee;
    b = await e.refund(owner, b.id, b.version, 1001);
    assert.equal(b.paymentStatus, 'PARTIALLY_REFUNDED');
    b = await e.refund(owner, b.id, b.version, b.capturedAmount - b.refundedAmount);
    assert.equal(b.paymentStatus, 'REFUNDED');
    const d = await e.dashboard(owner);
    assert.equal(
      d.feeEntries.reduce((sum, x) => sum + x.amount, 0),
      0,
    );
    assert.ok(fee > 0);
    await assert.rejects(e.refund(owner, b.id, b.version, 1), reason('INVALID_AMOUNT'));
  }));
test('merchant-caused cancellation is free; late customer cancellation uses frozen policy', () =>
  fixture(async (e, clock) => {
    let b = await confirm(e, await create(e));
    clock.value = b.quote.startAt - 30 * 60_000;
    b = await e.cancel(customer, b.id, b.version);
    assert.equal(b.capturedAmount, Math.floor((b.quote.total - b.quote.transportFee) * 0.3));
    assert.equal(b.platformFee, 0);
    assert.equal(b.cancelReason, 'CUSTOMER_REQUEST');
  }));
test('late-night first home visit requires L3 and hotel details cannot be omitted', () =>
  fixture(async (e) => {
    const p = await prepare(e, customer, { startAt: Date.UTC(2026, 9, 18, 14, 0) });
    await assert.rejects(
      e.createBooking(
        customer,
        { ...p.data, address: { ...address, type: 'HOME' } },
        'risk-key-123',
      ),
      reason('L3_REQUIRED'),
    );
    await assert.rejects(
      e.createBooking(customer, { ...p.data, address: { ...address, room: '' } }, 'risk-key-456'),
      reason('HOTEL_DETAILS_REQUIRED'),
    );
  }));
test('suspension immediately blocks discovery and new checkout without breaking existing service', () =>
  fixture(async (e) => {
    const b = await create(e);
    await e.enforce(admin, 'listing-aoi', true, 'Safety report');
    assert.ok(!(await e.publicCatalog()).listings.some((x) => x.id === 'listing-aoi'));
    await assert.rejects(e.quote(other, input(e)), reason('LISTING_UNAVAILABLE'));
    assert.equal((await confirm(e, b)).status, 'CONFIRMED');
  }));
test('safety termination records an event, audit and notification outbox then releases time', () =>
  fixture(async (e) => {
    let b = await confirm(e, await create(e));
    b = await e.safety(staff, b.id, 'SAFETY_TERMINATION', b.version);
    assert.equal(b.status, 'CANCELLED');
    assert.equal(b.cancelReason, 'SAFETY_TERMINATION');
    assert.equal(b.capturedAmount, 0);
    const d = await e.dashboard(admin);
    assert.equal(d.safety[0].type, 'SAFETY_TERMINATION');
    assert.ok(d.audit.some((x) => x.action === 'SAFETY_TERMINATION'));
    assert.ok(d.outboxPending > 0);
  }));
test('contact exchange is masked before confirmation; prohibited messages are blocked', () =>
  fixture(async (e) => {
    const b = await create(e);
    const messages = await e.messages(
      customer,
      b.id,
      'Please call +81 90 1234 5678 or test@example.com',
    );
    assert.ok(!messages[0].text.includes('1234'));
    assert.ok(!messages[0].text.includes('@'));
    await assert.rejects(e.messages(customer, b.id, 'happy ending'), reason('CONTENT_BLOCKED'));
  }));
test('database rejects changing immutable merchant identity', () =>
  fixture(async (e) => {
    const b = await create(e);
    await assert.rejects(
      e.repo.transaction((tx) => tx.put('bookings', { ...b, storeId: 'store-mori' })),
      /Immutable booking identity/,
    );
  }));
test('far-future bookings save an authenticated method and do not claim a live authorization', () =>
  fixture(async (e) => {
    const p = await prepare(e, customer, { startAt: e.now() + 10 * 24 * 60 * 60_000 });
    assert.equal(p.p.status, 'METHOD_SAVED');
    const b = await e.createBooking(customer, p.data, 'future-key-123');
    assert.equal(b.paymentStatus, 'METHOD_SAVED');
  }));
test('price version changes and withdrawn listings invalidate checkout', () =>
  fixture(async (e) => {
    const p = await prepare(e);
    await e.repo.transaction(async (tx) => {
      const o = await tx.get<{ id: string; version: number }>('offerings', 'store-nagi-60');
      await tx.put('offerings', { ...o!, version: 2 });
    });
    await assert.rejects(
      e.createBooking(customer, p.data, 'price-key-123'),
      reason('PRICE_CHANGED'),
    );
  }));
test('database independently rejects overlapping intervals', () =>
  fixture(async (e) => {
    await e.repo.transaction((tx) =>
      tx.interval({ id: 'raw-a', staffId: 'any-staff', startAt: 100, endAt: 200, expiresAt: 300 }),
    );
    await assert.rejects(
      e.repo.transaction((tx) =>
        tx.interval({
          id: 'raw-b',
          staffId: 'any-staff',
          startAt: 150,
          endAt: 250,
          expiresAt: 300,
        }),
      ),
      /SLOT_CONFLICT/,
    );
  }));
test('confirmation does not release the buffered staff reservation', () =>
  fixture(async (e) => {
    await confirm(e, await create(e));
    await assert.rejects(
      e.quote(other, input(e, { startAt: e.now() + 240 * 60_000 })),
      reason('SLOT_CONFLICT'),
    );
  }));
test('rejected merchant request releases authorization without a refund operation', () =>
  fixture(async (e) => {
    let b = await create(e, { listingId: 'listing-yuki', offeringId: 'store-mori-60' });
    b = await e.cancel({ ...owner, storeId: 'store-mori' }, b.id, b.version, true);
    assert.equal(b.status, 'REJECTED');
    assert.equal(b.paymentStatus, 'VOIDED');
    assert.equal(b.refundedAmount, 0);
  }));
test('repeat customers receive half fee rate only after a completed paid visit', () =>
  fixture(async (e) => {
    await complete(e, await confirm(e, await create(e)));
    let b = await create(e, { startAt: e.now() + 2 * 24 * 60 * 60_000 });
    b = await complete(e, await confirm(e, b));
    assert.equal(b.captureFeeRateBps, config.standardFeeBps * 0.5);
  }));
test('production and live PSP startup fail closed', () => {
  const prior = process.env.APP_MODE;
  try {
    process.env.APP_MODE = 'production';
    assert.throws(assertDemoRuntime, /Production disabled/);
  } finally {
    if (prior === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = prior;
  }
});

test('availability accounts for the selected service duration and both travel buffers', () =>
  fixture(async (e) => {
    await e.repo.transaction((tx) =>
      tx.interval({
        id: 'future-block',
        staffId: 'staff-aoi',
        startAt: e.now() + 300 * 60_000,
        endAt: e.now() + 360 * 60_000,
        expiresAt: e.now() + 400 * 60_000,
      }),
    );
    const short = await e.availability('listing-aoi', 'store-nagi-60');
    const long = await e.availability('listing-aoi', 'store-nagi-120');
    assert.ok(short.slots.includes(e.now() + 210 * 60_000));
    assert.ok(!long.slots.includes(e.now() + 210 * 60_000));
  }));
test('FREE availability includes same-shop capacity even when the representative staff is busy', () =>
  fixture(async (e) => {
    const booked = await create(e);
    const single = await e.availability('listing-aoi', 'store-nagi-60');
    const free = await e.availability('listing-aoi', 'store-nagi-60', true, 'en');
    assert.ok(!single.slots.includes(booked.quote.startAt));
    assert.ok(free.slots.includes(booked.quote.startAt));
  }));
test('checkout restores server-verified payment authentication after navigation', () =>
  fixture(async (e) => {
    const p = await prepare(e);
    const checkout = await e.checkout(customer, p.h.id);
    assert.equal(checkout.payment?.id, p.p.id);
    assert.equal(checkout.payment?.status, 'AUTHORIZED');
  }));

test('repeated SOS responses never expose an unconfirmed customer address', () =>
  fixture(async (e) => {
    const b = await create(e);
    const first = await e.safety(staff, b.id, 'SOS', b.version);
    assert.equal(first.address, undefined);
    const retry = await e.safety(staff, b.id, 'SOS', first.version);
    assert.equal(retry.address, undefined);
    assert.equal((await e.dashboard(admin)).safety.length, 1);
  }));

test('checkout exposes the actual held location constraint and omits identity for FREE', () =>
  fixture(async (e) => {
    const nominated = await prepare(e, customer, {
      listingId: 'listing-mio',
      requiredLanguage: 'zh',
    });
    const detail = await e.checkout(customer, nominated.h.id);
    assert.equal(detail.visit.hotelOnly, true);
    assert.equal(detail.visit.listingName?.en, 'Mio');
    assert.equal(detail.visit.durationMinutes, 60);
    assert.equal(detail.quote.cancellationPolicy.version, nominated.q.cancellationPolicy.version);
    await e.releaseCheckoutHold(customer, nominated.h.id);
    const free = await prepare(e, customer, {
      listingId: 'listing-mio',
      nominationType: 'FREE',
      requiredLanguage: 'en',
    });
    const freeDetail = await e.checkout(customer, free.h.id);
    assert.equal(freeDetail.visit.listingName, undefined);
    assert.equal(freeDetail.visit.photo, undefined);
    assert.equal(freeDetail.visit.hotelOnly, false); // held Aoi, rather than representative Mio
  }));
test('editing a checkout releases capacity and unused authorization idempotently', () =>
  fixture(async (e) => {
    const p = await prepare(e);
    await assert.rejects(e.releaseCheckoutHold(other, p.h.id), reason('NOT_FOUND'));
    await assert.rejects(e.releaseCheckoutHold(owner, p.h.id), reason('FORBIDDEN'));
    assert.deepEqual(await e.releaseCheckoutHold(customer, p.h.id), { released: true });
    assert.deepEqual(await e.releaseCheckoutHold(customer, p.h.id), { released: true });
    const payment = await e.repo.transaction((tx) =>
      tx.get<{ status: string }>('payments', p.p.id),
    );
    assert.equal(payment?.status, 'VOIDED');
    await assert.rejects(e.createBooking(customer, p.data, 'released'), reason('HOLD_EXPIRED'));
    const replacement = await e.quote(other, input(e));
    assert.ok((await e.hold(other, replacement.id)).active);
  }));
test('a submitted booking cannot be released through the checkout editing endpoint', () =>
  fixture(async (e) => {
    const booking = await create(e);
    await assert.rejects(e.releaseCheckoutHold(customer, booking.holdId), reason('INVALID_STATE'));
    assert.equal((await e.booking(customer, booking.id)).status, booking.status);
  }));
test('FREE availability uses all supported shop services without exposing cross-shop prices', () =>
  fixture(async (e) => {
    await e.repo.transaction(async (tx) => {
      const listing = (await tx.get<Listing>('listings', 'listing-aoi'))!;
      listing.offeringIds = ['store-nagi-60'];
      await tx.put('listings', listing);
    });
    assert.ok((await e.availability('listing-aoi', 'store-nagi-120', true, 'en')).slots.length > 0);
    await assert.rejects(
      e.availability('listing-aoi', 'store-nagi-120'),
      reason('INVALID_OFFERING'),
    );
    await assert.rejects(
      e.availability('listing-aoi', 'store-mori-60', true),
      reason('INVALID_OFFERING'),
    );
  }));
test('instant preview checks standby and the whole travel interval before service', () =>
  fixture(async (e) => {
    const instant = await e.availability('listing-aoi', 'store-nagi-60', false, '', 'INSTANT');
    assert.equal(instant.slots.length, 1);
    const quote = await e.quote(
      customer,
      input(e, { bookingMode: 'INSTANT', startAt: instant.slots[0] }),
    );
    assert.equal(quote.startAt, instant.slots[0]);
    await e.repo.transaction((tx) =>
      tx.interval({
        id: 'travel-conflict',
        staffId: 'staff-aoi',
        startAt: e.now() + 5 * 60000,
        endAt: e.now() + 15 * 60000,
        expiresAt: e.now() + 120 * 60000,
      }),
    );
    assert.equal(
      (await e.availability('listing-aoi', 'store-nagi-60', false, '', 'INSTANT')).slots.length,
      0,
    );
    assert.ok(
      (await e.availability('listing-aoi', 'store-nagi-60')).slots.includes(instant.slots[0]),
    );
    assert.equal(
      (await e.availability('listing-yuki', 'store-mori-60', false, '', 'INSTANT')).slots.length,
      0,
    );
  }));
test('public booking rules reflect the configured fee and cancellation policy', () =>
  fixture(async (e) => {
    const catalog = await e.publicCatalog();
    assert.equal(catalog.bookingRules.nominationFee, config.nominationFee);
    assert.deepEqual(catalog.bookingRules.cancellationPolicy, config.cancellation);
  }));
