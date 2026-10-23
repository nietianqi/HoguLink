import test from 'node:test';
import assert from 'node:assert/strict';
import type { Listing, Offering } from '@hogulink/contracts';
import { featuredDemoOfferings, seedDemoServices } from '../src/seed.js';
import { customer, fixture } from './helpers/experience-fixture.js';

test('additional demo menus have three-language names, authorized members and bookable quoted prices', () =>
  fixture(async (engine) => {
    await seedDemoServices(engine.repo);
    const catalog = await engine.publicCatalog();
    assert.equal(catalog.offerings.length, 15);
    for (const sample of featuredDemoOfferings) {
      const offering = catalog.offerings.find((o) => o.id === sample.id)!;
      assert(offering);
      for (const locale of ['ja', 'en', 'zh-cn'] as const) assert(offering.name[locale].length);
      const member = catalog.listings.find(
        (l) => l.storeId === offering.storeId && l.offeringIds.includes(offering.id),
      )!;
      assert(member);
      const available = await engine.availability(
        member.id,
        offering.id,
        false,
        '',
        'SCHEDULED',
        'shinjuku',
      );
      assert(available.slots.length > 0);
      const quote = await engine.quote(customer, {
        listingId: member.id,
        offeringId: offering.id,
        bookingMode: 'SCHEDULED',
        nominationType: 'NOMINATED',
        startAt: available.slots[0],
        area: 'shinjuku',
        requiredLanguage: '',
      });
      assert.equal(quote.total, offering.price + offering.transportFee + 500);
    }
    assert.equal((await engine.repo.read((tx) => tx.list('bookings'))).length, 0);
  }));

test('demo expansion is idempotent and preserves changed prices, membership, acceptance rules and existing records', () =>
  fixture(async (engine) => {
    const before = await engine.repo.read((tx) => tx.get('stores', 'store-nagi'));
    await engine.repo.transaction((tx) =>
      tx.put('demoServiceSentinel', { id: 'existing', value: 'keep' }),
    );
    await seedDemoServices(engine.repo);
    await engine.repo.transaction(async (tx) => {
      const offering = (await tx.get<Offering>('offerings', featuredDemoOfferings[0].id))!;
      await tx.put('offerings', { ...offering, price: 9900, approved: false, version: 2 });
      const listing = (await tx.get<Listing>('listings', 'listing-yuki'))!;
      await tx.put('listings', {
        ...listing,
        membershipActive: false,
        offeringIds: ['store-mori-60'],
      });
    });
    await seedDemoServices(engine.repo);
    const after = await engine.repo.read(async (tx) => ({
      menus: await tx.list<Offering>('offerings'),
      member: await tx.get<Listing>('listings', 'listing-yuki'),
      store: await tx.get('stores', 'store-nagi'),
      sentinel: await tx.get('demoServiceSentinel', 'existing'),
    }));
    assert.equal(after.menus.length, 15);
    assert.equal(after.menus.find((o) => o.id === featuredDemoOfferings[0].id)?.price, 9900);
    assert.equal(after.menus.find((o) => o.id === featuredDemoOfferings[0].id)?.approved, false);
    assert.equal(after.member?.membershipActive, false);
    assert.deepEqual(after.member?.offeringIds, ['store-mori-60']);
    assert.deepEqual(after.store, before);
    assert.deepEqual(after.sentinel, { id: 'existing', value: 'keep' });
  }));

test('demo expansion does not authorize a moved or inactive member', () =>
  fixture(async (engine) => {
    await engine.repo.transaction(async (tx) => {
      const moved = (await tx.get<Listing>('listings', 'listing-yuki'))!;
      await tx.put('listings', { ...moved, storeId: 'store-nagi' });
      const inactive = (await tx.get<Listing>('listings', 'listing-saki'))!;
      await tx.put('listings', { ...inactive, membershipActive: false });
    });
    await seedDemoServices(engine.repo);
    const result = await engine.repo.read(async (tx) => ({
      menus: await tx.list<Offering>('offerings'),
      moved: await tx.get<Listing>('listings', 'listing-yuki'),
      inactive: await tx.get<Listing>('listings', 'listing-saki'),
    }));
    assert(
      !result.menus.some((o) =>
        featuredDemoOfferings.some((s) => s.storeId === 'store-mori' && s.id === o.id),
      ),
    );
    assert(!result.moved?.offeringIds.some((id) => id.includes('-shoulder-')));
    assert.equal(result.inactive?.membershipActive, false);
  }));
