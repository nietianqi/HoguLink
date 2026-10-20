import test from 'node:test';
import assert from 'node:assert/strict';
import {
  browseQuery,
  browseHref,
  browseTab,
  groupedServices,
} from '../hogulink-web/src/lib/booking-browse-model';
import { shopVisitContext } from '../hogulink-web/src/lib/discovery-model';
import { serviceChoices } from '../hogulink-web/src/lib/consumer-model';
import { shopCards, shopCardHref } from '../hogulink-web/src/lib/shop-model';
import {
  discoveryQuery,
  discoveryBrowserParams,
  discoveryParams,
  postHref,
} from '../hogulink-web/src/lib/discovery-feed-model';
import { listings, offerings, stores } from '../hogulink-api/src/seed';
import type { Catalog } from '../hogulink-web/src/lib/api';

const catalog = () =>
  structuredClone({
    listings,
    offerings,
    stores,
    demo: true,
    bookingRules: { nominationFee: 500 },
  } as Catalog);

test('unified browsing normalizes filters without carrying checkout or stale pagination state', () => {
  const q = browseQuery({
    view: 'services',
    area: 'taito',
    language: 'zh',
    mode: 'INSTANT',
    duration: '90',
    promo: '1',
    offering: 'store-nagi-90',
    search: ' Ｎａｇｉ ',
    hold: 'private',
    token: 'secret',
    cursor: 'old',
    page: '999',
  });
  assert.equal(q.view, 'services');
  assert.equal(q.search, 'Nagi');
  assert.equal(q.offering, 'store-nagi-90');
  assert.equal(q.duration, '90');
  assert.equal(q.promo, '1');
  for (const key of ['hold', 'token', 'cursor', 'page']) assert(!Object.hasOwn(q, key));
  assert(!browseHref('ja', q).includes('private'));
});

test('shops and grouped menus default to every duration while therapist search defaults to 60', () => {
  assert.equal(browseQuery({ view: 'services' }).duration, undefined);
  assert.equal(browseQuery({ view: 'shops', duration: 'all' }).duration, undefined);
  assert.equal(browseQuery({}).duration, '60');
  assert.equal(browseQuery({ view: 'unknown', duration: '120' }).view, 'therapists');
});

test('view switching preserves preferences but discards the selected menu and promotion filter', () => {
  const href = browseTab(
    'en',
    {
      view: 'services',
      area: 'taito',
      language: 'zh',
      mode: 'INSTANT',
      duration: '90',
      promo: '1',
      offering: 'old-menu',
      start: 'old-slot',
    },
    'shops',
  );
  const q = new URL(href, 'http://localhost').searchParams;
  assert.equal(q.get('view'), 'shops');
  assert.equal(q.get('duration'), '90');
  assert.equal(q.get('language'), 'zh');
  assert.equal(q.get('mode'), 'INSTANT');
  for (const key of ['offering', 'promo', 'start']) assert(!q.has(key));
});

test('same service is grouped across stores and durations, with a real shop-arranged from-price', () => {
  const c = catalog();
  const groups = groupedServices(serviceChoices(c));
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].durations, [60, 90, 120]);
  assert.equal(groups[0].shops, 3);
  assert.equal(groups[0].items.length, 9);
  assert.equal(groups[0].from.freeTotal, Math.min(...groups[0].items.map((c) => c.freeTotal)));
});

test('the from-price remains bound to its actual duration even when the longer menu costs less', () => {
  const c = catalog();
  const menu = c.offerings.find((o) => o.id === 'store-nagi-120')!;
  menu.price = 1000;
  delete menu.promotion;
  const [group] = groupedServices(serviceChoices(c));
  assert.equal(group.from.offering.id, menu.id);
  assert.equal(group.from.offering.durationMinutes, 120);
  assert.equal(group.from.freeTotal, 1000 + menu.transportFee);
  assert.equal(group.from.total - group.from.freeTotal, 500);
});

test('grouped menus count only providers that survive area/language/duration filters', () => {
  const choices = serviceChoices(catalog(), { area: 'taito', language: 'zh', duration: 90 });
  const groups = groupedServices(choices);
  assert(groups.length > 0);
  for (const group of groups) {
    assert.deepEqual(group.durations, [90]);
    assert.equal(group.shops, new Set(choices.map((c) => c.store.id)).size);
    assert(
      group.items.every(
        (c) => c.store.areas.includes('taito') && c.members.some((m) => m.languages.includes('zh')),
      ),
    );
  }
});

test('instant shop browsing keeps instant intent on the shop detail handoff', () => {
  const card = shopCards(catalog(), { mode: 'INSTANT' })[0];
  assert(card);
  const url = new URL(
    shopCardHref('zh-cn', card, { area: 'shinjuku', mode: 'INSTANT' }),
    'http://localhost',
  );
  assert.equal(url.searchParams.get('mode'), 'INSTANT');
  assert.equal(url.searchParams.get('offering'), card.fromOfferingId);
  assert.equal(url.searchParams.get('nomination'), 'FREE');
});

test('shop stories use a content URL distinct from the old shop directory, while API tabs remain compatible', () => {
  const q = discoveryQuery({ tab: 'stories', area: 'taito', language: 'zh' });
  assert.equal(q.tab, 'shops');
  assert.equal(discoveryBrowserParams(q).get('tab'), 'stories');
  assert.equal(discoveryParams(q).get('tab'), 'shops');
});

test('instant shop detail keeps the requested mode and only exposes on-duty members', () => {
  const c = catalog();
  const ctx = shopVisitContext(c, 'store-nagi', { mode: 'INSTANT', language: 'zh' });
  assert.equal(ctx.carry.mode, 'INSTANT');
  assert(ctx.members.length > 0);
  assert(ctx.members.every((m) => m.onDuty && m.languages.includes('zh')));
  assert.equal(shopVisitContext(c, 'store-mori', { mode: 'INSTANT' }).members.length, 0);
});

test('therapist-only sorts cannot become hidden filters on shop or menu views', () => {
  const q = browseQuery({ view: 'shops', sort: 'distance', near: 'taito' });
  assert.equal(q.sort, 'recommended');
  assert.equal(q.near, undefined);
  assert.equal(browseQuery({ view: 'services', sort: 'price' }).sort, 'price');
});
