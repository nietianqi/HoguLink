import test from 'node:test';
import assert from 'node:assert/strict';
import type { Actor, Booking, SafetyCheckIn, SafetyEvent } from '@hogulink/contracts';
import { DomainError } from '../src/errors.js';
import {
  customer,
  shop,
  staff,
  admin,
  fixture,
  booking,
  start,
} from './helpers/experience-fixture.js';
const fail = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;
const minute = 60000;
const reason = 'Confirmed the staff member is safe and reviewed the event facts.';
test('overdue travel and arrival tasks remain excluded from instant capacity after their original interval', async () => {
  for (const status of ['EN_ROUTE', 'ARRIVED'])
    await fixture(async (e, clock) => {
      let b = await booking(e, { mode: 'INSTANT' });
      b = await e.ack(staff, b.id, b.version, 45);
      b = await e.event(staff, b.id, b.version, 'EN_ROUTE');
      if (status === 'ARRIVED') b = await e.event(staff, b.id, b.version, 'ARRIVED');
      clock.now = b.quote.endAt + 45 * minute;
      await e.repo.transaction(async (tx) => {
        const l = await tx.get<any>('listings', 'listing-aoi');
        await tx.put('listings', { ...l, dutyUpdatedAt: clock.now });
      });
      assert(
        !(await e.publicCatalog({ mode: 'INSTANT' })).listings.some((l) => l.id === 'listing-aoi'),
      );
      assert.equal(
        (await e.availability('listing-aoi', 'store-nagi-60', false, '', 'INSTANT')).slots.length,
        0,
      );
    });
});
test('an explicit help request upgrades an existing missed check-in incident without creating a duplicate or allowing stale resolution', () =>
  fixture(async (e, clock) => {
    const b = await start(e, clock);
    clock.now = b.quote.endAt + 20 * minute;
    const desk = await e.fulfillment.desk(staff),
      c = desk.checks[0],
      old = desk.events[0];
    await e.fulfillment.respond(staff, b.id, { version: c.version, action: 'NEED_HELP' });
    const updated = await e.fulfillment.desk(admin);
    assert.equal(updated.events.length, 1);
    assert.equal(updated.events[0].id, old.id);
    assert.equal(updated.events[0].type, 'SOS');
    assert.equal(updated.events[0].version, (old.version ?? 1) + 1);
    await assert.rejects(
      () => e.care.resolveSafety(admin, old.id, old.version ?? 1, reason),
      fail('VERSION_CONFLICT'),
    );
  }));
test('overrunning service cannot reappear as instant capacity after its planned interval ends', () =>
  fixture(async (e, clock) => {
    const b = await start(e, clock);
    clock.now = b.quote.endAt + 45 * minute;
    await e.repo.transaction(async (tx) => {
      const listing = await tx.get<any>('listings', 'listing-aoi');
      await tx.put('listings', { ...listing, dutyUpdatedAt: clock.now });
    });
    assert.equal(
      (await e.availability('listing-aoi', 'store-nagi-60', false, '', 'INSTANT')).slots.length,
      0,
    );
    assert(
      !(await e.publicCatalog({ mode: 'INSTANT' })).listings.some((l) => l.id === 'listing-aoi'),
    );
    assert.equal(
      (await e.publicCatalog()).listings.find((l) => l.id === 'listing-aoi')?.onDuty,
      false,
    );
    await assert.rejects(
      () =>
        e.quote(customer, {
          listingId: 'listing-aoi',
          offeringId: 'store-nagi-60',
          bookingMode: 'INSTANT',
          nominationType: 'NOMINATED',
          startAt: clock.now + 60 * minute,
          area: 'shinjuku',
          requiredLanguage: '',
        }),
      fail('SLOT_CONFLICT'),
    );
  }));
test('cancellation preview uses server time and fee confirmation blocks a changed charge without side effects', () =>
  fixture(async (e, clock) => {
    let b = await booking(e);
    b = await e.ack(staff, b.id, b.version);
    const preview = await e.cancellationPreview(customer, b.id);
    assert.equal(preview.fee, 0);
    assert.equal(preview.bookingVersion, b.version);
    clock.now = b.quote.startAt - 119 * minute;
    await assert.rejects(
      () => e.cancel(customer, b.id, b.version, false, preview.fee),
      fail('CANCELLATION_PRICE_CHANGED'),
    );
    const unchanged = await current(e, b.id);
    assert.equal(unchanged.status, b.status);
    assert.equal(unchanged.capturedAmount, 0);
    const next = await e.cancellationPreview(customer, b.id);
    assert.ok(next.fee > 0);
    const result = await e.cancel(customer, b.id, next.bookingVersion, false, next.fee);
    assert.equal(result.capturedAmount, next.fee);
  }));
