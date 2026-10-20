import test from 'node:test';
import assert from 'node:assert/strict';
import type { Booking, Store, Listing, Offering } from '@hogulink/contracts';
import { mobileBootstrap, mobileTherapists } from '../src/mobile.js';
import { fixture, booking, customer } from './helpers/experience-fixture.js';

test('mobile bootstrap publishes current supported areas and explicitly unavailable capabilities', () =>
  fixture(async (e) => {
    const bootstrap = await mobileBootstrap(e);
    assert.equal(bootstrap.currency, 'JPY');
    // Device-side distance and shop promotions are live; coupons and stored value stay off.
    assert.deepEqual(bootstrap.features, {
      coupons: false,
      storedValue: false,
      nativeApp: false,
      gpsDistance: true,
      promotions: true,
    });
    assert.ok(bootstrap.serviceAreas.includes('shinjuku'));
    await e.repo.transaction(async (tx) => {
      for (const listing of await tx.list<Listing>('listings'))
        await tx.put('listings', { ...listing, publicationStatus: 'SUSPENDED' });
    });
    assert.deepEqual((await mobileBootstrap(e)).serviceAreas, []);
  }));

test('mobile directory combines language, area, duration and multilingual normalized search', () =>
  fixture(async (e) => {
    const page = await mobileTherapists(e, {
      language: 'zh',
      area: 'shinjuku',
      duration: '90',
      search: 'Ｎａｇｉ',
    });
    assert.ok(page.items.length > 0);
    for (const row of page.items) {
      assert.ok(row.listing.languages.includes('zh'));
      assert.ok(row.store.areas.includes('shinjuku'));
      assert.equal(row.offering.durationMinutes, 90);
      assert.equal(row.store.id, 'store-nagi');
      assert.ok(row.earliestAt && row.earliestAt > e.now());
      assert.equal('merchantId' in row.store, false);
      assert.equal('acceptanceRule' in row.store, false);
    }
    assert.equal((await mobileTherapists(e, { search: 'unmatched-person' })).total, 0);
  }));

test('mobile list and quotes use the same current shop nomination fee and travel total', () =>
  fixture(async (e) => {
    await e.repo.transaction(async (tx) => {
      const store = (await tx.get<Store>('stores', 'store-nagi'))!;
      await tx.put('stores', {
        ...store,
        bookingRules: { ...store.bookingRules!, nominationFee: 1350 },
      });
    });
    const page = await mobileTherapists(e, { search: 'Nagi', sort: 'price' });
    for (const row of page.items) {
      assert.equal(row.nominationFee, 1350);
      assert.equal(row.total, row.offering.price + row.offering.transportFee + 1350);
      const quote = await e.quote(customer, {
        listingId: row.listing.id,
        offeringId: row.offering.id,
        bookingMode: 'SCHEDULED',
        nominationType: 'NOMINATED',
        startAt: row.earliestAt!,
        area: 'shinjuku',
        requiredLanguage: '',
      });
      assert.equal(quote.total, row.total);
    }
  }));

test('mobile pagination is stable, non-overlapping and rejects reuse under different filters', () =>
  fixture(async (e) => {
    const first = await mobileTherapists(e, { limit: '2', sort: 'price' });
    assert.equal(first.items.length, 2);
    assert.ok(first.nextCursor);
    const second = await mobileTherapists(e, {
      limit: '2',
      sort: 'price',
      cursor: first.nextCursor!,
    });
    assert.ok(
      second.items.every(
        (row) => !first.items.some((other) => other.listing.id === row.listing.id),
      ),
    );
    await assert.rejects(
      () => mobileTherapists(e, { search: 'Nagi', cursor: first.nextCursor! }),
      (error: any) => error.code === 'INVALID_CURSOR',
    );
    await assert.rejects(
      () => mobileTherapists(e, { cursor: 'not-a-cursor' }),
      (error: any) => error.code === 'INVALID_CURSOR',
    );
    for (const query of [
      { language: 'unknown' },
      { duration: '30' },
      { limit: '999' },
      { area: ['shinjuku'] },
      { search: 'a'.repeat(81) },
    ])
      await assert.rejects(() => mobileTherapists(e, query));
  }));

test('mobile directory excludes withdrawn portraits and orders by actual current availability', () =>
  fixture(async (e) => {
    await e.repo.transaction(async (tx) => {
      const listing = (await tx.get<Listing>('listings', 'listing-aoi'))!;
      await tx.put('listings', { ...listing, portraitConsent: false });
    });
    const page = await mobileTherapists(e, {});
    assert.ok(!page.items.some((row) => row.listing.id === 'listing-aoi'));
    const ordered = await mobileTherapists(e, { sort: 'earliest' });
    assert.ok(
      ordered.items.every(
        (row, i) =>
          i === 0 || (ordered.items[i - 1].earliestAt ?? Infinity) <= (row.earliestAt ?? Infinity),
      ),
    );
  }));

test('closed booking counters use all owned history and keep another customer isolated', () =>
  fixture(async (e) => {
    const b = await booking(e);
    await e.repo.transaction(async (tx) => {
      for (const [id, status, customerId] of [
        ['mine-cancelled', 'CANCELLED', customer.id],
        ['mine-rejected', 'REJECTED', customer.id],
        ['mine-expired', 'EXPIRED', customer.id],
        ['other-cancelled', 'CANCELLED', 'another-customer'],
      ] as const)
        await tx.put<Booking>('bookings', { ...b, id, status, customerId });
    });
    const overview = await e.experience.overview(customer);
    assert.equal(overview.counts.closed, 3);
    assert.equal(overview.counts.active, 1);
  }));

