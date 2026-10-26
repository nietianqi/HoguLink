import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  storeBookingRulesInput,
  surchargeBandsOverlap,
  timeSurchargeAt,
  type Actor,
  type BookingRulesHistory,
  type Offering,
  type Store,
} from '@hogulink/contracts';
import { Engine } from '../src/engine.js';
import { Repository } from '../src/repository.js';
import { seed } from '../src/seed.js';
import { DomainError } from '../src/errors.js';
import { mobileTherapists } from '../src/mobile.js';
import { advanceClock, registerClock, finishVisit } from './helpers/visit-fixture.js';

const owner: Actor = {
  id: 'ts-owner',
  role: 'MERCHANT',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const otherOwner: Actor = {
  id: 'ts-other',
  role: 'MERCHANT',
  storeId: 'store-mori',
  verificationLevel: 1,
};
const customer: Actor = { id: 'ts-customer', role: 'CUSTOMER', verificationLevel: 1 };
const worker: Actor = {
  id: 'aoi',
  role: 'STAFF',
  staffId: 'staff-aoi',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const minute = 60_000;
// 2026-10-19 09:00 JST.
const start = Date.UTC(2026, 9, 19, 0);
/** Absolute time for an hour:minute in JST on the fixture day. */
const jst = (h: number, m = 0) => Date.UTC(2026, 9, 19, h - 9, m);
const evening = { startMinute: 20 * 60, endMinute: 6 * 60, amount: 1500 };
const code = (name: string) => (error: unknown) =>
  error instanceof DomainError && error.code === name;

async function fixture(fn: (e: Engine) => Promise<void>) {
  const repo = new Repository('', ':memory:');
  await repo.init();
  await seed(repo);
  const clock = { now: start };
  const e = new Engine(repo, () => clock.now);
  registerClock(e, (at) => {
    clock.now = at;
  });
  try {
    await fn(e);
  } finally {
    await repo.close();
  }
}
const rules = async (e: Engine, storeId = 'store-nagi') =>
  (await e.repo.transaction((tx) => tx.get<Store>('stores', storeId)))!.bookingRules;
async function setBands(e: Engine, bands?: unknown, actor = owner, nominationFee = 500) {
  const current = (await rules(e, actor.storeId))?.version ?? 0;
  return e.merchant.bookingRules(actor, {
    version: current,
    nominationFee,
    templateId: 'FLEXIBLE_2H',
    ...(bands === undefined ? {} : { timeSurcharges: bands }),
  });
}
const quote = (e: Engine, startAt: number) =>
  e.quote(customer, {
    listingId: 'listing-aoi',
    offeringId: 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt,
    area: 'shinjuku',
    requiredLanguage: '',
  });
async function order(e: Engine, q: Awaited<ReturnType<typeof quote>>) {
  const h = await e.hold(customer, q.id),
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
        name: 'Night Guest',
        area: 'shinjuku',
        type: 'HOTEL',
        detail: 'Hotel lobby 1',
        hotelName: 'Shinjuku Hotel',
        room: '1201',
        hotelPermission: true,
      },
    },
    randomUUID(),
  );
}

test('a band is decided by the JST start only: start inclusive, end exclusive, across midnight', () => {
  const r = { timeSurcharges: [evening] };
  assert.equal(timeSurchargeAt(r, jst(20, 0)), 1500);
  assert.equal(timeSurchargeAt(r, jst(19, 59)), 0);
  assert.equal(timeSurchargeAt(r, jst(23, 45)), 1500);
  assert.equal(timeSurchargeAt(r, jst(24 + 5, 59)), 1500, '05:59 next day');
  assert.equal(timeSurchargeAt(r, jst(24 + 6, 0)), 0, '06:00 is outside');
  assert.equal(timeSurchargeAt(r, jst(12)), 0);
  assert.equal(timeSurchargeAt(undefined, jst(23)), 0);
  assert.equal(timeSurchargeAt({}, jst(23)), 0);
  const two = { timeSurcharges: [{ startMinute: 360, endMinute: 480, amount: 800 }, evening] };
  assert.equal(timeSurchargeAt(two, jst(7)), 800);
  assert.equal(timeSurchargeAt(two, jst(21)), 1500);
});

