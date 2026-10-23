import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readVisitHistory,
  rememberVisit,
  serviceChoices,
  featuredServices,
  featuredTherapists,
} from '../hogulink-web/src/lib/consumer-model';
import { featuredDemoOfferings, listings, offerings, stores } from '../hogulink-api/src/seed';
import type { Catalog } from '../hogulink-web/src/lib/api';
import { makeCancellationPolicy } from '@hogulink/contracts';
import { nominationFeeFor } from '../hogulink-web/src/lib/api';
import { policyText } from '../hogulink-web/src/lib/visit-i18n';
import { h5ServiceImage } from '../hogulink-web/src/lib/h5-media';
const catalog = (): Catalog =>
  structuredClone({
    listings,
    offerings,
    stores,
    demo: true,
    bookingRules: { nominationFee: 500 },
  } as Catalog);

test('home therapist recommendations select six unique eligible people across shops with their actual menu and total', () => {
  const c = catalog();
  c.listings.push({
    ...structuredClone(c.listings[0]),
    id: 'listing-extra',
    staffId: 'staff-extra',
    slug: 'extra-tokyo',
  });
  const choices = serviceChoices(c);
  assert.equal(new Set(choices.flatMap((choice) => choice.members.map((m) => m.id))).size, 7);
  const original = JSON.stringify(choices);
  const featured = featuredTherapists(choices);
  assert.equal(featured.length, 6);
  assert.equal(new Set(featured.map((r) => r.listing.id)).size, 6);
  assert.equal(new Set(featured.slice(0, 3).map((r) => r.choice.store.id)).size, 3);
  for (const { listing, choice } of featured) {
    assert.equal(listing.storeId, choice.store.id);
    assert(listing.offeringIds.includes(choice.offering.id));
    assert(choice.members.some((m) => m.id === listing.id));
    assert.equal(choice.total, choice.offering.price + choice.offering.transportFee + 500);
  }
  assert.equal(JSON.stringify(choices), original);
});

test('home therapist recommendations preserve language and instant eligibility and never fill empty places with invalid people', () => {
  const c = catalog();
  for (const filter of [{ language: 'en', area: 'taito' }, { mode: 'INSTANT' }]) {
    const featured = featuredTherapists(serviceChoices(c, filter));
    for (const { listing, choice } of featured) {
      if (filter.language) assert(listing.languages.includes(filter.language));
      if (filter.area) assert(choice.store.areas.includes(filter.area));
      if (filter.mode) {
        assert(listing.onDuty);
        assert.notEqual(choice.store.acceptanceMode, 'MANUAL');
      }
    }
  }
  assert.equal(featuredTherapists(serviceChoices(c, { language: 'en', area: 'taito' })).length, 3);
  assert.deepEqual(featuredTherapists(serviceChoices(c, { area: 'outside' })), []);
});

