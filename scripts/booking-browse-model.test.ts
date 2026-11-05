import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  browseHref,
  browseHomeHref,
  browseListHref,
  browsePreferences,
  browseListQuery,
  shopDirectoryQuery,
  serviceDirectoryQuery,
  readBrowseList,
  browseScrollKey,
  browseKind,
  browseSource,
} from '../hogulink-web/src/lib/booking-browse-model';
import { chosenServiceMode } from '../hogulink-web/src/lib/service-mode-model';
import { visitSelection } from '../hogulink-web/src/lib/visit-model';

test('a date search from the PC home keeps advanced list state without an explicit filter flag', () => {
  const q = browseListQuery('therapists', {
    mode: 'SCHEDULED',
    date: '2026-11-06',
    maxTotal: '10000',
    area: 'shinjuku',
    fulfillmentMode: 'IN_STORE',
    duration: '60',
    hold: 'must-not-return',
    start: '1793923200000',
  });
  assert.equal(q.date, '2026-11-06');
  assert.equal(q.filters, 'advanced');
  assert.equal(q.maxTotal, '10000');
  assert.equal(q.fulfillmentMode, 'IN_STORE');
  assert.equal(q.hold, undefined);
  assert.equal(q.start, undefined);
  assert.deepEqual(readBrowseList('therapists', JSON.stringify(q)), q);
});

test('switching dimensions keeps only valid shared preferences, never search or transaction state', () => {
  const raw = {
    area: 'taito',
    language: 'zh',
    mode: 'SCHEDULED',
    fulfillmentMode: 'HOME_VISIT',
    search: 'old project',
    duration: '90',
    maxTotal: '10000',
    offering: 'old-sku',
    start: '1793322000000',
    modeConfirmed: '1',
    hold: 'private-hold',
    payment: 'private-payment',
    shopPage: '7',
  };
  for (const kind of ['services', 'therapists', 'shops'] as const) {
    const url = new URL(browseHref('zh-cn', kind, raw), 'https://example.test');
    assert.equal(url.pathname, `/zh-cn/${kind}`);
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      area: 'taito',
      language: 'zh',
      fulfillmentMode: 'HOME_VISIT',
      mode: 'SCHEDULED',
    });
    assert.equal(chosenServiceMode(Object.fromEntries(url.searchParams)), null);
  }
});
test('legacy shop links preserve real filters and pagination while removing unsupported conditions', () => {
  const q = shopDirectoryQuery({
    area: 'shinjuku',
    language: 'en',
    fulfillmentMode: 'IN_STORE',
    mode: 'INSTANT',
    search: ' Ｎａｇｉ ',
    shopPage: '2',
    sort: 'name',
    duration: '120',
    maxTotal: '10000',
    tab: 'shops',
    modeConfirmed: '1',
  });
  assert.deepEqual(q, {
    area: 'shinjuku',
    language: 'en',
    fulfillmentMode: 'IN_STORE',
    mode: 'SCHEDULED',
    search: 'Nagi',
    sort: 'name',
    shopPage: '2',
  });
  assert.equal(
    new URL(browseListHref('en', 'shops', q), 'https://example.test').pathname,
    '/en/shops',
  );
});
test('malformed preferences and saved destinations cannot inject URLs, credentials or invalid filters', () => {
  assert.deepEqual(
    browsePreferences({ area: ['taito'], language: 'xx', fulfillmentMode: 'BOTH', mode: 'bad' }),
    {},
  );
  assert.deepEqual(readBrowseList('services', '{broken'), {});
  assert.deepEqual(readBrowseList('services', '["/admin"]'), {});
  const query = readBrowseList(
    'shops',
    JSON.stringify({
      href: 'https://evil.test',
      password: 'do-not-store',
      area: 'outside',
      shopPage: '-4',
      sort: 'rating',
      search: 'x'.repeat(1000),
    }),
  );
  assert.equal(query.search.length, 80);
  assert.equal(query.sort, 'price');
  assert.deepEqual(Object.keys(query).sort(), ['search', 'sort']);
});
test('each list restores its own supported filters without reopening a prior project selection', () => {
  assert.deepEqual(
    browseListQuery('services', {
      search: 'relaxation',
      duration: '90',
      promo: '1',
      offering: 'old-menu',
      start: '123',
      from: 'home',
    }),
    { mode: 'SCHEDULED', duration: '90', search: 'relaxation', promo: '1' },
  );
  const advanced = browseListQuery('therapists', {
    filters: 'advanced',
    date: '2026-10-30',
    maxTotal: '15000',
    acceptance: 'auto',
    view: 'list',
    mode: 'INSTANT',
    sort: 'earliest',
  });
  assert.equal(advanced.filters, 'advanced');
  assert.equal(advanced.maxTotal, '15000');
  assert.equal(advanced.view, 'list');
  assert.equal('date' in advanced, false);
  assert.equal(advanced.sort, 'recommended');
});
test('home return and scroll keys retain the dimension and exclude private booking fields', () => {
  const raw = {
    area: 'taito',
    browse: 'shops',
    language: 'en',
    mode: 'INSTANT',
    fulfillmentMode: 'IN_STORE',
    address: 'private',
    hold: 'private',
    start: '123',
  };
  const home = new URL(browseHomeHref('ja', 'shops', raw), 'https://example.test');
  assert.equal(home.searchParams.get('browse'), 'shops');
  assert.equal(home.searchParams.get('mode'), 'SCHEDULED');
  const key = browseScrollKey('/ja', Object.fromEntries(home.searchParams));
  assert.equal(key, browseScrollKey('/ja', raw));
  assert.equal(key?.includes('private'), false);
  assert.equal(browseScrollKey('/ja/checkout/private', raw), null);
  assert.equal(browseScrollKey('/ja/account/bookings/private', raw), null);
});
test('detail return context is bounded and does not grant service-mode consent', () => {
  const context = browseSource({
    from: 'services',
    homeBrowse: 'shops',
    returnTo: '//evil.test',
    modeConfirmed: '1',
  });
  assert.deepEqual(context, { from: 'services', homeBrowse: 'shops' });
  assert.deepEqual(browseSource({ from: '//evil.test', homeBrowse: 'admin' }), {});
  assert.equal(visitSelection({ ...context, fulfillmentMode: 'HOME_VISIT' }).from, 'services');
  assert.equal(
    chosenServiceMode(visitSelection({ ...context, fulfillmentMode: 'HOME_VISIT' })),
    null,
  );
  assert.equal(browseKind('/en/shops'), 'shops');
  assert.equal(browseKind('/en/shops/nagi-tokyo'), null);
});
test('project filters normalize an incompatible instant in-store preference before querying', () => {
  const q = serviceDirectoryQuery({
    mode: 'INSTANT',
    fulfillmentMode: 'IN_STORE',
    duration: '90',
    promo: '1',
    offering: 'store-nagi-90-in-store',
    from: 'home',
    homeBrowse: 'services',
  });
  assert.equal(q.mode, 'SCHEDULED');
  assert.equal(q.fulfillmentMode, 'IN_STORE');
  assert.equal(q.duration, '90');
  assert.equal(q.offering, 'store-nagi-90-in-store');
  assert.equal(q.from, 'home');
  assert.equal('offering' in serviceDirectoryQuery({ offering: '//evil.test' }), false);
});