test('band input is bounded: at most two, no overlap, 15-minute steps, ¥100-¥20,000, no zero length', () => {
  const ok = (timeSurcharges: unknown) =>
    storeBookingRulesInput.safeParse({
      version: 0,
      nominationFee: 500,
      templateId: 'FLEXIBLE_2H',
      timeSurcharges,
    }).success;
  assert.equal(ok([evening]), true);
  assert.equal(ok([]), true);
  assert.equal(
    ok([evening, { startMinute: 300, endMinute: 420, amount: 500 }]),
    false,
    'overlaps 05:00',
  );
  assert.equal(ok([evening, { startMinute: 360, endMinute: 480, amount: 500 }]), true, 'touching');
  assert.equal(
    ok([
      evening,
      { startMinute: 600, endMinute: 660, amount: 500 },
      { startMinute: 700, endMinute: 760, amount: 500 },
    ]),
    false,
  );
  assert.equal(
    ok([{ startMinute: 1310, endMinute: 360, amount: 1500 }]),
    false,
    'not a 15-minute step',
  );
  assert.equal(ok([{ startMinute: 1320, endMinute: 1320, amount: 1500 }]), false);
  assert.equal(ok([{ startMinute: 1320, endMinute: 360, amount: 99 }]), false);
  assert.equal(ok([{ startMinute: 1320, endMinute: 360, amount: 20001 }]), false);
  assert.equal(ok([{ startMinute: 1320, endMinute: 360, amount: 1500.5 }]), false);
  assert.equal(surchargeBandsOverlap(evening, { startMinute: 0, endMinute: 60, amount: 1 }), true);
  assert.equal(
    surchargeBandsOverlap(evening, { startMinute: 600, endMinute: 1200, amount: 1 }),
    false,
  );
});

test('bands are versioned shop rules: history kept, omission keeps them, an empty list removes them', () =>
  fixture(async (e) => {
    const saved = await setBands(e, [evening]);
    assert.deepEqual(saved.timeSurcharges, [evening]);
    const version = saved.version;
    // Same content is not a new version.
    assert.equal((await setBands(e, [evening])).version, version);
    // An older client that does not send bands cannot erase them.
    const kept = await setBands(e, undefined, owner, 800);
    assert.equal(kept.version, version + 1);
    assert.deepEqual(kept.timeSurcharges, [evening]);
    const removed = await setBands(e, [], owner, 800);
    assert.equal(removed.timeSurcharges, undefined);
    const history = await e.repo.transaction((tx) =>
      tx.list<BookingRulesHistory>('bookingRulesHistory'),
    );
    assert.deepEqual(
      history
        .filter((h) => h.storeId === 'store-nagi')
        .sort((a, b) => a.version - b.version)
        .map((h) => h.timeSurcharges ?? []),
      [[evening], [evening], []],
    );
    // Another shop is untouched and cannot be changed by this owner.
    assert.equal((await rules(e, 'store-mori'))?.timeSurcharges, undefined);
    await setBands(e, [evening], otherOwner);
    assert.deepEqual((await rules(e, 'store-mori'))?.timeSurcharges, [evening]);
    assert.equal((await rules(e))?.timeSurcharges, undefined);
  }));

test('quotes price the surcharge from the start time and keep it as its own line', () =>
  fixture(async (e) => {
    await setBands(e, [evening]);
    const day = await quote(e, jst(12));
    assert.equal(day.timeSurcharge, undefined);
    assert.equal(day.total, day.serviceFee + day.nominationFee + day.transportFee);
    const night = await quote(e, jst(20, 30));
    assert.equal(night.timeSurcharge, 1500);
    assert.equal(night.total, night.serviceFee + night.nominationFee + night.transportFee + 1500);
    // Shop-arranged visits pay the surcharge too; only the nomination fee is waived.
    const free = await e.quote(customer, {
      listingId: 'listing-aoi',
      offeringId: 'store-nagi-60',
      bookingMode: 'SCHEDULED',
      nominationType: 'FREE',
      startAt: jst(20, 30),
      area: 'shinjuku',
      requiredLanguage: '',
    });
    assert.equal(free.timeSurcharge, 1500);
    assert.equal(free.nominationFee, 0);
    // The public shop rules explain the band before checkout.
    const store = (await e.publicCatalog()).stores.find((s) => s.id === 'store-nagi')!;
    assert.deepEqual(store.bookingRules?.timeSurcharges, [evening]);
  }));

