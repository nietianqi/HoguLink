import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shopChoices, shopVisitContext } from '../hogulink-web/src/lib/discovery-model';
import {
  shopCards,
  shopMonogram,
  shopTone,
  shopPage,
  shopCardHref,
} from '../hogulink-web/src/lib/shop-model';
import {
  loadShopStats,
  loadListingStats,
  type ShopStatsMap,
} from '../hogulink-web/src/lib/shop-stats';
import { visitPreferences, visitSelection } from '../hogulink-web/src/lib/visit-model';
import { discoveryArticles } from '../hogulink-web/src/lib/discovery-content';
import {
  discoveryQuery,
  discoveryParams,
  postBookingHref,
  postHref,
} from '../hogulink-web/src/lib/discovery-feed-model';
import type { DiscoveryPost } from '@hogulink/contracts';
import { safeAccountReturn } from '../hogulink-web/src/lib/customer-auth-i18n';
import { listings, offerings, stores } from '../hogulink-api/src/seed';
import type { Catalog } from '../hogulink-web/src/lib/api';
const catalog = (): Catalog =>
  structuredClone({
    listings,
    offerings,
    stores,
    demo: true,
    bookingRules: { nominationFee: 500 },
  } as Catalog);
test('discovery shop prices include travel, exclude nomination and group unique staff across menus', () => {
  const c = catalog(),
    rows = shopChoices(c),
    nagi = rows.find((r) => r.store.id === 'store-nagi')!;
  assert.equal(rows.length, 3);
  assert.equal(nagi.total, 8200);
  assert.equal(
    nagi.members,
    new Set(c.listings.filter((l) => l.storeId === 'store-nagi').map((l) => l.id)).size,
  );
  assert(rows.every((r, i) => i === 0 || r.total >= rows[i - 1].total));
});
test('discovery filters intersect and search across all three shop and menu translations', () => {
  const c = catalog(),
    matches = shopChoices(c, { search: 'Nagi', area: 'taito', language: 'zh' });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].store.id, 'store-nagi');
  assert.equal(shopChoices(c, { area: 'unknown' }).length, 0);
  assert.equal(shopChoices(c, { search: 'no such shop' }).length, 0);
  assert(matches[0].services.every((s) => s.members.every((m) => m.languages.includes('zh'))));
});
test('unpublished portraits and unapproved or inactive shops are absent from discovery', () => {
  const c = catalog();
  for (const l of c.listings.filter((l) => l.storeId === 'store-nagi')) l.portraitConsent = false;
  c.stores.find((s) => s.id === 'store-mori')!.active = false;
  assert(!shopChoices(c).some((r) => ['store-nagi', 'store-mori'].includes(r.store.id)));
});
test('filtered shop links preserve required area and language and never copy stale time, payment or hold', () => {
  const ctx = shopVisitContext(catalog(), 'store-nagi', { area: 'taito', language: 'zh' });
  assert.deepEqual(ctx.carry, { area: 'taito', language: 'zh' });
  assert(ctx.members.length);
  assert(ctx.members.every((m) => m.storeId === 'store-nagi' && m.languages.includes('zh')));
  assert(ctx.services.every((s) => s.members.some((m) => ctx.members.some((x) => x.id === m.id))));
});
test('a no-longer-supported language or area has no booking representative instead of dropping preferences', () => {
  assert.equal(
    shopVisitContext(catalog(), 'store-nagi', { language: 'unsupported' }).members.length,
    0,
  );
  assert.equal(shopVisitContext(catalog(), 'store-nagi', { area: 'unknown' }).services.length, 0);
});

test('instant shop navigation retains browsing preferences and filters scheduled-only providers', () => {
  const c = catalog();
  const preferences = {
    area: 'shinjuku',
    language: 'ja',
    mode: 'INSTANT',
    hold: 'old-private-hold',
    start: 'old-timeslot',
    payment: 'old-payment',
    nomination: 'NOMINATED',
  };
  const card = shopCards(c, preferences).find((item) => item.store.id === 'store-nagi')!;
  assert(card);
  for (const locale of ['zh-cn', 'ja', 'en'] as const) {
    const url = new URL(shopCardHref(locale, card, preferences), 'http://localhost:3000');
    const carry = Object.fromEntries(url.searchParams);
    assert.deepEqual(carry, {
      area: 'shinjuku',
      language: 'ja',
      mode: 'INSTANT',
      offering: card.fromOfferingId,
      nomination: 'FREE',
    });
    const context = shopVisitContext(c, card.store.id, carry);
    assert.deepEqual(context.carry, { area: 'shinjuku', language: 'ja', mode: 'INSTANT' });
    assert(context.members.length);
    assert(context.members.every((member) => member.onDuty && member.languages.includes('ja')));
    for (const service of context.services)
      assert(service.members.every((member) => member.onDuty));
  }
  const manual = c.stores.find((store) => store.acceptanceMode === 'MANUAL')!;
  assert.equal(shopVisitContext(c, manual.id, { mode: 'INSTANT' }).services.length, 0);
  for (const member of c.listings) member.onDuty = false;
  assert.equal(shopVisitContext(c, card.store.id, preferences).members.length, 0);
  assert(shopVisitContext(c, card.store.id, { ...preferences, mode: 'SCHEDULED' }).members.length);
});

