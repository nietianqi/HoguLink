import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  comparisonEligibility,
  mergePromotionWindows,
  effectiveServicePrice,
  type Actor,
  type ExperienceReview,
  type Offering,
} from '@hogulink/contracts';
import { Engine } from '../src/engine.js';
import { Repository } from '../src/repository.js';
import { seed } from '../src/seed.js';
import { DomainError } from '../src/errors.js';
import { mobileTherapists, listingStats } from '../src/mobile.js';
import { advanceClock, registerClock, finishVisit } from './helpers/visit-fixture.js';
import { closedPromotionHistory } from '../src/promotion-history.js';

const owner: Actor = {
  id: 'promo-owner',
  role: 'MERCHANT',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const customer: Actor = { id: 'promo-customer', role: 'CUSTOMER', verificationLevel: 1 };
const worker: Actor = {
  id: 'aoi',
  role: 'STAFF',
  staffId: 'staff-aoi',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const minute = 60_000,
  day = 86_400_000;
const code = (name: string) => (error: unknown) =>
  error instanceof DomainError && error.code === name;

async function fixture(fn: (e: Engine) => Promise<void>) {
  const repo = new Repository('', ':memory:');
  await repo.init();
  await seed(repo);
  const clock = { now: Date.UTC(2026, 9, 19, 0) };
  const e = new Engine(repo, () => clock.now);
  registerClock(e, (at) => {
    clock.now = at;
  });
  // Pin the regular-price history to the injected clock so results never depend on wall time.
  await repo.transaction(async (tx) => {
    for (const o of await tx.list<Offering>('offerings'))
      await tx.put('offerings', { ...o, priceSince: clock.now - 60 * day });
  });
  try {
    await fn(e);
  } finally {
    await repo.close();
  }
}
const service = (e: Engine, id = 'store-nagi-60') =>
  e.repo.transaction((tx) => tx.get<Offering>('offerings', id)) as Promise<Offering>;
async function promote(
  e: Engine,
  extra: Partial<{ price: number; startsAt: number; endsAt: number }> = {},
  id = 'store-nagi-60',
  actor = owner,
) {
  const o = await service(e, id);
  return e.merchant.promotion(actor, id, {
    version: o.version,
    price: 5800,
    startsAt: e.now(),
    endsAt: e.now() + 7 * day,
    ...extra,
  });
}
async function quote(e: Engine, startIn = 180) {
  return e.quote(customer, {
    listingId: 'listing-aoi',
    offeringId: 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt: e.now() + startIn * minute,
    area: 'shinjuku',
    requiredLanguage: '',
  });
}
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
        name: 'Promo Guest',
        area: 'shinjuku',
        type: 'HOTEL',
        detail: 'Promo address 1',
        hotelName: 'Promo Hotel',
        room: '301',
        hotelPermission: true,
      },
    },
    randomUUID(),
  );
}

test('promotion input is bounded: price, duration, lead time, version and tenant', () =>
  fixture(async (e) => {
    const regular = (await service(e)).price;
    await assert.rejects(promote(e, { price: regular }), code('INVALID_PROMOTION'));
    await assert.rejects(
      promote(e, { price: Math.floor(regular * 0.2) }),
      code('INVALID_PROMOTION'),
    );
    await assert.rejects(
      promote(e, { startsAt: e.now(), endsAt: e.now() + 15 * day }),
      code('INVALID_PROMOTION'),
    );
    await assert.rejects(
      promote(e, { startsAt: e.now() + 31 * day, endsAt: e.now() + 32 * day }),
      code('INVALID_PROMOTION'),
    );
    await assert.rejects(
      promote(e, {}, 'store-mori-60'),
      (err) => err instanceof DomainError && err.status === 404,
    );
    const o = await service(e);
    await assert.rejects(
      e.merchant.promotion(owner, 'store-nagi-60', {
        version: o.version + 1,
        price: 5800,
        startsAt: e.now(),
        endsAt: e.now() + day,
      }),
      code('VERSION_CONFLICT'),
    );
    const saved = await promote(e);
    assert.equal(saved.promotion?.price, 5800);
    assert.equal(saved.promotion?.regularPrice, regular);
    assert.equal(saved.version, o.version + 1);
  }));

