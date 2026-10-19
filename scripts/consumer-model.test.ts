import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readVisitHistory,
  rememberVisit,
  serviceChoices,
} from '../hogulink-web/src/lib/consumer-model';
import { listings, offerings, stores } from '../hogulink-api/src/seed';
import type { Catalog } from '../hogulink-web/src/lib/api';
import { makeCancellationPolicy } from '@hogulink/contracts';
import { nominationFeeFor } from '../hogulink-web/src/lib/api';
import { policyText } from '../hogulink-web/src/lib/visit-i18n';
const catalog = (): Catalog =>
  structuredClone({
    listings,
    offerings,
    stores,
    demo: true,
    bookingRules: { nominationFee: 500 },
  } as Catalog);

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