test('provider navigation strips transaction state and ignores invalid or repeated mode values', () => {
  assert.deepEqual(
    visitPreferences({
      area: 'taito',
      language: 'zh',
      mode: 'SCHEDULED',
      start: 'old',
      hold: 'private',
      payment: 'private',
      quoteId: 'private',
      offering: 'other-shop-menu',
      nomination: 'NOMINATED',
    }),
    { area: 'taito', language: 'zh', mode: 'SCHEDULED' },
  );
  assert.deepEqual(visitPreferences({ area: ['taito'], language: ['zh'], mode: ['INSTANT'] }), {});
  assert.deepEqual(visitPreferences({ mode: 'OTHER', area: '', language: '' }), {});
});

test('returning from the planner keeps the current service, nomination and valid time without checkout state', () => {
  const selection = {
    area: 'taito',
    language: 'zh',
    mode: 'SCHEDULED',
    offering: 'menu-90',
    nomination: 'FREE',
    start: '1792486800000',
    hold: 'private',
    paymentId: 'private',
    quoteId: 'private',
  };
  const returned = visitSelection(selection);
  assert.deepEqual(returned, {
    area: 'taito',
    language: 'zh',
    mode: 'SCHEDULED',
    offering: 'menu-90',
    nomination: 'FREE',
    start: '1792486800000',
  });
  assert.equal(visitSelection({ ...selection, offering: 'menu-120' }).offering, 'menu-120');
  assert.deepEqual(visitSelection({ nomination: 'OTHER', offering: [], start: 'not-a-time' }), {});
  for (const start of ['-1', '0', 'Infinity', '1792486800000x', '9999999999999999999'])
    assert.equal(visitSelection({ start }).start, undefined);
});

test('discovery articles and author links preserve the booking mode without retaining checkout state', () => {
  const q = discoveryQuery({
    tab: 'shops',
    mode: 'INSTANT',
    area: 'taito',
    language: 'zh',
    hold: 'private',
    start: 'old',
    payment: 'private',
  });
  for (const locale of ['zh-cn', 'ja', 'en'] as const) {
    for (const kind of ['therapist', 'shop'] as const) {
      const post = { id: 'post', author: { kind, slug: 'provider' } } as DiscoveryPost;
      const next = new URL(postBookingHref(locale, post, q), 'http://localhost');
      assert.deepEqual(Object.fromEntries(next.searchParams), {
        area: 'taito',
        language: 'zh',
        mode: 'INSTANT',
      });
      const article = new URL(postHref(locale, post, q), 'http://localhost');
      assert.equal(article.searchParams.get('mode'), 'INSTANT');
      assert.equal(article.searchParams.has('hold'), false);
    }
  }
  assert.equal(discoveryQuery({ mode: 'unsupported' }).mode, undefined);
});
test('editorial guides have unique stable routes and complete three-language content', () => {
  assert.equal(new Set(discoveryArticles.map((a) => a.slug)).size, discoveryArticles.length);
  for (const a of discoveryArticles)
    for (const l of ['ja', 'en', 'zh-cn'] as const) {
      assert(a.title[l]);
      assert(a.summary[l]);
      assert(a.sections.length >= 2);
      for (const s of a.sections) {
        assert(s.heading[l]);
        assert(s.text[l]);
      }
    }
});

test('discovery search and navigation carry only supported preferences, never stale transaction values', () => {
  const q = discoveryQuery({
    tab: 'therapists',
    search: ' Ｎａｇｉ ',
    area: 'taito',
    language: 'zh',
    hold: 'private',
    start: 'old',
  });
  assert.deepEqual(q, { tab: 'therapists', search: 'Nagi', area: 'taito', language: 'zh' });
  assert(!discoveryParams(q).has('hold'));
  assert.deepEqual(discoveryQuery({ tab: 'unknown', area: 'unknown', language: 'unknown' }), {
    tab: 'recommended',
  });
  const post = {
    id: 'therapist-aoi-tokyo',
    author: { kind: 'therapist', slug: 'aoi-tokyo' },
  } as DiscoveryPost;
  assert.equal(postBookingHref('ja', post, q), '/ja/book/aoi-tokyo?area=taito&language=zh');
  assert(postHref('en', post, q).includes('tab=therapists'));
  assert(!postBookingHref('en', post, q).includes('search='));
  assert.equal(
    safeAccountReturn(
      'en',
      '/zh-cn/discover/guide-choose-your-visit?tab=guides&area=taito&language=zh',
    ),
    '/en/discover/guide-choose-your-visit?tab=guides&area=taito&language=zh',
  );
});