test('struck-through comparison needs an established regular price and limited promotion days', () =>
  fixture(async (e) => {
    const first = await promote(e, { endsAt: e.now() + 14 * day });
    assert.equal(first.promotion?.comparisonAllowed, true);
    advanceClock(e, e.now() + 14 * day);
    const second = await promote(e, { endsAt: e.now() + 14 * day });
    assert.equal(second.promotion?.comparisonAllowed, true, '14 + 14 days stays within half');
    advanceClock(e, e.now() + 14 * day);
    const third = await promote(e, { endsAt: e.now() + 14 * day });
    assert.equal(third.promotion?.comparisonAllowed, false);
    assert.equal(third.promotion?.comparisonReason, 'TOO_MANY_PROMOTION_DAYS');
    // A new regular price restarts the clock and ends the running promotion.
    const repriced = await e.merchant.service(owner, 'store-nagi-60', {
      version: third.version,
      price: 7600,
      transportFee: third.transportFee,
      active: true,
    });
    assert.equal(repriced.promotion, undefined);
    assert.equal(repriced.priceSince, e.now());
    const fresh = await promote(e, { price: 6000 });
    assert.equal(fresh.promotion?.comparisonReason, 'REGULAR_PRICE_TOO_NEW');
    assert.equal(effectiveServicePrice(fresh, e.now()).comparePrice, undefined);
    assert.equal(effectiveServicePrice(fresh, e.now()).price, 6000);
  }));

test('comparison eligibility helper', () => {
  const now = Date.UTC(2026, 9, 19);
  const window = { startsAt: now, endsAt: now + 7 * day };
  assert.equal(comparisonEligibility(window, undefined, []), 'REGULAR_PRICE_TOO_NEW');
  assert.equal(comparisonEligibility(window, now - 27 * day, []), 'REGULAR_PRICE_TOO_NEW');
  assert.equal(comparisonEligibility(window, now - 28 * day, []), 'ELIGIBLE');
  assert.equal(
    comparisonEligibility(window, now - 90 * day, [
      { startsAt: now - 30 * day, endsAt: now - 8 * day },
    ]),
    'TOO_MANY_PROMOTION_DAYS',
  );
});

test('editing a promotion repeatedly cannot erase earlier discount days', () =>
  fixture(async (e) => {
    await promote(e, { endsAt: e.now() + 14 * day });
    advanceClock(e, e.now() + 14 * day);
    await promote(e, { endsAt: e.now() + 14 * day });
    advanceClock(e, e.now() + 14 * day);
    for (let i = 0; i < 15; i++) {
      const saved = await promote(e, { endsAt: e.now() + 2 * 3600000 });
      assert.equal(saved.promotion?.comparisonReason, 'TOO_MANY_PROMOTION_DAYS');
      advanceClock(e, e.now() + minute);
    }
  }));

test('overlapping history counts the discounted time once', () => {
  const now = Date.UTC(2026, 9, 19);
  const previous = { startsAt: now - 14 * day, endsAt: now };
  assert.equal(
    comparisonEligibility({ startsAt: now, endsAt: now + 7 * day }, now - 60 * day, [
      previous,
      previous,
    ]),
    'ELIGIBLE',
  );
});

test('one-hour promotion is accepted and a shorter one is rejected', () =>
  fixture(async (e) => {
    await assert.rejects(promote(e, { endsAt: e.now() + 3600000 - 1 }), code('INVALID_PROMOTION'));
    assert.ok((await promote(e, { endsAt: e.now() + 3600000 })).promotion);
  }));

test('listing stats use a read-only aggregate without loading full records', () =>
  fixture(async (e) => {
    e.repo.transaction = async () => {
      throw new Error('Stats must not open a write transaction');
    };
    const read = e.repo.read.bind(e.repo);
    e.repo.read = (fn) =>
      read((tx) =>
        fn(
          new Proxy(tx, {
            get(target, key) {
              if (key === 'find' || key === 'list')
                return () => {
                  throw new Error('Stats must aggregate in the database');
                };
              return Reflect.get(target, key);
            },
          }),
        ),
      );
    assert.deepEqual(await listingStats(e, ['listing-aoi']), {
      'listing-aoi': { rating: null, reviewCount: 0, completed90d: 0, favorites: 0 },
    });
  }));