test('a free instant cancellation preview cannot be used after departure and another customer cannot inspect it', () =>
  fixture(async (e) => {
    let b = await booking(e, { mode: 'INSTANT' });
    b = await e.ack(staff, b.id, b.version, 45);
    const p = await e.cancellationPreview(customer, b.id);
    assert.equal(p.fee, 0);
    await assert.rejects(
      () => e.cancellationPreview({ ...customer, id: 'another-customer' }, b.id),
      fail('NOT_FOUND'),
    );
    await assert.rejects(() => e.cancellationPreview(staff, b.id), fail('FORBIDDEN'));
    b = await e.event(staff, b.id, b.version, 'EN_ROUTE');
    await assert.rejects(
      () => e.cancel(customer, b.id, b.version, false, p.fee),
      fail('CANCELLATION_PRICE_CHANGED'),
    );
    assert.equal((await e.cancellationPreview(customer, b.id)).fee, b.quote.transportFee);
  }));
test('both customer and shop use service exceptions instead of bypassing completion through cancellation', () =>
  fixture(async (e, clock) => {
    const b = await start(e, clock);
    await assert.rejects(() => e.cancellationPreview(customer, b.id), fail('SERVICE_IN_PROGRESS'));
    await assert.rejects(() => e.cancellationPreview(shop, b.id), fail('SERVICE_IN_PROGRESS'));
  }));
async function current(e: Parameters<Parameters<typeof fixture>[0]>[0], id: string) {
  return e.repo.transaction((tx) => tx.get<Booking>('bookings', id)).then((b) => b!);
}
test('new instant cancellation template is snapshotted and cancellation before departure is free', () =>
  fixture(async (e) => {
    let b = await booking(e, { mode: 'INSTANT' });
    assert.equal(b.quote.cancellationPolicy.instantTravelOnly, true);
    b = await e.ack(staff, b.id, b.version, 45);
    assert.equal(b.arrival?.promisedAt, e.now() + 45 * minute);
    const cancelled = await e.cancel(customer, b.id, b.version);
    assert.equal(cancelled.capturedAmount, 0);
    assert.equal(cancelled.platformFee, 0);
    assert.equal(cancelled.paymentStatus, 'VOIDED');
  }));
test('instant cancellation after departure captures only quoted travel and voids the remainder', () =>
  fixture(async (e) => {
    let b = await booking(e, { mode: 'INSTANT' });
    b = await e.ack(staff, b.id, b.version, 45);
    b = await e.event(staff, b.id, b.version, 'EN_ROUTE');
    const cancelled = await e.cancel(customer, b.id, b.version);
    assert.equal(cancelled.capturedAmount, b.quote.transportFee);
    assert.equal(cancelled.platformFee, 0);
    const p = await e.repo.transaction((tx) =>
      tx.get<{ capturedAmount: number; voidedAmount: number }>('payments', b.paymentId),
    );
    assert.equal(p?.capturedAmount, b.quote.transportFee);
    assert.equal(p?.voidedAmount, b.quote.total - b.quote.transportFee);
    const refunded = await e.refund(shop, b.id, cancelled.version, cancelled.capturedAmount);
    assert.equal(refunded.refundedAmount, cancelled.capturedAmount);
  }));
test('arrival delay at the exact guarantee boundary is free and repeated sweeps create a single breach event', () =>
  fixture(async (e, clock) => {
    let b = await booking(e, { mode: 'INSTANT' });
    b = await e.ack(staff, b.id, b.version, 45);
    b = await e.event(staff, b.id, b.version, 'EN_ROUTE');
    clock.now = b.arrival!.promisedAt + 15 * minute;
    await e.run(async () => {});
    await e.run(async () => {});
    const breaches = await e.repo.transaction((tx) => tx.list('arrivalBreaches'));
    assert.equal(breaches.length, 1);
    const cancelled = await e.cancel(customer, b.id, b.version);
    assert.equal(cancelled.capturedAmount, 0);
    assert.equal(cancelled.cancelReason, 'PROVIDER_ARRIVAL_DELAY');
  }));
test('a revised estimate never extends the original arrival promise or guarantee', () =>
  fixture(async (e, clock) => {
    let b = await booking(e, { mode: 'INSTANT' });
    b = await e.ack(staff, b.id, b.version, 45);
    const promised = b.arrival!.promisedAt;
    b = await e.fulfillment.delay(staff, b.id, {
      version: b.version,
      minutes: 90,
      reason: 'TRAFFIC',
    });
    assert.equal(b.arrival?.promisedAt, promised);
    assert.equal(b.arrival?.revisedAt, clock.now + 90 * minute);
    clock.now = promised + 15 * minute;
    const cancelled = await e.cancel(customer, b.id, b.version);
    assert.equal(cancelled.capturedAmount, 0);
    assert.equal(cancelled.cancelReason, 'PROVIDER_ARRIVAL_DELAY');
  }));
