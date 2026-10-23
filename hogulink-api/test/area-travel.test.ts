import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  storeBookingRulesInput,
  travelFeeFor,
  type Actor,
  type Booking,
  type BookingRulesHistory,
  type Listing,
  type Offering,
  type Store,
} from '@hogulink/contracts';
import { Engine } from '../src/engine.js';
import { Repository } from '../src/repository.js';
import { seed } from '../src/seed.js';
import { DomainError } from '../src/errors.js';
import { mobileTherapists } from '../src/mobile.js';
import { registerClock, finishVisit } from './helpers/visit-fixture.js';

const owner: Actor = {
  id: 'at-owner',
  role: 'MERCHANT',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const moriOwner: Actor = {
  id: 'at-mori',
  role: 'MERCHANT',
  storeId: 'store-mori',
  verificationLevel: 1,
};
const customer: Actor = { id: 'at-customer', role: 'CUSTOMER', verificationLevel: 1 };
const worker: Actor = {
  id: 'aoi',
  role: 'STAFF',
  staffId: 'staff-aoi',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
// 2026-10-19 09:00 JST; noon JST is a bookable scheduled start.
const start = Date.UTC(2026, 9, 19, 0);
const noon = Date.UTC(2026, 9, 19, 3);
const table = { minato: 1500, shinjuku: 0 };
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
async function setTravel(e: Engine, fees?: unknown, actor = owner) {
  const current = (await rules(e, actor.storeId))?.version ?? 0;
  return e.merchant.bookingRules(actor, {
    version: current,
    nominationFee: 500,
    templateId: 'FLEXIBLE_2H',
    ...(fees === undefined ? {} : { areaTransportFees: fees }),
  });
}
const quote = (e: Engine, area: string, offeringId = 'store-nagi-60', startAt = noon) =>
  e.quote(customer, {
    listingId: 'listing-aoi',
    offeringId,
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt,
    area,
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
        name: 'Area Guest',
        area: q.area,
        type: 'HOTEL',
        detail: 'Hotel lobby 2',
        hotelName: 'Area Hotel',
        room: '702',
        hotelPermission: true,
      },
    },
    randomUUID(),
  );
}
async function addFreeMenu(e: Engine) {
  await e.repo.transaction(async (tx) => {
    const paid = (await tx.get<Offering>('offerings', 'store-nagi-60'))!;
    await tx.put('offerings', { ...paid, id: 'nagi-free-60', price: 7600, transportFee: 0 });
    const aoi = (await tx.get<Listing>('listings', 'listing-aoi'))!;
    await tx.put('listings', { ...aoi, offeringIds: [...aoi.offeringIds, 'nagi-free-60'] });
  });
}

test('a listed area replaces the menu travel fee; other areas and free menus keep their own', () => {
  const r = { areaTransportFees: table };
  assert.equal(travelFeeFor({ transportFee: 1000 }, r, 'minato'), 1500);
  assert.equal(travelFeeFor({ transportFee: 1000 }, r, 'shinjuku'), 0);
  assert.equal(travelFeeFor({ transportFee: 1000 }, r, 'taito'), 1000, 'unlisted area');
  assert.equal(travelFeeFor({ transportFee: 1000 }, r), 1000, 'no area chosen');
  assert.equal(travelFeeFor({ transportFee: 0 }, r, 'minato'), 0, 'a free menu stays free');
  assert.equal(travelFeeFor({ transportFee: 1000 }, undefined, 'minato'), 1000);
  const ok = (areaTransportFees: unknown) =>
    storeBookingRulesInput.safeParse({
      version: 0,
      nominationFee: 500,
      templateId: 'FLEXIBLE_2H',
      areaTransportFees,
    }).success;
  assert.equal(ok(table), true);
  assert.equal(ok({}), true);
  assert.equal(ok({ minato: -1 }), false);
  assert.equal(ok({ minato: 20001 }), false);
  assert.equal(ok({ minato: 1500.5 }), false);
  assert.equal(ok({ 'Minato Ku': 1500 }), false);
});