test('history retains every relevant disjoint window and clips only elapsed time', () => {
  const now = Date.UTC(2026, 9, 19);
  const windows = Array.from({ length: 30 }, (_, i) => ({
    startsAt: now - (i + 1) * day,
    endsAt: now - (i + 1) * day + minute,
  }));
  const service = {
    promotionHistory: [...windows, { startsAt: now - 130 * day, endsAt: now - 129 * day }],
    promotion: { startsAt: now - minute, endsAt: now + day },
  } as Offering;
  const result = closedPromotionHistory(service, now);
  assert.equal(result.length, 31);
  assert.equal(result.at(-1)?.endsAt, now);
  assert.equal(service.promotionHistory?.length, 31, 'does not mutate persisted history');
  assert.deepEqual(
    mergePromotionWindows(
      [
        { startsAt: 0, endsAt: 10 },
        { startsAt: 10, endsAt: 20 },
        { startsAt: NaN, endsAt: 100 },
        { startsAt: 9, endsAt: 3 },
      ],
      5,
      15,
    ),
    [{ startsAt: 5, endsAt: 15 }],
  );
});

test('database stats count only published reviews, assigned completions within 90 days, and active favorites', () =>
  fixture(async (e) => {
    const since = e.now() - 90 * day;
    await e.repo.transaction(async (tx) => {
      for (let i = 0; i < 1000; i++)
        await tx.put('experienceReviews', {
          id: `foreign-${i}`,
          listingId: 'listing-ren',
          status: 'APPROVED',
          scores: { overall: 1 },
        });
      for (const [id, status, score] of [
        ['one', 'APPROVED', 4],
        ['two', 'APPROVED', 5],
        ['three', 'PENDING', 1],
        ['four', 'REJECTED', 1],
      ] as const)
        await tx.put('experienceReviews', {
          id,
          listingId: 'listing-aoi',
          status,
          scores: { overall: score },
        });
      for (const [id, status, completedAt] of [
        ['boundary', 'COMPLETED', since],
        ['old-updated-recently', 'COMPLETED', since - 1],
        ['pending', 'CONFIRMED', e.now()],
      ] as const)
        await tx.put('bookings', {
          id,
          status,
          assignedListingId: 'listing-aoi',
          updatedAt: e.now(),
          completedAt,
        });
      await tx.put('bookings', {
        id: 'legacy',
        status: 'COMPLETED',
        assignedListingId: 'listing-aoi',
        updatedAt: since,
      });
      await tx.put('bookings', {
        id: 'reassigned',
        status: 'COMPLETED',
        selectedStaffListingId: 'listing-aoi',
        assignedListingId: 'listing-ren',
        updatedAt: e.now(),
        completedAt: e.now(),
      });
      await tx.put('favorites', { id: 'active', listingId: 'listing-aoi', active: true });
      await tx.put('favorites', { id: 'removed', listingId: 'listing-aoi', active: false });
    });
    assert.deepEqual(await listingStats(e, ['listing-aoi', 'missing', 'listing-aoi']), {
      'listing-aoi': { rating: 4.5, reviewCount: 2, completed90d: 2, favorites: 1 },
      missing: { rating: null, reviewCount: 0, completed90d: 0, favorites: 0 },
    });
    assert.deepEqual(await listingStats(e, []), {});
  }));

test('quotes and orders use the promotion price; the regular price is kept on the quote', () =>
  fixture(async (e) => {
    const regular = (await service(e)).price;
    await promote(e);
    const q = await quote(e);
    assert.equal(q.serviceFee, 5800);
    assert.equal(q.regularServiceFee, regular);
    assert.ok(q.promotionId);
    assert.equal(q.total, 5800 + q.nominationFee + q.transportFee);
    const b = await order(e, q);
    assert.equal(b.quote.total, q.total);
    const confirmed = await e.ack(worker, b.id, b.version);
    const done = await finishVisit(e, confirmed, worker, customer);
    assert.equal(done.capturedAmount, q.total);
  }));

test('a promotion ending during checkout keeps the quoted price; a removed one does not', () =>
  fixture(async (e) => {
    await promote(e, { endsAt: e.now() + 2 * 3600_000 });
    advanceClock(e, e.now() + 2 * 3600_000 - 5 * minute);
    const q = await quote(e);
    assert.equal(q.serviceFee, 5800);
    advanceClock(e, e.now() + 6 * minute);
    const b = await order(e, q);
    assert.equal(b.quote.serviceFee, 5800);
    const later = await quote(e, 300);
    assert.equal(later.serviceFee, (await service(e)).price, 'promotion over for new quotes');

    await promote(e, { endsAt: e.now() + day });
    const stale = await quote(e, 420);
    const o = await service(e);
    await e.merchant.clearPromotion(owner, 'store-nagi-60', { version: o.version });
    await assert.rejects(order(e, stale), code('PRICE_CHANGED'));
  }));