test('free travel selects a qualifying free menu before choosing the lowest total and matches its quote', () =>
  fixture(async (e) => {
    assert.equal((await mobileTherapists(e, { travel: 'free' })).total, 0);
    await e.repo.transaction(async (tx) => {
      const paid = (await tx.get<Offering>('offerings', 'store-nagi-60'))!;
      await tx.put('offerings', { ...paid, id: 'free-travel-60', price: 9000, transportFee: 0 });
      for (const row of await tx.list<Listing>('listings'))
        if (row.storeId === 'store-nagi')
          await tx.put('listings', { ...row, offeringIds: [...row.offeringIds, 'free-travel-60'] });
      const store = (await tx.get<Store>('stores', 'store-nagi'))!;
      await tx.put('stores', {
        ...store,
        bookingRules: { ...store.bookingRules!, nominationFee: 1350 },
      });
    });
    // The cheaper paid menu must remain the normal result, not the free-travel result.
    assert.equal(
      (await mobileTherapists(e, { search: 'Nagi' })).items[0].offering.id,
      'store-nagi-60',
    );
    const q = {
      travel: 'free',
      area: 'taito',
      language: 'zh',
      duration: '60',
      sort: 'earliest',
      limit: '1',
    };
    const first = await mobileTherapists(e, q);
    assert.equal(first.total, 2);
    assert.equal(first.items[0].offering.id, 'free-travel-60');
    assert.equal(first.items[0].total, 10350);
    assert.equal(first.items[0].offering.transportFee, 0);
    const second = await mobileTherapists(e, { ...q, cursor: first.nextCursor! });
    assert.notEqual(second.items[0].listing.id, first.items[0].listing.id);
    assert.equal(second.nextCursor, null);
    await assert.rejects(
      () => mobileTherapists(e, { ...q, travel: 'any', cursor: first.nextCursor! }),
      (error: any) => error.code === 'INVALID_CURSOR',
    );
    const row = first.items[0];
    const quote = await e.quote(customer, {
      listingId: row.listing.id,
      offeringId: row.offering.id,
      bookingMode: 'SCHEDULED',
      nominationType: 'NOMINATED',
      area: 'taito',
      requiredLanguage: 'zh',
      startAt: row.earliestAt!,
    });
    assert.equal(quote.total, row.total);
    assert.equal(quote.transportFee, 0);
    assert.equal((await mobileTherapists(e, { ...q, duration: '90' })).total, 0);
    await assert.rejects(() => mobileTherapists(e, { travel: 'fake' }));
    await e.repo.transaction(async (tx) => {
      const free = (await tx.get<Offering>('offerings', 'free-travel-60'))!;
      await tx.put('offerings', { ...free, active: false });
    });
    assert.equal((await mobileTherapists(e, q)).total, 0);
  }));

test('instant directory keeps duty freshness, supported area, language and booking mode restrictions', () =>
  fixture(async (e, clock) => {
    await e.repo.transaction(async (tx) => {
      for (const row of await tx.list<Listing>('listings'))
        await tx.put('listings', { ...row, onDuty: true, dutyUpdatedAt: clock.now });
    });
    const page = await mobileTherapists(e, {
      mode: 'INSTANT',
      area: 'shinjuku',
      language: 'zh',
      duration: '90',
    });
    assert.ok(page.items.length > 0);
    assert.ok(
      page.items.every(
        (row) =>
          row.listing.onDuty &&
          row.listing.languages.includes('zh') &&
          row.store.acceptanceMode !== 'MANUAL' &&
          row.offering.durationMinutes === 90,
      ),
    );
    clock.now += 4 * 60 * 60000;
    assert.equal((await mobileTherapists(e, { mode: 'INSTANT' })).total, 0);
  }));

test('instant badges reflect the selected menu and actual free time, not another eligible menu', () =>
  fixture(async (e, clock) => {
    await e.repo.transaction(async (tx) => {
      const store = (await tx.get<Store>('stores', 'store-nagi'))!;
      await tx.put('stores', {
        ...store,
        acceptanceRule: {
          ...store.acceptanceRule!,
          offeringIds: ['store-nagi-60'],
        },
      });
      const listing = (await tx.get<Listing>('listings', 'listing-aoi'))!;
      await tx.put('listings', { ...listing, onDuty: true, dutyUpdatedAt: clock.now });
    });
    const query = { search: 'Aoi', area: 'shinjuku' };
    assert.equal(
      (await mobileTherapists(e, { ...query, duration: '90' })).items[0].badges.instantNow,
      false,
    );
    assert.equal(
      (await mobileTherapists(e, { ...query, duration: '60' })).items[0].badges.instantNow,
      true,
    );
    await e.repo.transaction((tx) =>
      tx.interval({
        id: 'occupied',
        staffId: 'staff-aoi',
        startAt: clock.now,
        endAt: clock.now + 3 * 3600000,
        expiresAt: clock.now + 3 * 3600000,
      }),
    );
    assert.equal(
      (await mobileTherapists(e, { ...query, duration: '60' })).items[0].badges.instantNow,
      false,
    );
  }));

test('availability excludes unsupported service areas and languages in both booking modes', () =>
  fixture(async (e) => {
    for (const mode of ['SCHEDULED', 'INSTANT']) {
      assert.equal(
        (await e.availability('listing-ren', 'store-nagi-60', false, 'zh', mode, 'shinjuku')).slots
          .length,
        0,
      );
      assert.equal(
        (await e.availability('listing-aoi', 'store-nagi-60', false, '', mode, 'outside')).slots
          .length,
        0,
      );
    }
  }));