test('the order freezes the surcharge: a later band change needs a new quote, capture and fees include it', () =>
  fixture(async (e) => {
    await setBands(e, [evening]);
    const stale = await quote(e, jst(20, 30));
    await setBands(e, [{ ...evening, amount: 2500 }]);
    await assert.rejects(order(e, stale), code('SHOP_RULES_CHANGED'));

    const q = await quote(e, jst(20, 30));
    assert.equal(q.timeSurcharge, 2500);
    const b = await order(e, q);
    assert.equal(b.quote.timeSurcharge, 2500);
    // Removing the band later does not change the placed order.
    await setBands(e, []);
    const confirmed = await e.ack(worker, b.id, b.version);
    assert.equal(confirmed.quote.total, q.total);

    // A late cancellation charges on everything except travel, surcharge included.
    advanceClock(e, q.startAt - 60 * minute);
    const preview = await e.cancellationPreview(customer, b.id);
    assert.equal(preview.fee, Math.floor(((q.total - q.transportFee) * 3000) / 10000));

    const done = await finishVisit(e, confirmed, worker, customer);
    assert.equal(done.capturedAmount, q.total);
  }));

test('the H5 directory price at the shown slot equals the quote and "lowest total" sorts by that price', () =>
  fixture(async (e) => {
    // A band covering the whole bookable day makes every shown slot carry it.
    await setBands(e, [{ startMinute: 0, endMinute: 23 * 60 + 45, amount: 1200 }]);
    const page = await mobileTherapists(e, { duration: '60', sort: 'price' });
    const aoi = page.items.find((row) => row.listing.id === 'listing-aoi')!;
    assert.ok(aoi.earliestAt);
    assert.equal(aoi.timeSurcharge, 1200);
    const q = await quote(e, aoi.earliestAt!);
    assert.equal(q.total, aoi.total);
    assert.ok(
      page.items.every((row, i) => i === 0 || page.items[i - 1].total <= row.total),
      'sorted by the total the customer sees',
    );
    // Other shops without bands are unchanged.
    const mori = page.items.find((row) => row.store.id === 'store-mori');
    if (mori) assert.equal(mori.timeSurcharge, undefined);
  }));

test('an instant slot is offered only when the total with the surcharge fits the shop amount limit', () =>
  fixture(async (e) => {
    advanceClock(e, jst(20, 30));
    const offering = (await e.repo.transaction((tx) =>
      tx.get<Offering>('offerings', 'store-nagi-60'),
    ))!;
    await setBands(e, []);
    const base = offering.price + offering.transportFee + 500;
    await e.repo.transaction(async (tx) => {
      const store = (await tx.get<Store>('stores', 'store-nagi'))!;
      await tx.put('stores', {
        ...store,
        acceptanceMode: 'AUTO_PREAUTHORIZED',
        acceptanceRule: {
          active: true,
          instantEnabled: true,
          offeringIds: ['store-nagi-60'],
          listingIds: ['listing-aoi'],
          areas: ['shinjuku'],
          startHour: 0,
          endHour: 24,
          minTotal: 0,
          maxTotal: base,
          dailyLimit: 10,
          version: 1,
          authorizedBy: owner.id,
          authorizedAt: e.now(),
        },
      });
      const listing = (await tx.get<{ id: string }>('listings', 'listing-aoi'))!;
      await tx.put('listings', { ...listing, onDuty: true, dutyUpdatedAt: e.now() });
    });
    const instant = () =>
      e.availability('listing-aoi', 'store-nagi-60', false, '', 'INSTANT', 'shinjuku');
    assert.ok((await instant()).slots.length > 0, 'within the limit without a surcharge');
    await setBands(e, [evening]);
    assert.deepEqual((await instant()).slots, [], 'the surcharge pushes it over the limit');
    await assert.rejects(
      e.quote(customer, {
        listingId: 'listing-aoi',
        offeringId: 'store-nagi-60',
        bookingMode: 'INSTANT',
        nominationType: 'NOMINATED',
        startAt: e.now() + 60 * minute,
        area: 'shinjuku',
        requiredLanguage: '',
      }),
    );
    // A daytime instant visit is unaffected by the evening band.
    assert.equal(timeSurchargeAt(await rules(e), jst(12)), 0);
  }));

test('"lowest total" ranks by the surcharge-inclusive price across pages', () =>
  fixture(async (e) => {
    // Nagi charges a surcharge on every bookable start; the other shops do not.
    await setBands(e, [{ startMinute: 0, endMinute: 23 * 60 + 45, amount: 9000 }]);
    const all: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await mobileTherapists(e, {
        duration: '60',
        sort: 'price',
        limit: '2',
        ...(cursor ? { cursor } : {}),
      });
      all.push(...page.items.map((row) => row.total));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.ok(all.length > 2);
    assert.deepEqual(
      all,
      [...all].sort((a, b) => a - b),
      'ascending across every page',
    );
  }));