test('public catalog exposes the live promotion but not price history', () =>
  fixture(async (e) => {
    await promote(e);
    const o = (await e.publicCatalog()).offerings.find((x) => x.id === 'store-nagi-60')!;
    assert.equal(o.promotion?.price, 5800);
    assert.equal(o.priceSince, undefined);
    assert.equal(o.promotionHistory, undefined);
  }));

test('H5 directory shows promotion totals, comparison only when allowed, and real stats', () =>
  fixture(async (e) => {
    await promote(e);
    const page = await mobileTherapists(e, { duration: '60' });
    const aoi = page.items.find((x) => x.listing.id === 'listing-aoi')!;
    const regular = (await service(e)).price;
    assert.equal(aoi.total, 5800 + aoi.offering.transportFee + aoi.nominationFee);
    assert.equal(aoi.compareTotal, regular + aoi.offering.transportFee + aoi.nominationFee);
    assert.ok(aoi.promotionEndsAt);
    assert.deepEqual(aoi.stats, { rating: null, reviewCount: 0, completed90d: 0, favorites: 0 });
    assert.equal(aoi.badges.freeTravel, aoi.offering.transportFee === 0);

    // One real completed visit, one approved review and one favorite.
    const b = await order(e, await quote(e));
    await finishVisit(e, await e.ack(worker, b.id, b.version), worker, customer);
    await e.repo.transaction(async (tx) => {
      await tx.put<ExperienceReview>('experienceReviews', {
        id: 'review-promo-1',
        bookingId: b.id,
        customerId: customer.id,
        merchantId: b.merchantId,
        storeId: b.storeId,
        listingId: 'listing-aoi',
        staffId: 'staff-aoi',
        serviceName: b.quote.serviceName!,
        scores: { punctuality: 5, communication: 4, explanation: 5, cleanliness: 5, overall: 4 },
        text: 'Calm and clear.',
        status: 'APPROVED',
        version: 1,
        revision: 1,
        createdAt: e.now(),
        updatedAt: e.now(),
        publishedAt: e.now(),
      });
      await tx.put('experienceReviews', {
        id: 'review-promo-2',
        listingId: 'listing-aoi',
        status: 'PENDING',
        scores: { overall: 1 },
      });
      await tx.put('favorites', {
        id: 'fav-promo-1',
        customerId: customer.id,
        listingId: 'listing-aoi',
        active: true,
        createdAt: e.now(),
        updatedAt: e.now(),
      });
    });
    const stats = await listingStats(e, ['listing-aoi', 'listing-ren']);
    assert.deepEqual(stats['listing-aoi'], {
      rating: 4,
      reviewCount: 1,
      completed90d: 1,
      favorites: 1,
    });
    assert.equal(stats['listing-ren'].reviewCount, 0);
    advanceClock(e, e.now() + 91 * day);
    assert.equal((await listingStats(e, ['listing-aoi']))['listing-aoi'].completed90d, 0);

    const rated = await mobileTherapists(e, { duration: '60', sort: 'rating' });
    assert.equal(rated.items[0].listing.id, 'listing-aoi');
  }));

test('distance sorting uses only the coarse nearest area and requires it', () =>
  fixture(async (e) => {
    await assert.rejects(mobileTherapists(e, { sort: 'distance' }), code('LOCATION_REQUIRED'));
    const near = await mobileTherapists(e, { sort: 'distance', near: 'taito' });
    const covers = (areas: string[]) => areas.includes('taito');
    const firstNonCovering = near.items.findIndex((x) => !covers(x.store.areas));
    const lastCovering = near.items.map((x) => covers(x.store.areas)).lastIndexOf(true);
    assert.ok(firstNonCovering === -1 || lastCovering < firstNonCovering);
    await assert.rejects(
      mobileTherapists(e, { near: '35.7,139.7' }),
      (err: unknown) => err instanceof Error,
    );
  }));
