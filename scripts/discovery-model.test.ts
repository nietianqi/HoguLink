import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shopChoices, shopVisitContext } from '../hogulink-web/src/lib/discovery-model';
import { discoveryArticles } from '../hogulink-web/src/lib/discovery-content';
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
