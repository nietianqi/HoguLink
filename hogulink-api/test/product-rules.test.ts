import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, booking, customer, shop, staff } from './helpers/experience-fixture.js';
import { advanceClock, finishVisit } from './helpers/visit-fixture.js';
import { DomainError } from '../src/errors.js';

const minute = 60_000;
const code = (name: string) => (error: unknown) =>
  error instanceof DomainError && error.code === name;
// The fixture clock starts at 2026-10-18 09:00 JST.
const jst = (day: number, h: number, m = 0) => Date.UTC(2026, 9, day, h - 9, m);
const quote = (e: Parameters<Parameters<typeof fixture>[0]>[0], startAt: number) =>
  e.quote(customer, {
    listingId: 'listing-aoi',
    offeringId: 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt,
    area: 'shinjuku',
    requiredLanguage: '',
  });

test('the time list can offer two weeks ahead and never more', () =>
  fixture(async (e) => {
    const list = async (days?: number) =>
      (
        await e.availability(
          'listing-aoi',
          'store-nagi-60',
          false,
          '',
          'SCHEDULED',
          'shinjuku',
          'HOME_VISIT',
          days,
        )
      ).slots;
    const dayOf = (slot: number) => Math.floor((slot - e.now()) / (24 * 60 * minute));
    assert.ok(Math.max(...(await list()).map(dayOf)) < 3, 'the default list stays at three days');
    const twoWeeks = await list(14);
    assert.equal(Math.max(...twoWeeks.map(dayOf)), 13, 'the last listed day is two weeks out');
    assert.deepEqual(await list(60), twoWeeks, 'longer requests are capped at two weeks');
    const far = twoWeeks.find((slot) => dayOf(slot) === 10)!;
    assert.equal((await quote(e, far)).startAt, far, 'a listed far time can be quoted');
  }));

test('by default scheduled quotes use the same 09:00-22:00 start hours the list shows', () =>
  fixture(async (e) => {
    await assert.rejects(quote(e, jst(19, 2)), code('OUTSIDE_BOOKING_HOURS'), '02:00 next day');
    await assert.rejects(quote(e, jst(18, 22)), code('OUTSIDE_BOOKING_HOURS'), '22:00');
    await assert.rejects(quote(e, jst(19, 8, 30)), code('OUTSIDE_BOOKING_HOURS'), '08:30');
    assert.ok(await quote(e, jst(18, 21, 30)), '21:30 is the last listed start');
    assert.ok(await quote(e, jst(19, 9)), '09:00 is the first listed start');
    const { slots } = await e.availability(
      'listing-aoi',
      'store-nagi-60',
      false,
      '',
      'SCHEDULED',
      'shinjuku',
    );
    for (const slot of slots) {
      const hour = new Date(slot + 9 * 60 * minute).getUTCHours();
      assert.ok(hour >= 9 && hour < 22, 'every listed slot is quotable');
    }
  }));

test('an instant visit starts once the therapist arrives; the end is still checked from the actual start', () =>
  fixture(async (e) => {
    let b = await booking(e, { mode: 'INSTANT' });
    b = await e.ack(staff, b.id, b.version, 30);
    b = await e.event(staff, b.id, b.version, 'EN_ROUTE');
    advanceClock(e, e.now() + 30 * minute);
    b = await e.event(staff, b.id, b.version, 'ARRIVED');
    assert.ok(e.now() < b.quote.startAt, 'arrived before the estimated start');
    b = await e.event(staff, b.id, b.version, 'START');
    assert.equal(b.status, 'IN_SERVICE');
    const duration = b.quote.endAt - b.quote.startAt;
    // Ending before the full purchased time is still refused.
    advanceClock(e, b.startedAt! + duration - 5 * minute);
    await assert.rejects(e.event(staff, b.id, b.version, 'COMPLETE'));
    advanceClock(e, b.startedAt! + duration);
    b = await e.event(staff, b.id, b.version, 'COMPLETE');
    assert.equal(b.status, 'AWAITING_COMPLETION');
    assert.ok(!b.completion?.timingInvalid);
    const done = await finishVisit(e, b, staff, customer);
    assert.equal(done.status, 'COMPLETED');
    assert.equal(done.capturedAmount, b.quote.total);
  }));

test('a scheduled visit still cannot start before the booked time even after arrival', () =>
  fixture(async (e) => {
    let b = await booking(e);
    b = await e.ack(staff, b.id, b.version);
    advanceClock(e, b.quote.startAt - 20 * minute);
    b = await e.event(staff, b.id, b.version, 'EN_ROUTE');
    b = await e.event(staff, b.id, b.version, 'ARRIVED');
    await assert.rejects(e.event(staff, b.id, b.version, 'START'), code('SERVICE_TOO_EARLY'));
    advanceClock(e, b.quote.startAt);
    assert.equal((await e.event(staff, b.id, b.version, 'START')).status, 'IN_SERVICE');
  }));