test('the minute immediately before the breach still uses the agreed travel fee after departure', () =>
  fixture(async (e, clock) => {
    let b = await booking(e, { mode: 'INSTANT' });
    b = await e.ack(staff, b.id, b.version, 45);
    b = await e.event(staff, b.id, b.version, 'EN_ROUTE');
    clock.now = b.arrival!.promisedAt + 15 * minute - 1;
    const cancelled = await e.cancel(customer, b.id, b.version);
    assert.equal(cancelled.capturedAmount, b.quote.transportFee);
  }));
test('arrival ends the late-arrival cancellation exception and staff cannot report another delay after arrival', () =>
  fixture(async (e, clock) => {
    let b = await booking(e, { mode: 'INSTANT' });
    b = await e.ack(staff, b.id, b.version, 45);
    b = await e.event(staff, b.id, b.version, 'EN_ROUTE');
    b = await e.event(staff, b.id, b.version, 'ARRIVED');
    clock.now = b.arrival!.promisedAt + 16 * minute;
    const cancelled = await e.cancel(customer, b.id, b.version);
    assert.equal(cancelled.capturedAmount, b.quote.transportFee);
    await assert.rejects(
      () =>
        e.fulfillment.delay(staff, b.id, {
          version: cancelled.version,
          minutes: 90,
          reason: 'TRAFFIC',
        }),
      fail('INVALID_STATE'),
    );
  }));
test('legacy orders preserve their original cancellation snapshot without receiving new charges or promises', () =>
  fixture(async (e) => {
    let b = await booking(e, { mode: 'INSTANT' });
    await e.repo.transaction(async (tx) => {
      const original = await tx.get<Booking>('bookings', b.id);
      const {
        instantTravelOnly: _i,
        instantDelayGraceMinutes: _g,
        ...policy
      } = original!.quote.cancellationPolicy;
      await tx.put('bookings', {
        ...original!,
        quote: { ...original!.quote, cancellationPolicy: { ...policy, version: 'legacy-policy' } },
      });
    });
    b = await current(e, b.id);
    const cancelled = await e.cancel(customer, b.id, b.version);
    assert.equal(
      cancelled.capturedAmount,
      Math.floor(
        ((b.quote.total - b.quote.transportFee) * b.quote.cancellationPolicy.lateFeeBps) / 10000,
      ),
    );
  }));
test('only assigned staff can update arrival and stale or out-of-order reports fail', () =>
  fixture(async (e) => {
    let b = await booking(e, { mode: 'INSTANT' });
    b = await e.ack(staff, b.id, b.version, 45);
    for (const actor of [customer, shop, { ...staff, staffId: 'staff-ren' }])
      await assert.rejects(
        () =>
          e.fulfillment.delay(actor, b.id, { version: b.version, minutes: 90, reason: 'TRAFFIC' }),
        fail('NOT_FOUND'),
      );
    await assert.rejects(
      () =>
        e.fulfillment.delay(staff, b.id, {
          version: b.version - 1,
          minutes: 90,
          reason: 'TRAFFIC',
        }),
      fail('VERSION_CONFLICT'),
    );
    await assert.rejects(
      () => e.fulfillment.delay(staff, b.id, { version: b.version, minutes: 5, reason: 'TRAFFIC' }),
      fail('INVALID_ARRIVAL_ESTIMATE'),
    );
  }));
test('customers use support instead of unilateral ordinary cancellation after the service begins', () =>
  fixture(async (e, clock) => {
    const b = await start(e, clock);
    await assert.rejects(() => e.cancel(customer, b.id, b.version), fail('SERVICE_IN_PROGRESS'));
    assert.equal((await current(e, b.id)).status, 'IN_SERVICE');
  }));
test('overdue service requests a private check-in at plus 15 and escalates at plus 20 exactly once', () =>
  fixture(async (e, clock) => {
    const b = await start(e, clock);
    clock.now = b.quote.endAt + 15 * minute - 1;
    assert.equal((await e.fulfillment.desk(staff)).checks.length, 0);
    clock.now++;
    let desk = await e.fulfillment.desk(staff);
    assert.equal(desk.checks[0].status, 'WAITING');
    assert.equal(desk.events.length, 0);
    clock.now += 5 * minute - 1;
    assert.equal((await e.fulfillment.desk(staff)).checks[0].status, 'WAITING');
    clock.now++;
    desk = await e.fulfillment.desk(shop);
    assert.equal(desk.checks[0].status, 'ESCALATED');
    assert.equal(desk.events[0].type, 'MISSED_CHECK_IN');
    await e.fulfillment.desk(shop);
    assert.equal((await e.repo.transaction((tx) => tx.list<SafetyEvent>('safety'))).length, 1);
    assert.equal((await current(e, b.id)).version, b.version);
    assert.equal((await current(e, b.id)).paymentStatus, b.paymentStatus);
  }));