test('shop cards show the cheapest shop-arranged price, real stats only, and a fair offer comparison', () => {
  const now = Date.UTC(2026, 9, 20);
  const c = catalog();
  const cards = shopCards(
    c,
    {},
    { 'store-nagi': { rating: 4.6, reviewCount: 3, completed90d: 7, favorites: 2 } },
    now,
  );
  assert.deepEqual(
    cards.map((x) => x.store.id),
    shopChoices(c).map((x) => x.store.id),
    'same shops and order as the existing shop choices',
  );
  for (const card of cards) {
    assert.equal(card.fromTotal, shopChoices(c).find((x) => x.store.id === card.store.id)!.total);
    assert.ok(card.members.every((m) => m.storeId === card.store.id && m.identityVerified));
    assert.equal(new Set(card.members.map((m) => m.id)).size, card.members.length);
    assert.equal(card.promotion, false);
    assert.equal(card.fromCompare, undefined);
  }
  const nagi = cards.find((x) => x.store.id === 'store-nagi')!;
  assert.equal(nagi.stats?.rating, 4.6);
  // Unknown is different from successfully read zero counts.
  assert.equal(cards.find((x) => x.store.id === 'store-sora')!.stats, undefined);

  // A fair offer on the cheapest menu lowers the "from" price and keeps the regular one.
  const o = c.offerings.find((x) => x.storeId === 'store-nagi' && x.durationMinutes === 60)!;
  o.promotion = {
    id: 'p',
    price: o.price - 1000,
    regularPrice: o.price,
    startsAt: now - 1,
    endsAt: now + 86_400_000,
    createdAt: now,
    comparisonAllowed: true,
    comparisonReason: 'ELIGIBLE',
  };
  const offered = shopCards(c, {}, {}, now).find((x) => x.store.id === 'store-nagi')!;
  assert.equal(offered.promotion, true);
  assert.equal(offered.fromTotal, o.price - 1000 + o.transportFee);
  assert.equal(offered.fromCompare, o.price + o.transportFee);
  o.promotion = {
    ...o.promotion,
    comparisonAllowed: false,
    comparisonReason: 'REGULAR_PRICE_TOO_NEW',
  };
  assert.equal(
    shopCards(c, {}, {}, now).find((x) => x.store.id === 'store-nagi')!.fromCompare,
    undefined,
  );

  // Language filters narrow members and languages together.
  const zh = shopCards(c, { language: 'zh' }, {}, now);
  assert.ok(zh.every((x) => x.members.every((m) => m.languages.includes('zh'))));
  assert.ok(zh.every((x) => x.languages.includes('zh')));
});

test('shop brand marks are stable per shop', () => {
  assert.equal(shopTone('store-nagi'), shopTone('store-nagi'));
  assert.equal(shopMonogram({ name: { ja: 'なぎ', en: 'nagi', 'zh-cn': '凪' } }), 'N');
  assert.equal(shopMonogram({ name: { ja: 'なぎ', en: '', 'zh-cn': '凪' } }), 'な');
});

test('shop stats fetch every unique ID in bounded batches and retain successful batches on failure', async () => {
  const ids = Array.from({ length: 251 }, (_, i) => `shop-${i}`);
  const calls: string[][] = [];
  let active = 0,
    peak = 0;
  const fact = { rating: 4.8, reviewCount: 12, completed90d: 23, favorites: 7 };
  const all = await loadShopStats([...ids, ids[0]], async (path) => {
    const batch = new URLSearchParams(path.split('?')[1]).get('ids')!.split(',');
    calls.push(batch);
    peak = Math.max(peak, ++active);
    await Promise.resolve();
    active--;
    return Object.fromEntries(batch.map((id) => [id, fact]));
  });
  assert.equal(Object.keys(all).length, 251);
  assert.equal(calls.length, 6);
  assert(calls.every((batch) => batch.length <= 50));
  assert.equal(peak, 4);
  assert.deepEqual(all['shop-124'], fact);
  assert.deepEqual(all['shop-250'], fact);
  const partial = await loadShopStats(ids, async (path) => {
    const batch = new URLSearchParams(path.split('?')[1]).get('ids')!.split(',');
    if (batch.includes('shop-50')) throw new Error('temporary outage');
    return Object.fromEntries(batch.map((id) => [id, fact]));
  });
  assert.deepEqual(partial['shop-0'], fact);
  assert.deepEqual(partial['shop-124'], fact);
  assert.equal(partial['shop-50'], undefined);
  let emptyCalled = false;
  assert.deepEqual(
    await loadShopStats([], async () => {
      emptyCalled = true;
      return {};
    }),
    {},
  );
  assert.equal(emptyCalled, false);
});