test('the area table is a versioned shop rule: own areas only, omission keeps it, {} removes it', () =>
  fixture(async (e) => {
    const saved = await setTravel(e, table);
    assert.deepEqual(saved.areaTransportFees, { minato: 1500, shinjuku: 0 });
    assert.equal((await setTravel(e, { shinjuku: 0, minato: 1500 })).version, saved.version);
    const kept = await setTravel(e, undefined);
    assert.equal(kept.version, saved.version, 'nothing else changed');
    assert.deepEqual(kept.areaTransportFees, table);
    const removed = await setTravel(e, {});
    assert.equal(removed.areaTransportFees, undefined);
    const history = (
      await e.repo.transaction((tx) => tx.list<BookingRulesHistory>('bookingRulesHistory'))
    )
      .filter((h) => h.storeId === 'store-nagi')
      .sort((a, b) => a.version - b.version);
    assert.deepEqual(
      history.map((h) => h.areaTransportFees ?? {}),
      [{ minato: 1500, shinjuku: 0 }, {}],
    );
    // Mori does not serve Minato and cannot price it.
    await assert.rejects(setTravel(e, { minato: 800 }, moriOwner), code('INVALID_AREA'));
    assert.deepEqual((await setTravel(e, { chuo: 800 }, moriOwner)).areaTransportFees, {
      chuo: 800,
    });
    const store = (await e.publicCatalog()).stores.find((s) => s.id === 'store-mori')!;
    assert.deepEqual(store.bookingRules?.areaTransportFees, { chuo: 800 });
  }));

test('quotes use the area fee, the order freezes it and later changes need a new quote', () =>
  fixture(async (e) => {
    await setTravel(e, table);
    const minato = await quote(e, 'minato');
    assert.equal(minato.transportFee, 1500);
    assert.equal(minato.total, minato.serviceFee + minato.nominationFee + 1500);
    assert.equal((await quote(e, 'shinjuku')).transportFee, 0);
    assert.equal((await quote(e, 'taito')).transportFee, 1000, 'unlisted area uses the menu fee');

    // Before this change every area-priced order failed the booking re-check.
    const b = await order(e, minato);
    assert.equal(b.quote.transportFee, 1500);

    const stale = await quote(e, 'minato', 'store-nagi-60', noon + 3 * 3_600_000);
    await setTravel(e, { minato: 2000 });
    await assert.rejects(order(e, stale), code('SHOP_RULES_CHANGED'));

    // The placed order keeps its fee through capture.
    const confirmed = await e.ack(worker, b.id, b.version);
    const done = await finishVisit(e, confirmed, worker, customer);
    assert.equal(done.capturedAmount, minato.total);
    assert.equal(done.quote.transportFee, 1500);
  }));

test('free-travel menus stay free in every area', () =>
  fixture(async (e) => {
    await addFreeMenu(e);
    await setTravel(e, table);
    const q = await quote(e, 'minato', 'nagi-free-60');
    assert.equal(q.transportFee, 0);
    assert.equal((await order(e, q)).quote.transportFee, 0);
  }));

test('the H5 directory prices the chosen area and its free-travel filter follows the table', () =>
  fixture(async (e) => {
    await setTravel(e, table);
    const minato = await mobileTherapists(e, { area: 'minato', duration: '60', search: 'Nagi' });
    const aoi = minato.items.find((row) => row.listing.id === 'listing-aoi')!;
    assert.equal(aoi.transportFee, 1500);
    assert.equal(aoi.badges.freeTravel, false);
    const q = await e.quote(customer, {
      listingId: 'listing-aoi',
      offeringId: aoi.offering.id,
      bookingMode: 'SCHEDULED',
      nominationType: 'NOMINATED',
      startAt: aoi.earliestAt!,
      area: 'minato',
      requiredLanguage: '',
    });
    assert.equal(q.total, aoi.total);

    const shinjuku = await mobileTherapists(e, {
      area: 'shinjuku',
      duration: '60',
      travel: 'free',
      search: 'Nagi',
    });
    assert.ok(shinjuku.items.some((row) => row.listing.id === 'listing-aoi'));
    assert.ok(shinjuku.items.every((row) => row.transportFee === 0 && row.badges.freeTravel));
    // No area chosen: the menu's own fee, and a ¥1,000 menu is not "free travel".
    const any = await mobileTherapists(e, { duration: '60', travel: 'free', search: 'Nagi' });
    assert.equal(any.total, 0);
  }));

test('rebooking reports a price change when the area fee for the old area changed', () =>
  fixture(async (e) => {
    await setTravel(e, table);
    const b = await order(e, await quote(e, 'minato'));
    const cancelled: Booking = await e.cancel(customer, b.id, b.version);
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal((await e.experience.rebook(customer, b.id)).priceChanged, false);
    await setTravel(e, { minato: 1800, shinjuku: 0 });
    assert.equal((await e.experience.rebook(customer, b.id)).priceChanged, true);
  }));