test('mixed-shop cards and price sorting use each shop fee, including a zero-priced nomination', () => {
  const c = catalog();
  const policy = makeCancellationPolicy('STANDARD_24H', 'public-v1');
  c.stores.find((s) => s.id === 'store-nagi')!.bookingRules = {
    version: 1,
    nominationFee: 3000,
    templateId: 'STANDARD_24H',
    cancellationPolicy: policy,
  };
  c.stores.find((s) => s.id === 'store-mori')!.bookingRules = {
    version: 1,
    nominationFee: 0,
    templateId: 'STANDARD_24H',
    cancellationPolicy: policy,
  };
  const choices = serviceChoices(c, { duration: 60, sort: 'price' });
  assert.equal(choices[0].store.id, 'store-mori');
  assert.equal(choices[0].total, 8200);
  assert.equal(choices.find((x) => x.store.id === 'store-nagi')?.total, 11200);
  assert(choices.every((x) => x.freeTotal === x.offering.price + x.offering.transportFee));
  assert.equal(
    nominationFeeFor(
      c.stores.find((s) => s.id === 'store-mori')!,
      c.bookingRules,
    ),
    0,
  );
});
test('featured menus keep three visit lengths and add six distinct authorized choices without repeating generic shop menus', () => {
  const c = catalog();
  c.offerings.push(...structuredClone(featuredDemoOfferings));
  for (const member of c.listings)
    member.offeringIds.push(
      ...featuredDemoOfferings.filter((o) => o.storeId === member.storeId).map((o) => o.id),
    );
  const choices = serviceChoices(c);
  const before = JSON.stringify(choices);
  const featured = featuredServices(choices);
  assert.equal(featured.length, 9);
  assert.deepEqual(
    featured.slice(0, 3).map((c) => c.offering.durationMinutes),
    [60, 90, 120],
  );
  assert.equal(
    new Set(featured.map((c) => `${c.offering.name.en}:${c.offering.durationMinutes}`)).size,
    9,
  );
  for (const sample of featuredDemoOfferings)
    assert(featured.some((c) => c.offering.id === sample.id));
  assert.equal(JSON.stringify(choices), before);
  assert.deepEqual(featuredServices(serviceChoices(c, { area: 'outside' })), []);
  assert(
    featuredServices(serviceChoices(c, { language: 'zh' })).every((c) =>
      c.members.every((m) => m.languages.includes('zh')),
    ),
  );
  assert.equal(
    h5ServiceImage(
      featuredDemoOfferings.find((o) => o.id === 'store-mori-leg-60')!,
      true,
    ),
    '/images/h5-service-120.png',
  );
});
test('legacy display falls back to published defaults without applying another shop configuration', () => {
  const c = catalog();
  c.bookingRules!.nominationFee = 900;
  assert.equal(
    serviceChoices(c, { duration: 60 }).find((x) => x.store.id === 'store-nagi')?.total,
    9100,
  );
});
test('tiered policy copy shows both thresholds and rates in every supported language', () => {
  const p = makeCancellationPolicy('STANDARD_24H', 'policy-v1');
  for (const locale of ['ja', 'en', 'zh-cn'] as const) {
    const text = policyText(locale, p, 'SCHEDULED');
    for (const part of ['24', '3', '30%', '50%']) assert(text.includes(part));
    assert(!text.includes('undefined'));
  }
});
test('instant copy retains its own terms and old orders still show their original single-rate snapshot', () => {
  const p = makeCancellationPolicy('STANDARD_24H', 'policy-v1');
  for (const locale of ['ja', 'en', 'zh-cn'] as const)
    assert(!policyText(locale, p, 'INSTANT').includes('24'));
  const old = { version: 'legacy', freeBeforeMinutes: 120, lateFeeBps: 3000 };
  assert(policyText('zh-cn', old, 'SCHEDULED').includes('2 小时'));
  assert(!policyText('zh-cn', old, 'SCHEDULED').includes('50%'));
});
test('service totals include nomination and travel while shop-assigned totals exclude nomination', () => {
  const items = serviceChoices(catalog(), { duration: 60 });
  assert.equal(items.length, 3);
  assert.equal(items.find((x) => x.store.id === 'store-nagi')?.total, 8700);
  assert.equal(items[0].freeTotal, 8200);
});
test('services reject unapproved, inactive and regulated offerings instead of showing attractive but unbookable prices', () => {
  const c = catalog();
  c.offerings[0].active = false;
  c.offerings[1].approved = false;
  c.offerings[2].regulatoryCategory = 'LICENSED';
  assert(!serviceChoices(c).some((x) => x.store.id === 'store-nagi'));
});
test('matching members must belong to the offering shop with current authorization and required language', () => {
  const c = catalog();
  for (const l of c.listings.filter((x) => x.storeId === 'store-nagi')) l.portraitConsent = false;
  c.listings[3].offeringIds.push('store-nagi-60');
  assert(!serviceChoices(c).some((x) => x.store.id === 'store-nagi'));
  assert(
    serviceChoices(catalog(), { language: 'zh' }).every((x) =>
      x.members.every((m) => m.languages.includes('zh')),
    ),
  );
});
test('instant choices exclude manual shops and offline members; area and service text filters intersect', () => {
  const c = catalog();
  assert.equal(
    serviceChoices(c, { locale: 'zh-cn', search: 'Nagi', area: 'taito', duration: 90 }).length,
    1,
  );
  const result = serviceChoices(c, { mode: 'INSTANT', duration: 60 });
  assert(
    result.every((x) => x.store.acceptanceMode !== 'MANUAL' && x.members.every((m) => m.onDuty)),
  );
  assert.equal(
    serviceChoices(c, { locale: 'en', search: 'Nagi', area: 'taito', duration: 90 }).length,
    1,
  );
  assert.equal(serviceChoices(c, { area: 'unknown' }).length, 0);
});
test('price sort uses the payable nominated total rather than service price alone and never mutates source arrays', () => {
  const c = catalog();
  c.offerings[0].transportFee = 90000;
  const before = JSON.stringify(c);
  const rows = serviceChoices(c, { sort: 'price' });
  assert(rows.every((x, i) => i === 0 || x.total >= rows[i - 1].total));
  assert.equal(JSON.stringify(c), before);
});
test('device history expires, rejects future or malformed data, and strips unrelated personal fields', () => {
  const now = 1800000000000;
  const rows = readVisitHistory(
    JSON.stringify([
      { id: 'old', at: now - 31 * 86400000 },
      { id: 'future', at: now + 1 },
      { id: 'listing-aoi', at: now, address: 'PRIVATE' },
      { id: '../../secret', at: now },
    ]),
    now,
  );
  assert.deepEqual(rows, [{ id: 'listing-aoi', at: now }]);
  assert.deepEqual(readVisitHistory('{broken', now), []);
  assert.deepEqual(readVisitHistory('{}', now), []);
});
test('history keeps the newest visit once and limits stored public references to twelve', () => {
  const now = 1800000000000,
    raw = JSON.stringify([
      { id: 'aoi', at: now - 1 },
      { id: 'aoi', at: now - 100 },
      ...Array.from({ length: 16 }, (_, i) => ({ id: `listing-${i}`, at: now - i - 2 })),
    ]);
  const rows = readVisitHistory(raw, now);
  assert.equal(rows[0].at, now - 1);
  assert.equal(rows.length, 12);
  const next = rememberVisit(raw, 'aoi', now);
  assert.equal(next[0].at, now);
  assert.equal(next.filter((r) => r.id === 'aoi').length, 1);
});
test('limited prices: charged total uses the offer, regular total only when comparison is fair, filter keeps live offers', () => {
  const now = Date.UTC(2026, 9, 19);
  const c = catalog();
  const o = c.offerings.find((x) => x.id === 'store-nagi-60')!;
  const base = {
    id: 'p1',
    regularPrice: o.price,
    startsAt: now - 1000,
    endsAt: now + 86_400_000,
    createdAt: now,
  };
  o.promotion = { ...base, price: 6000, comparisonAllowed: true, comparisonReason: 'ELIGIBLE' };
  const fair = serviceChoices(c, { duration: 60 }, now).find((x) => x.offering.id === o.id)!;
  assert.equal(fair.total, 6000 + o.transportFee + 500);
  assert.equal(fair.compareTotal, o.price + o.transportFee + 500);
  assert.equal(fair.promotionEndsAt, base.endsAt);
  const onlyOffers = serviceChoices(c, { promotions: true }, now);
  assert.deepEqual(
    onlyOffers.map((x) => x.offering.id),
    ['store-nagi-60'],
  );

  o.promotion = {
    ...base,
    price: 6000,
    comparisonAllowed: false,
    comparisonReason: 'REGULAR_PRICE_TOO_NEW',
  };
  const unfair = serviceChoices(c, { duration: 60 }, now).find((x) => x.offering.id === o.id)!;
  assert.equal(unfair.total, 6000 + o.transportFee + 500);
  assert.equal(unfair.compareTotal, undefined, 'no struck-through price without a fair basis');

  // Ended, not started, or for a different regular price → regular pricing, no offer.
  for (const promotion of [
    { ...o.promotion, endsAt: now },
    { ...o.promotion, startsAt: now + 1 },
    { ...o.promotion, regularPrice: o.price + 100 },
  ]) {
    o.promotion = promotion;
    const row = serviceChoices(c, { duration: 60 }, now).find((x) => x.offering.id === o.id)!;
    assert.equal(row.total, o.price + o.transportFee + 500);
    assert.equal(row.promotionEndsAt, undefined);
    assert.equal(serviceChoices(c, { promotions: true }, now).length, 0);
  }
});