test('a safe reply postpones the next check but does not permanently disable monitoring', () =>
  fixture(async (e, clock) => {
    const b = await start(e, clock);
    clock.now = b.quote.endAt + 15 * minute;
    let c = (await e.fulfillment.desk(staff)).checks[0];
    await e.fulfillment.respond(staff, b.id, { version: c.version, action: 'SAFE' });
    clock.now += 15 * minute - 1;
    assert.equal((await e.fulfillment.desk(staff)).checks[0].status, 'SAFE');
    clock.now++;
    c = (await e.fulfillment.desk(staff)).checks[0];
    assert.equal(c.status, 'WAITING');
    assert.equal(c.round, 2);
    assert.equal((await e.fulfillment.desk(shop)).events.length, 0);
  }));
test('requesting help escalates immediately, and late safe replies do not silently close the incident', () =>
  fixture(async (e, clock) => {
    const b = await start(e, clock);
    clock.now = b.quote.endAt + 15 * minute;
    let c = (await e.fulfillment.desk(staff)).checks[0];
    await e.fulfillment.respond(staff, b.id, { version: c.version, action: 'NEED_HELP' });
    let d = await e.fulfillment.desk(staff);
    assert.equal(d.events[0].type, 'SOS');
    c = d.checks[0];
    await e.fulfillment.respond(staff, b.id, { version: c.version, action: 'SAFE' });
    d = await e.fulfillment.desk(shop);
    assert.equal(d.checks[0].status, 'ESCALATED');
    assert(d.checks[0].safeAt);
    assert.equal(d.events[0].status, 'OPEN');
  }));
test('shop contact is scoped and private, and resolution stays with authorized platform staff', () =>
  fixture(async (e, clock) => {
    const b = await start(e, clock);
    clock.now = b.quote.endAt + 20 * minute;
    let d = await e.fulfillment.desk(shop);
    const c = d.checks[0];
    await assert.rejects(
      () =>
        e.fulfillment.contact({ ...shop, storeId: 'store-mori' }, b.id, {
          version: c.version,
          note: reason,
        }),
      fail('NOT_FOUND'),
    );
    const note = 'Private shop emergency contact outcome for the safety team.';
    await e.fulfillment.contact(shop, b.id, { version: c.version, note });
    assert.equal((await e.fulfillment.desk(staff)).checks[0].merchantContact?.note, undefined);
    assert.equal((await e.fulfillment.desk(admin)).checks[0].merchantContact?.note, note);
    await assert.rejects(() => e.fulfillment.desk(customer), fail('FORBIDDEN'));
    await assert.rejects(
      () => e.fulfillment.desk({ ...admin, id: 'system', adminRole: 'SUPPORT' }),
      fail('FORBIDDEN'),
    );
    const ev = d.events[0];
    await e.care.resolveSafety(admin, ev.id, ev.version!, reason);
    d = await e.fulfillment.desk(shop);
    assert.equal(d.events.length, 0);
    assert.equal(d.checks[0].status, 'SAFE');
    for (const kind of ['audit', 'outbox'])
      assert(!JSON.stringify(await e.repo.transaction((tx) => tx.list(kind))).includes(note));
  }));
test('completion closes an outstanding prompt but leaves escalated safety cases available for investigation', () =>
  fixture(async (e, clock) => {
    const b = await start(e, clock);
    clock.now = b.quote.endAt + 20 * minute;
    await e.fulfillment.desk(staff);
    await e.event(staff, b.id, b.version, 'COMPLETE');
    const d = await e.fulfillment.desk(shop);
    assert.equal(d.checks[0].status, 'ESCALATED');
    assert.equal(d.events.length, 1);
    await e.care.resolveSafety(admin, d.events[0].id, d.events[0].version!, reason);
    assert.equal((await e.fulfillment.desk(shop)).checks.length, 0);
  }));
test('ended membership and other staff cannot answer private safety prompts', () =>
  fixture(async (e, clock) => {
    const b = await start(e, clock);
    clock.now = b.quote.endAt + 15 * minute;
    const c = (await e.fulfillment.desk(staff)).checks[0];
    await assert.rejects(
      () =>
        e.fulfillment.respond({ ...staff, staffId: 'staff-ren' }, b.id, {
          version: c.version,
          action: 'SAFE',
        }),
      fail('NOT_FOUND'),
    );
    await e.repo.transaction(async (tx) => {
      const l = await tx.get<import('@hogulink/contracts').Listing>('listings', 'listing-aoi');
      await tx.put('listings', { ...l!, membershipActive: false });
    });
    assert.equal((await e.fulfillment.desk(staff)).checks.length, 0);
    await assert.rejects(
      () => e.fulfillment.respond(staff, b.id, { version: c.version, action: 'SAFE' }),
      fail('NOT_FOUND'),
    );
  }));
