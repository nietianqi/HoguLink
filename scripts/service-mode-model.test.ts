import test from 'node:test';
import assert from 'node:assert/strict';
import type { Booking, Listing, Offering, PublicStore } from '@hogulink/contracts';
import { withinVenueHours } from '@hogulink/contracts';
import { catalogForMode, chosenServiceMode } from '../hogulink-web/src/lib/service-mode-model.js';
import {
  visitPreferences,
  visitServices,
  withServiceMode,
} from '../hogulink-web/src/lib/visit-model.js';
import {
  serviceChoices,
  browseServiceChoices,
  choiceModePrices,
  providerModePrices,
} from '../hogulink-web/src/lib/consumer-model.js';
import {
  directoryQuery,
  therapistSelection,
} from '../hogulink-web/src/lib/therapist-directory-model.js';
import { nextEvent } from '../hogulink-web/src/lib/staff-model.js';
import { sv } from '../hogulink-web/src/lib/service-mode-i18n.js';
const name = { ja: '店', en: 'Shop', 'zh-cn': '店' };
const store = {
  id: 'shop',
  slug: 'shop',
  name,
  approved: true,
  active: true,
  areas: ['shinjuku'],
  venue: {
    status: 'APPROVED',
    enabled: true,
    area: 'shibuya',
    nominationFee: 300,
    timeSurcharges: [],
    capacity: 1,
    businessHours: { startMinute: 540, endMinute: 1320 },
  },
  bookingRules: { version: 1, nominationFee: 500, cancellationPolicy: { version: 'v1' } },
} as unknown as PublicStore;
const person = {
  id: 'person',
  slug: 'person',
  storeId: 'shop',
  staffId: 'a',
  name,
  membershipActive: true,
  identityVerified: true,
  portraitConsent: true,
  publicationStatus: 'PUBLISHED_INDEXABLE',
  offeringIds: ['home', 'store'],
  languages: ['ja'],
  fulfillmentModes: ['HOME_VISIT', 'IN_STORE'],
} as Listing;
const home = {
  id: 'home',
  storeId: 'shop',
  name,
  price: 7000,
  transportFee: 1000,
  durationMinutes: 60,
  approved: true,
  regulatoryCategory: 'RELAXATION',
} as Offering;
const onsite = {
  ...home,
  id: 'store',
  price: 6000,
  transportFee: 0,
  fulfillmentMode: 'IN_STORE' as const,
};
const catalog = { stores: [store], listings: [person], offerings: [home, onsite], demo: true };