test('a shop that opens at night lists and accepts night starts, and nothing outside its hours', () =>
  fixture(async (e) => {
    const saved = await e.merchant.bookingRules(shop, {
      version: 0,
      nominationFee: 500,
      templateId: 'FLEXIBLE_2H',
      businessHours: { startMinute: 18 * 60, endMinute: 4 * 60 },
    });
    assert.deepEqual(saved.businessHours, { startMinute: 1080, endMinute: 240 });
    assert.ok(await quote(e, jst(19, 2)), '02:00 is inside 18:00-04:00');
    assert.ok(await quote(e, jst(18, 23, 30)));
    await assert.rejects(quote(e, jst(19, 12)), code('OUTSIDE_BOOKING_HOURS'));
    await assert.rejects(quote(e, jst(19, 4)), code('OUTSIDE_BOOKING_HOURS'), 'end is exclusive');
    const { slots } = await e.availability(
      'listing-aoi',
      'store-nagi-60',
      false,
      '',
      'SCHEDULED',
      'shinjuku',
    );
    assert.ok(slots.length > 0);
    for (const slot of slots) {
      const m = Math.floor(((slot + 9 * 3_600_000) % 86_400_000) / 60_000);
      assert.ok(m >= 1080 || m < 240, 'every listed slot is inside the shop hours');
    }
    assert.ok(
      slots.some((slot) => new Date(slot + 9 * 3_600_000).getUTCHours() === 1),
      'night slots are now listed',
    );
    // The hours are part of the public shop rules and versioned with them.
    const store = (await e.publicCatalog()).stores.find((x) => x.id === 'store-nagi')!;
    assert.deepEqual(store.bookingRules?.businessHours, { startMinute: 1080, endMinute: 240 });
    await assert.rejects(
      e.merchant.bookingRules(shop, {
        version: saved.version,
        nominationFee: 500,
        templateId: 'FLEXIBLE_2H',
        businessHours: { startMinute: 600, endMinute: 600 },
      }),
    );
  }));

const hour = 60 * minute;
/** Books ten days ahead, then jumps to `at` (default 48 hours before the visit). */
async function distantBooking(
  e: Parameters<Parameters<typeof fixture>[0]>[0],
  decline: boolean,
  at?: (startAt: number) => number,
) {
  let b = await booking(e, { startAt: jst(28, 14) });
  assert.equal(b.paymentStatus, 'METHOD_SAVED', 'no authorization is placed ten days ahead');
  b = await e.ack(staff, b.id, b.version);
  if (decline)
    await e.repo.transaction(async (tx) => {
      const p = await tx.get<any>('payments', b.paymentId);
      await tx.put('payments', { ...p, demoDecline: true });
    });
  advanceClock(e, at ? at(b.quote.startAt) : b.quote.startAt - 48 * hour);
  return e.booking(customer, b.id);
}

test('a distant booking is authorized 48 hours before the visit', () =>
  fixture(async (e) => {
    let b = await distantBooking(e, false, (startAt) => startAt - 48 * hour - 1);
    assert.equal(b.paymentStatus, 'METHOD_SAVED');
    // The background worker wakes exactly when the authorization is due.
    assert.equal(await e.repo.hasDue(e.now()), false);
    assert.equal(await e.repo.hasDue(e.now() + 1), true);
    advanceClock(e, e.now() + 1);
    b = await e.booking(customer, b.id);
    assert.equal(b.paymentStatus, 'AUTHORIZED');
    assert.equal(b.paymentActionBy, undefined);
  }));

test('a declined pre-visit authorization blocks departure until the customer renews it', () =>
  fixture(async (e) => {
    let b = await distantBooking(e, true);
    assert.equal(b.paymentStatus, 'FAILED');
    assert.equal(b.paymentActionBy, e.now() + 12 * hour);
    assert.equal(await e.repo.hasDue(b.paymentActionBy! - 1), false);
    assert.equal(await e.repo.hasDue(b.paymentActionBy!), true, 'the deadline wakes the worker');
    await assert.rejects(e.event(staff, b.id, b.version, 'EN_ROUTE'), code('PAYMENT_REQUIRED'));
    await assert.rejects(
      e.renewPaymentGuarantee(shop, b.id, { version: b.version }),
      code('FORBIDDEN'),
    );
    b = await e.renewPaymentGuarantee(customer, b.id, { version: b.version });
    assert.equal(b.paymentStatus, 'AUTHORIZED');
    assert.equal(b.paymentActionBy, undefined);
    await assert.rejects(
      e.renewPaymentGuarantee(customer, b.id, { version: b.version }),
      code('INVALID_STATE'),
    );
    advanceClock(e, b.quote.startAt - 90 * minute);
    b = await e.event(staff, b.id, b.version, 'EN_ROUTE');
    assert.equal(b.status, 'EN_ROUTE');
  }));

test('without renewal the booking is cancelled free and its time released', () =>
  fixture(async (e) => {
    // The worker was down until 90 minutes before the visit: renewal closes an hour before.
    let b = await distantBooking(e, true, (startAt) => startAt - 90 * minute);
    assert.equal(b.paymentStatus, 'FAILED');
    assert.equal(b.paymentActionBy, b.quote.startAt - hour);
    // Inside the shop's paid cancellation window, but there is no guarantee to charge.
    assert.equal((await e.cancellationPreview(customer, b.id)).fee, 0);
    advanceClock(e, b.paymentActionBy! - 1);
    assert.equal((await e.booking(customer, b.id)).status, 'CONFIRMED');
    advanceClock(e, b.paymentActionBy!);
    b = await e.booking(customer, b.id);
    assert.equal(b.status, 'CANCELLED');
    assert.equal(b.cancelReason, 'PAYMENT_GUARANTEE_FAILED');
    assert.equal(b.paymentStatus, 'VOIDED');
    assert.equal(b.capturedAmount, 0);
    await e.repo.transaction(async (tx) =>
      assert.equal((await tx.get<any>('holds', b.holdId))!.active, false),
    );
  }));