test('unknown shop statistics stay unknown while a real zero history remains available', async () => {
  const c = catalog();
  const zero = { rating: null, reviewCount: 0, completed90d: 0, favorites: 0 };
  const failed = await loadShopStats(['store-nagi'], async () => {
    throw new Error('offline');
  });
  assert.equal(shopCards(c, {}, failed).find((x) => x.store.id === 'store-nagi')!.stats, undefined);
  const read: ShopStatsMap = { 'store-nagi': zero };
  assert.deepEqual(shopCards(c, {}, read).find((x) => x.store.id === 'store-nagi')!.stats, zero);
});

test('listing statistic outages and missing results stay unknown, while confirmed zero counts stay zero', async () => {
  const zero = { rating: null, reviewCount: 0, completed90d: 0, favorites: 0 };
  const calls: string[] = [];
  const found = await loadListingStats(['listing-aoi', 'listing-aoi', 'missing'], async (path) => {
    calls.push(path);
    return { 'listing-aoi': zero };
  });
  assert.deepEqual(found['listing-aoi'], zero);
  assert.equal(found.missing, undefined);
  assert.equal(calls.length, 1);
  assert(calls[0].startsWith('public/listing-stats?'));
  assert.deepEqual(new URLSearchParams(calls[0].split('?')[1]).get('ids')?.split(','), [
    'listing-aoi',
    'missing',
  ]);
  const failed = await loadListingStats(['listing-aoi'], async () => {
    throw new Error('offline');
  });
  assert.equal(failed['listing-aoi'], undefined);
  const recovered = await loadListingStats(['listing-aoi'], async () => ({ 'listing-aoi': zero }));
  assert.deepEqual(recovered['listing-aoi'], zero);
});

test('a cheaper long menu keeps its actual duration, menu and localized service alongside the from-price', () => {
  const c = catalog(),
    now = Date.UTC(2026, 9, 20);
  const long = c.offerings.find((o) => o.storeId === 'store-nagi' && o.durationMinutes === 90)!;
  long.promotion = {
    id: 'long-offer',
    price: 1000,
    regularPrice: long.price,
    startsAt: now - 1,
    endsAt: now + 86_400_000,
    createdAt: now,
    comparisonAllowed: true,
    comparisonReason: 'ELIGIBLE',
  };
  const card = shopCards(c, { locale: 'zh-cn' }, {}, now).find((x) => x.store.id === 'store-nagi')!;
  assert.equal(card.fromTotal, 1000 + long.transportFee);
  assert.equal(card.fromDuration, 90);
  assert.equal(card.fromOfferingId, long.id);
  assert(card.serviceNames.includes(long.name['zh-cn']));
  for (const locale of ['ja', 'en', 'zh-cn'] as const) {
    const preferences = {
      area: 'taito',
      language: 'zh',
      hold: 'private',
      start: 'old',
      payment: 'old',
    };
    const url = new URL(shopCardHref(locale, card, preferences), 'http://localhost:3000');
    assert.equal(url.pathname, `/${locale}/shops/${card.store.slug}`);
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      area: 'taito',
      language: 'zh',
      offering: long.id,
      nomination: 'FREE',
    });
  }
  assert.equal(
    shopCards(c, {}, {}, long.promotion.endsAt + 1).find((x) => x.store.id === 'store-nagi')!
      .fromDuration,
    60,
  );
});

test('shop pages cover shops beyond 50 without duplicates and clamp invalid pages', () => {
  const first = shopCards(catalog())[0];
  const cards = Array.from({ length: 51 }, (_, i) => ({
    ...first,
    store: { ...first.store, id: `shop-${i}` },
  }));
  const seen = Array.from({ length: 5 }, (_, i) => shopPage(cards, String(i + 1)).items).flat();
  assert.equal(seen.length, 51);
  assert.equal(new Set(seen.map((card) => card.store.id)).size, 51);
  assert.equal(shopPage(cards, '5').items.length, 3);
  assert.equal(shopPage(cards, '99999').page, 5);
  for (const raw of ['-1', '0', 'garbage', '1.5', 'Infinity'])
    assert.equal(shopPage(cards, raw).page, 1);
  assert.equal(shopPage([], '9').page, 1);
});

test('shop browsing ignores unrelated URL menu-duration and budget fields', () => {
  const c = catalog();
  const expected = shopCards(c, { area: 'taito' });
  const actual = shopCards(c, {
    area: 'taito',
    ...{ duration: '90', maxTotal: '10000', promo: '1' },
  });
  assert.deepEqual(actual, expected);
});