test('browsing and old links never silently choose a service location', () => {
  assert.equal(chosenServiceMode({}), null);
  assert.equal(chosenServiceMode({ fulfillmentMode: 'HOME_VISIT' }), null);
  assert.equal(chosenServiceMode({ fulfillmentMode: 'IN_STORE' }), null);
  assert.equal(chosenServiceMode({ fulfillmentMode: 'ALL', modeConfirmed: '1' }), null);
  for (const mode of ['HOME_VISIT', 'IN_STORE'])
    assert.equal(chosenServiceMode({ fulfillmentMode: mode, modeConfirmed: '1' }), mode);
});
test('unified browsing keeps in-store-only shops visible and applies the correct mode fees', () => {
  const both = browseServiceChoices(catalog);
  assert.equal(both.length, 2); // Equal names are not a service relation.
  assert.deepEqual(
    providerModePrices(store, [home, onsite], [person]).map((p) => [p.mode, p.total]),
    [
      ['HOME_VISIT', 8500],
      ['IN_STORE', 6300],
    ],
  );
  const rows = browseServiceChoices({
    ...catalog,
    stores: [{ ...store, homeVisitsEnabled: false }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].offering.id, 'store');
  assert.equal(rows[0].total, 6300);
});
test('linked service variants share one card while retaining mode-specific staff and prices', () => {
  const child = { ...onsite, id: 'home-in-store' };
  const homeOnly = {
    ...person,
    id: 'home-person',
    offeringIds: ['home'],
    fulfillmentModes: ['HOME_VISIT'] as const,
  };
  const inPerson = { ...person, offeringIds: [child.id], fulfillmentModes: ['IN_STORE'] as const };
  const rows = browseServiceChoices({
    ...catalog,
    offerings: [home, child],
    listings: [homeOnly as unknown as Listing, inPerson as unknown as Listing],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].members.length, 2);
  assert.deepEqual(
    rows[0].modePrices.map((p) => [p.mode, p.total]),
    [
      ['HOME_VISIT', 8500],
      ['IN_STORE', 6300],
    ],
  );
  assert.deepEqual(
    choiceModePrices(rows[0].variants, person.id).map((p) => p.mode),
    ['IN_STORE'],
  );
});
test('unified area browsing includes a venue ward independently of home coverage', () => {
  assert.equal(browseServiceChoices(catalog, { area: 'shibuya' }).length, 1);
  assert.equal(
    browseServiceChoices(catalog, { area: 'shibuya' })[0].offering.fulfillmentMode,
    'IN_STORE',
  );
  assert.ok(
    browseServiceChoices(catalog, { mode: 'INSTANT' }).every(
      (c) => c.offering.fulfillmentMode !== 'IN_STORE',
    ),
  );
});

test('selected mode keeps prices, location and menus coherent across customer entry points', () => {
  const selected = catalogForMode(catalog, 'IN_STORE');
  assert.deepEqual(selected.stores[0].areas, ['shibuya']);
  const choices = serviceChoices(selected, { fulfillmentMode: 'IN_STORE', area: 'shibuya' });
  assert.equal(choices.length, 1);
  assert.equal(choices[0].total, 6300);
  assert.equal(choices[0].transportFee, 0);
  assert.equal(
    visitServices(catalog.offerings, person, [person], 'NOMINATED', 'IN_STORE')[0].id,
    'store',
  );
  assert.deepEqual(
    catalogForMode(catalog, 'HOME_VISIT').offerings.map((o) => o.id),
    ['home'],
  );
});
test('unapproved venues and unsupported staff cannot appear in in-store supply', () => {
  assert.equal(
    catalogForMode(
      { ...catalog, stores: [{ ...store, venue: { ...store.venue!, status: 'PENDING' } }] },
      'IN_STORE',
    ).offerings.length,
    0,
  );
  assert.equal(
    visitServices(
      catalog.offerings,
      { ...person, fulfillmentModes: ['HOME_VISIT'] },
      [person],
      'NOMINATED',
      'IN_STORE',
    ).length,
    0,
  );
});
test('mode preferences and directory selections survive navigation without carrying checkout credentials', () => {
  assert.deepEqual(
    visitPreferences({
      fulfillmentMode: 'IN_STORE',
      mode: 'SCHEDULED',
      holdId: 'secret',
      paymentId: 'secret',
    }),
    { fulfillmentMode: 'IN_STORE', mode: 'SCHEDULED' },
  );
  const q = directoryQuery({ fulfillmentMode: 'IN_STORE', mode: 'INSTANT' });
  assert.equal(q.mode, 'SCHEDULED');
  const params = therapistSelection(q, { offering: onsite, earliestAt: 12345 } as any);
  assert.equal(params.get('fulfillmentMode'), 'IN_STORE');
  assert.equal(params.get('offering'), 'store');
});
test('mobile and PC customer navigation keep in-store context without changing workspace links', () => {
  assert.equal(
    withServiceMode('/zh-cn/therapists', 'IN_STORE'),
    '/zh-cn/therapists?fulfillmentMode=IN_STORE',
  );
  assert.equal(
    withServiceMode('/en/discover?tab=shops#results', 'IN_STORE'),
    '/en/discover?tab=shops&fulfillmentMode=IN_STORE#results',
  );
  assert.equal(
    withServiceMode('/ja/therapists?mode=INSTANT', 'IN_STORE'),
    '/ja/therapists?mode=SCHEDULED&fulfillmentMode=IN_STORE',
  );
  assert.equal(withServiceMode('/zh-cn/merchant', undefined), '/zh-cn/merchant');
  assert.equal(withServiceMode('https://example.com/', 'IN_STORE'), 'https://example.com/');
});

test('in-store tasks wait for check-in then start directly; home task transitions remain intact', () => {
  const b = {
    status: 'CONFIRMED',
    staffTaskStatus: 'ACKNOWLEDGED',
    replacementConsent: 'NOT_REQUIRED',
    quote: { fulfillmentMode: 'IN_STORE' },
  } as Booking;
  assert.equal(nextEvent(b), undefined);
  assert.equal(nextEvent({ ...b, checkIn: { at: 1, actorId: 'shop' } }), 'START');
  assert.equal(
    nextEvent({ ...b, quote: { ...b.quote, fulfillmentMode: 'HOME_VISIT' } }),
    'EN_ROUTE',
  );
});
test('closing time considers full duration, including overnight and 24-hour opening windows', () => {
  const jst = (h: number) => Date.UTC(2026, 9, 26) + (h - 9) * 3_600_000;
  assert.equal(withinVenueHours({ startMinute: 540, endMinute: 1320 }, jst(21), jst(22)), true);
  assert.equal(
    withinVenueHours({ startMinute: 540, endMinute: 1320 }, jst(21.5), jst(22.5)),
    false,
  );
  assert.equal(withinVenueHours({ startMinute: 1080, endMinute: 240 }, jst(2), jst(3)), true);
  assert.equal(withinVenueHours({ startMinute: 0, endMinute: 1440 }, jst(22), jst(23)), true);
  assert.equal(withinVenueHours({ startMinute: 0, endMinute: 1440 }, jst(23.5), jst(24.5)), true);
});
test('all three locales explain check-in, missed appointments and new capacity failures', () => {
  for (const l of ['ja', 'en', 'zh-cn'] as const)
    for (const key of [
      'IN_STORE',
      'checkInHelp',
      'noShowHelp',
      'RESOURCE_UNAVAILABLE',
      'VENUE_HAS_BOOKINGS',
    ] as const)
      assert.ok(sv(l, key).length > 0);
});
