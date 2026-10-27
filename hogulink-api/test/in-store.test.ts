import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Booking, Quote } from '@hogulink/contracts';
import {
  fixture,
  booking as homeBooking,
  customer,
  shop,
  staff,
  admin,
  start,
} from './helpers/experience-fixture.js';
import { bookingAlertActive } from '../src/governance.js';
import { authorizeAdminRoute } from '../src/admin-access.js';
import { mobileTherapists } from '../src/mobile.js';
import sharp from 'sharp';
import { venueCanServe } from '@hogulink/contracts';

const minute = 60_000;
const code = (value: string) => (e: unknown) => (e as { code?: string }).code === value;
const venueDraft = {
  version: 0,
  enabled: true,
  address: 'Tokyo Shinjuku private test venue',
  area: 'shinjuku',
  latitude: 35.69,
  longitude: 139.7,
  contact: '03-0000-0000',
  directions: 'Near the station',
  photos: ['/images/shop.jpg'],
  businessHours: { startMinute: 540, endMinute: 1320 },
  turnoverMinutes: 15,
  nominationFee: 300,
  cancellationTemplateId: 'FLEXIBLE_2H',
  resources: [{ id: 'bed-1', name: 'Bed 1', active: true }],
};
type E = Parameters<Parameters<typeof fixture>[0]>[0];
async function configure(e: E) {
  const pending = await e.venues.save(shop, venueDraft);
  await e.venues.review(admin, shop.storeId!, {
    version: pending.version,
    decision: 'APPROVED',
    note: 'Checked the real reception location and capacity.',
  });
  await e.venues.staffModes(shop, 'listing-aoi', { modes: ['HOME_VISIT', 'IN_STORE'] });
  await e.venues.staffModes(shop, 'listing-mio', { modes: ['HOME_VISIT', 'IN_STORE'] });
  await e.venues.createOffering(shop, 'store-nagi-60', { version: 1, price: 6000 });
}
const quoteInput = (e: E, startAt = e.now() + 180 * minute) => ({
  listingId: 'listing-aoi',
  offeringId: 'store-nagi-60-in-store',
  fulfillmentMode: 'IN_STORE',
  bookingMode: 'SCHEDULED',
  nominationType: 'NOMINATED',
  startAt,
  requiredLanguage: '',
});
test('unified therapist browsing shows one person with separate mode prices and keeps in-store-only supply', () =>
  fixture(async (e) => {
    await configure(e);
    const home = (
      await mobileTherapists(e, { fulfillmentMode: 'HOME_VISIT', duration: '60' })
    ).items.find((i) => i.listing.id === 'listing-aoi')!;
    const combined = await mobileTherapists(e, { fulfillmentMode: 'ALL', duration: '60' });
    const person = combined.items.find((i) => i.listing.id === 'listing-aoi')!;
    assert.equal(combined.items.filter((i) => i.listing.id === 'listing-aoi').length, 1);
    assert.deepEqual(
      person.modePrices?.map((p) => [p.mode, p.total]),
      [
        ['HOME_VISIT', home.total],
        ['IN_STORE', 6300],
      ],
    );
    const store = (await e.repo.read((tx) => tx.get<any>('stores', shop.storeId!)))!;
    await e.venues.homeVisits(shop, { version: store.ruleVersion, enabled: false });
    const only = (await mobileTherapists(e, { fulfillmentMode: 'ALL', duration: '60' })).items.find(
      (i) => i.listing.id === 'listing-aoi',
    )!;
    assert.equal(only.offering.fulfillmentMode, 'IN_STORE');
    assert.deepEqual(
      only.modePrices?.map((p) => p.mode),
      ['IN_STORE'],
    );
    const first = await mobileTherapists(e, { fulfillmentMode: 'ALL', duration: '60', limit: 1 });
    if (first.nextCursor)
      assert.notEqual(
        (
          await mobileTherapists(e, {
            fulfillmentMode: 'ALL',
            duration: '60',
            limit: 1,
            cursor: first.nextCursor,
          })
        ).items[0].listing.id,
        first.items[0].listing.id,
      );
  }));
async function order(e: E, startAt?: number, listingId = 'listing-aoi') {
  const q = await e.quote(customer, { ...quoteInput(e, startAt), listingId }),
    h = await e.hold(customer, q.id),
    p = await e.authorizeDemo(customer, h.id, true);
  const data = {
    quoteId: q.id,
    holdId: h.id,
    paymentId: p.id,
    contact: { name: 'QA Guest', phone: '090-0000-0000' },
    termsAccepted: true,
    policyVersion: q.cancellationPolicy.version,
  };
  const b = await e.createBooking(customer, data, randomUUID());
  return { b, q, h, data };
}
async function confirmed(e: E) {
  let { b } = await order(e);
  b = await e.accept(shop, b.id, b.version);
  b = await e.ack(staff, b.id, b.version);
  return e.booking(customer, b.id);
}

test('in-store supply requires an approved venue, eligible staff, scheduled mode and its own price', () =>
  fixture(async (e) => {
    await assert.rejects(e.quote(customer, quoteInput(e)));
    await configure(e);
    const q = await e.quote(customer, quoteInput(e));
    assert.equal(q.serviceFee, 6000);
    assert.equal(q.transportFee, 0);
    assert.equal(q.nominationFee, 300);
    assert.equal(q.total, 6300);
    assert.equal(q.area, 'shinjuku');
    assert.equal(q.venue!.address, venueDraft.address);
    await assert.rejects(
      e.quote(customer, { ...quoteInput(e), bookingMode: 'INSTANT' }),
      code('VENUE_UNAVAILABLE'),
    );
    const close = Date.UTC(2026, 9, 18, 12, 30); // 21:30 JST: a full hour exceeds 22:00.
    await assert.rejects(e.quote(customer, quoteInput(e, close)), code('OUTSIDE_BOOKING_HOURS'));
    const publicHome = await e.publicCatalog(),
      publicStore = await e.publicCatalog({ fulfillmentMode: 'IN_STORE' });
    assert.ok(publicHome.offerings.every((o) => o.fulfillmentMode !== 'IN_STORE'));
    assert.ok(publicStore.offerings.every((o) => o.fulfillmentMode === 'IN_STORE'));
    assert.equal(publicStore.stores[0].venue?.capacity, 1);
    assert.equal((publicStore.stores[0].venue as any).resources, undefined);
  }));

test('one reception resource cannot be held twice, including by different staff; expiry and cancellation release it', () =>
  fixture(async (e, clock) => {
    await configure(e);
    const q = await e.quote(customer, quoteInput(e));
    const other = { ...customer, id: 'other-customer' };
    const q2 = await e.quote(other, { ...quoteInput(e), listingId: 'listing-mio' });
    const attempts = await Promise.allSettled([e.hold(customer, q.id), e.hold(other, q2.id)]);
    assert.equal(attempts.filter((x) => x.status === 'fulfilled').length, 1);
    const h = (attempts.find((x) => x.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
    clock.now = h.expiresAt + 1;
    const next = await e.quote(customer, quoteInput(e));
    assert.ok((await e.hold(customer, next.id)).resourceId);
  }));

test('a failed card check releases the reception resource as well as the therapist', () =>
  fixture(async (e) => {
    await configure(e);
    const first = await e.hold(customer, (await e.quote(customer, quoteInput(e))).id);
    await assert.rejects(e.authorizeDemo(customer, first.id, false), code('PAYMENT_FAILED'));
    const other = { ...customer, id: 'other-customer' };
    const q = await e.quote(other, { ...quoteInput(e), listingId: 'listing-mio' });
    assert.equal((await e.hold(other, q.id)).resourceId, first.resourceId);
  }));

test('check-in is private, scoped, versioned and separate from service; full actual duration remains mandatory', () =>
  fixture(async (e, clock) => {
    await configure(e);
    let b = await confirmed(e);
    assert.ok(b.checkInCode);
    assert.equal((await e.booking(staff, b.id)).checkInCode, undefined);
    await assert.rejects(e.event(staff, b.id, b.version, 'EN_ROUTE'), code('INVALID_TRANSITION'));
    await assert.rejects(e.event(staff, b.id, b.version, 'START'));
    clock.now = b.quote.startAt;
    await assert.rejects(
      e.checkIn(customer, b.id, { version: b.version, code: b.checkInCode }),
      code('FORBIDDEN'),
    );
    await assert.rejects(
      e.checkIn(shop, b.id, { version: b.version, code: '000000000000' }),
      code('INVALID_CHECK_IN_CODE'),
    );
    const token = b.checkInCode!;
    b = await e.checkIn(shop, b.id, { version: b.version, code: token });
    assert.ok(b.checkIn);
    assert.equal(b.startedAt, undefined);
    b = await e.event(staff, b.id, b.version, 'START');
    clock.now += 59 * minute;
    await assert.rejects(e.event(staff, b.id, b.version, 'COMPLETE'), code('SERVICE_TOO_SHORT'));
    clock.now += minute;
    b = await e.event(staff, b.id, b.version, 'COMPLETE');
    assert.equal(b.status, 'AWAITING_COMPLETION');
    assert.equal(b.capturedAmount, 0);
    b = await e.completionAction(
      customer,
      b.id,
      { version: b.version, action: 'CONFIRM', expectedAmount: b.quote.total },
      randomUUID(),
    );
    assert.equal(b.status, 'COMPLETED');
    assert.equal(b.capturedAmount, 6300);
  }));

test('a pending venue change cannot silently move reserved customers or remove their resource', () =>
  fixture(async (e) => {
    await configure(e);
    await order(e);
    const s = await e.repo.read((tx) => tx.get<any>('stores', shop.storeId!));
    await assert.rejects(
      e.venues.save(shop, {
        ...venueDraft,
        version: s.venue.version,
        address: 'Different place in Tokyo',
      }),
      code('VENUE_HAS_BOOKINGS'),
    );
    await assert.rejects(
      e.venues.save(shop, {
        ...venueDraft,
        version: s.venue.version,
        resources: [{ id: 'bed-1', name: 'Bed 1', active: false }],
      }),
      code('VENUE_HAS_BOOKINGS'),
    );
  }));

for (const category of ['SERVICE_QUALITY', 'SAFETY'] as const)
  test(`unresolved ordinary ${category} complaints block automatic acceptance`, () =>
    fixture(async (e, clock) => {
      let b = await start(e, clock);
      clock.now = b.startedAt! + b.quote.endAt - b.quote.startAt;
      b = await e.event(staff, b.id, b.version, 'COMPLETE');
      await e.care.create(
        customer,
        {
          bookingId: b.id,
          category,
          subject: 'Service issue',
          description: 'Please investigate the actual service before acceptance.',
        },
        randomUUID(),
      );
      clock.now = b.completion!.confirmBy + 1;
      b = await e.booking(customer, b.id);
      assert.equal(b.completion!.status, 'TIMED_OUT');
      assert.equal(b.capturedAmount, 0);
      assert.equal((await e.completionView(customer, b.id)).autoConfirmationEligible, false);
    }));

test('in-store prices remain independent of home pricing, and cannot acquire a travel fee', () =>
  fixture(async (e) => {
    await configure(e);
    await e.merchant.service(shop, 'store-nagi-60', {
      version: 1,
      price: 9000,
      transportFee: 2000,
      active: true,
    });
    const q = await e.quote(customer, quoteInput(e));
    assert.equal(q.serviceFee, 6000);
    assert.equal(q.transportFee, 0);
    await assert.rejects(
      e.merchant.service(shop, 'store-nagi-60-in-store', {
        version: 1,
        price: 6000,
        transportFee: 2000,
        active: true,
      }),
      code('INVALID_TRANSPORT_FEE'),
    );
  }));

test('in-store-only capability does not break existing home orders or allow new home quotes', () =>
  fixture(async (e) => {
    await configure(e);
    let existing = await homeBooking(e);
    existing = await e.ack(staff, existing.id, existing.version);
    const store = (await e.repo.read((tx) => tx.get<any>('stores', shop.storeId!)))!;
    await e.venues.homeVisits(shop, { version: store.ruleVersion, enabled: false });
    assert.ok(
      (await e.publicCatalog({ fulfillmentMode: 'IN_STORE' })).stores.some(
        (s) => s.id === shop.storeId,
      ),
    );
    assert.ok(!(await e.publicCatalog()).stores.some((s) => s.id === shop.storeId));
    const q = await e.quote(customer, quoteInput(e, existing.quote.endAt + 60 * minute));
    assert.equal(q.fulfillmentMode, 'IN_STORE');
    assert.equal(
      (await e.event(staff, existing.id, existing.version, 'EN_ROUTE')).status,
      'EN_ROUTE',
    );
    await assert.rejects(
      e.quote(customer, {
        ...quoteInput(e),
        fulfillmentMode: 'HOME_VISIT',
        offeringId: 'store-nagi-60',
        area: 'shinjuku',
      }),
      code('OUTSIDE_SERVICE_AREA'),
    );
  }));

test('customer lateness cannot push a full session into another reserved reception slot', () =>
  fixture(async (e, clock) => {
    await configure(e);
    let first = await confirmed(e);
    let second = (await order(e, first.quote.endAt + 30 * minute, 'listing-mio')).b;
    second = await e.accept(shop, second.id, second.version);
    await e.ack({ ...staff, id: 'quality-mio', staffId: 'staff-mio' }, second.id, second.version);
    clock.now = first.quote.startAt + 45 * minute;
    first = await e.booking(customer, first.id);
    first = await e.checkIn(shop, first.id, { version: first.version, code: first.checkInCode });
    await assert.rejects(
      e.event(staff, first.id, first.version, 'START'),
      code('RESOURCE_UNAVAILABLE'),
    );
    assert.equal((await e.booking(customer, first.id)).startedAt, undefined);
  }));

test('a late in-store start cannot silently shorten service to fit closing time', () =>
  fixture(async (e, clock) => {
    await configure(e);
    let b = (await order(e, Date.UTC(2026, 9, 18, 12))).b; // 21:00 JST.
    b = await e.accept(shop, b.id, b.version);
    b = await e.ack(staff, b.id, b.version);
    clock.now = b.quote.startAt + 30 * minute;
    b = await e.booking(customer, b.id);
    b = await e.checkIn(shop, b.id, { version: b.version, code: b.checkInCode });
    await assert.rejects(e.event(staff, b.id, b.version, 'START'), code('OUTSIDE_BOOKING_HOURS'));
  }));

test('recorded arrival dismisses an in-store no-show report and prevents its fee', () =>
  fixture(async (e, clock) => {
    await configure(e);
    let b = await confirmed(e);
    const token = b.checkInCode;
    clock.now = b.quote.startAt;
    b = await e.booking(customer, b.id);
    const act = (action: string) =>
      e.noShowAction(
        shop,
        b.id,
        {
          version: b.version,
          action,
          text: 'Contacted the customer and recorded the actual appointment facts.',
        },
        randomUUID(),
      );
    b = await act('CONTACT');
    clock.now += 2 * minute;
    b = await act('CONTACT');
    clock.now = b.noShow!.waitUntil;
    b = await act('REPORT');
    b = await e.checkIn(shop, b.id, { version: b.version, code: token });
    assert.equal(b.noShow!.status, 'DISMISSED');
    await assert.rejects(act('CONFIRM'), code('INVALID_STATE'));
    assert.equal(b.capturedAmount, 0);
  }));

test('service mode is immutable in the database after an order is submitted', () =>
  fixture(async (e) => {
    await configure(e);
    const { b } = await order(e);
    await assert.rejects(
      e.repo.transaction(async (tx) => {
        const row = (await tx.get<Booking>('bookings', b.id))!;
        row.quote.fulfillmentMode = 'HOME_VISIT';
        await tx.put('bookings', row);
      }),
      /Immutable service mode/,
    );
    assert.equal((await e.booking(customer, b.id)).quote.fulfillmentMode, 'IN_STORE');
  }));

test('weekly and exceptional closures are shared by quote and availability', () =>
  fixture(async (e) => {
    await configure(e);
    const store = (await e.repo.read((tx) => tx.get<any>('stores', shop.storeId!)))!;
    const venue = await e.venues.save(shop, {
      ...venueDraft,
      version: store.venue.version,
      closedDates: ['2026-10-18'],
      closedWeekdays: [1],
    });
    // Closures are operating settings: they apply at once without another review.
    assert.equal(venue.status, 'APPROVED');
    await assert.rejects(e.quote(customer, quoteInput(e)), code('OUTSIDE_BOOKING_HOURS'));
    const { slots } = await e.availability(
      'listing-aoi',
      'store-nagi-60-in-store',
      false,
      '',
      'SCHEDULED',
      '',
      'IN_STORE',
    );
    assert.ok(slots.length);
    assert.ok(
      slots.every(
        (t) =>
          !['2026-10-18', '2026-10-19'].includes(
            new Date(t + 9 * 60 * minute).toISOString().slice(0, 10),
          ),
      ),
    );
  }));

test('shop-arranged visits retain the reception resource through assignment and release it on cancellation', () =>
  fixture(async (e) => {
    await configure(e);
    const q = await e.quote(customer, { ...quoteInput(e), nominationType: 'FREE' });
    const h = await e.hold(customer, q.id),
      p = await e.authorizeDemo(customer, h.id, true);
    let b = await e.createBooking(
      customer,
      {
        quoteId: q.id,
        holdId: h.id,
        paymentId: p.id,
        contact: { name: 'QA Guest', phone: '090-0000-0000' },
        termsAccepted: true,
        policyVersion: q.cancellationPolicy.version,
      },
      randomUUID(),
    );
    assert.equal(b.selectedStaffId, null);
    assert.equal(q.nominationFee, 0);
    b = await e.accept(shop, b.id, b.version);
    b = await e.assign(shop, b.id, b.version, 'listing-mio');
    b = await e.ack({ ...staff, id: 'quality-mio', staffId: 'staff-mio' }, b.id, b.version);
    b = await e.booking(customer, b.id);
    assert.equal(b.resourceId, h.resourceId);
    const preview = await e.cancellationPreview(shop, b.id);
    b = await e.cancel(shop, b.id, preview.bookingVersion, false, preview.fee);
    assert.equal(b.status, 'CANCELLED');
    const next = await e.quote(customer, quoteInput(e));
    assert.ok(await e.hold(customer, next.id));
  }));

test('one natural person needs travel time between in-store visits at different shops', () =>
  fixture(async (e) => {
    await configure(e);
    const first = (await order(e)).b;
    const secondShop = { ...shop, id: 'quality-mori', storeId: 'store-mori' };
    const source = (await e.repo.read((tx) => tx.get<any>('listings', 'listing-aoi')))!;
    await e.repo.transaction((tx) =>
      tx.put('listings', {
        ...source,
        id: 'listing-aoi-mori',
        slug: 'aoi-mori',
        storeId: 'store-mori',
        offeringIds: ['store-mori-60'],
        fulfillmentModes: ['IN_STORE'],
      }),
    );
    const venue = await e.venues.save(secondShop, {
      ...venueDraft,
      address: 'Different QA shop in Shibuya',
      area: 'shibuya',
    });
    await e.venues.review(admin, secondShop.storeId, {
      version: venue.version,
      decision: 'APPROVED',
      note: 'Verified this second test venue.',
    });
    await e.venues.createOffering(secondShop, 'store-mori-60', { version: 1, price: 6000 });
    const next = {
      ...quoteInput(e),
      listingId: 'listing-aoi-mori',
      offeringId: 'store-mori-60-in-store',
      startAt: first.quote.endAt + 15 * minute,
    };
    await assert.rejects(e.quote(customer, next), code('SLOT_CONFLICT'));
    assert.ok(await e.quote(customer, { ...next, startAt: first.quote.endAt + 30 * minute }));
  }));

test('platform attendance alerts distinguish unchecked guests from delayed service without assigning blame', () =>
  fixture(async (e, clock) => {
    await configure(e);
    let b = await confirmed(e);
    clock.now = b.quote.startAt + 20 * minute;
    b = await e.booking(customer, b.id);
    assert.equal(bookingAlertActive('STORE_CHECK_IN_DUE', b, clock.now), true);
    assert.equal(bookingAlertActive('LATE_ARRIVAL', b, clock.now), false);
    assert.ok(
      (await e.governance.monitor(admin)).alerts.some(
        (a) => a.bookingId === b.id && a.kind === 'STORE_CHECK_IN_DUE',
      ),
    );
    b = await e.checkIn(shop, b.id, { version: b.version, code: b.checkInCode });
    assert.equal(bookingAlertActive('STORE_CHECK_IN_DUE', b, clock.now), false);
    assert.equal(bookingAlertActive('STORE_START_DELAYED', b, clock.now), true);
    assert.equal(b.capturedAmount, 0);
    assert.equal(b.noShow, undefined);
  }));

test('checkout rechecks staff service mode after the time was held', () =>
  fixture(async (e) => {
    await configure(e);
    const q = await e.quote(customer, quoteInput(e)),
      h = await e.hold(customer, q.id),
      p = await e.authorizeDemo(customer, h.id, true);
    await e.venues.staffModes(shop, 'listing-aoi', { version: 1, modes: ['HOME_VISIT'] });
    await assert.rejects(
      e.createBooking(
        customer,
        {
          quoteId: q.id,
          holdId: h.id,
          paymentId: p.id,
          contact: { name: 'QA Guest', phone: '090-0000-0000' },
          termsAccepted: true,
          policyVersion: q.cancellationPolicy.version,
        },
        randomUUID(),
      ),
      code('LISTING_UNAVAILABLE'),
    );
    assert.equal((await e.bookings(customer)).length, 0);
  }));

test('late starts extend the person reservation even when another bed is free', () =>
  fixture(async (e, clock) => {
    await configure(e);
    const store = (await e.repo.read((tx) => tx.get<any>('stores', shop.storeId!)))!;
    const venue = await e.venues.save(shop, {
      ...venueDraft,
      version: store.venue.version,
      resources: [...venueDraft.resources, { id: 'bed-2', name: 'Bed 2', active: true }],
    });
    assert.equal(venue.status, 'APPROVED');
    let b = await confirmed(e);
    clock.now = b.quote.startAt + 30 * minute;
    b = await e.booking(customer, b.id);
    b = await e.checkIn(shop, b.id, { version: b.version, code: b.checkInCode });
    b = await e.event(staff, b.id, b.version, 'START');
    await assert.rejects(
      e.quote(customer, quoteInput(e, b.quote.endAt + 15 * minute)),
      code('SLOT_CONFLICT'),
    );
    assert.ok(
      await e.quote(customer, {
        ...quoteInput(e, b.quote.endAt + 15 * minute),
        listingId: 'listing-mio',
      }),
    );
  }));

test('a pending replacement protects the candidate travel gap across shops', () =>
  fixture(async (e) => {
    await configure(e);
    let first = await confirmed(e);
    first = await e.assign(shop, first.id, first.version, 'listing-mio', true);
    assert.equal(first.replacementConsent, 'PENDING');
    const secondShop = { ...shop, id: 'quality-mori', storeId: 'store-mori' };
    const source = (await e.repo.read((tx) => tx.get<any>('listings', 'listing-mio')))!;
    await e.repo.transaction((tx) =>
      tx.put('listings', {
        ...source,
        id: 'listing-mio-mori',
        slug: 'mio-mori',
        storeId: 'store-mori',
        offeringIds: ['store-mori-60'],
        fulfillmentModes: ['IN_STORE'],
      }),
    );
    const venue = await e.venues.save(secondShop, {
      ...venueDraft,
      address: 'Other venue for travel-gap test',
      area: 'shibuya',
    });
    await e.venues.review(admin, secondShop.storeId, {
      version: venue.version,
      decision: 'APPROVED',
      note: 'Verified this second test venue.',
    });
    await e.venues.createOffering(secondShop, 'store-mori-60', { version: 1, price: 6000 });
    const q = {
      ...quoteInput(e),
      listingId: 'listing-mio-mori',
      offeringId: 'store-mori-60-in-store',
      startAt: first.quote.endAt + 15 * minute,
    };
    await assert.rejects(e.quote(customer, q), code('SLOT_CONFLICT'));
    assert.ok(await e.quote(customer, { ...q, startAt: first.quote.endAt + 30 * minute }));
  }));

test('a new in-store shop can pause home supply while its venue is being reviewed', () =>
  fixture(async (e) => {
    const store = (await e.repo.read((tx) => tx.get<any>('stores', shop.storeId!)))!;
    await e.venues.homeVisits(shop, { version: store.ruleVersion, enabled: false });
    assert.ok(!(await e.publicCatalog()).stores.some((s) => s.id === shop.storeId));
    await assert.rejects(
      e.availability('listing-aoi', 'store-nagi-60'),
      code('LISTING_UNAVAILABLE'),
    );
    await configure(e);
    assert.ok(
      (await e.publicCatalog({ fulfillmentMode: 'IN_STORE' })).stores.some(
        (s) => s.id === shop.storeId,
      ),
    );
    assert.ok(!(await e.publicCatalog()).stores.some((s) => s.id === shop.storeId));
  }));

test('the shop resource calendar shows temporary holds, reception and cleaning without leaking customer data', () =>
  fixture(async (e, clock) => {
    await configure(e);
    const q = await e.quote(customer, quoteInput(e)),
      h = await e.hold(customer, q.id),
      date = new Date(q.startAt + 9 * 60 * minute).toISOString().slice(0, 10);
    let calendar = await e.venues.calendar(shop, { date });
    assert.ok(
      calendar.entries.some(
        (row) => row.phase === 'CHECKOUT_HOLD' && row.resourceId === h.resourceId,
      ),
    );
    await assert.rejects(e.venues.calendar(customer, { date }), code('FORBIDDEN'));
    assert.equal(
      (await e.venues.calendar({ ...shop, storeId: 'store-mori' }, { date })).entries.length,
      0,
    );
    const p = await e.authorizeDemo(customer, h.id, true);
    let b = await e.createBooking(
      customer,
      {
        quoteId: q.id,
        holdId: h.id,
        paymentId: p.id,
        contact: { name: 'QA Guest', phone: '090-0000-0000' },
        termsAccepted: true,
        policyVersion: q.cancellationPolicy.version,
      },
      randomUUID(),
    );
    assert.equal(b.resourceName, 'Bed 1');
    b = await e.accept(shop, b.id, b.version);
    b = await e.ack(staff, b.id, b.version);
    clock.now = b.quote.startAt;
    b = await e.booking(customer, b.id);
    b = await e.checkIn(shop, b.id, { version: b.version, code: b.checkInCode });
    assert.ok(
      (await e.venues.calendar(shop, { date })).entries.some(
        (row) => row.bookingId === b.id && row.phase === 'CHECKED_IN',
      ),
    );
    b = await e.event(staff, b.id, b.version, 'START');
    clock.now = b.startedAt! + b.quote.endAt - b.quote.startAt;
    b = await e.event(staff, b.id, b.version, 'COMPLETE');
    calendar = await e.venues.calendar(shop, { date });
    assert.ok(calendar.entries.some((row) => row.phase === 'CLEANING'));
    const json = JSON.stringify(calendar);
    for (const secret of ['customerId', 'checkInCode', 'QA Guest', '090-0000-0000'])
      assert.ok(!json.includes(secret));
  }));

test('an unfinished service remains on the bed calendar after its planned day', () =>
  fixture(async (e, clock) => {
    await configure(e);
    let b = await confirmed(e);
    clock.now = b.quote.startAt;
    b = await e.checkIn(shop, b.id, { version: b.version, code: b.checkInCode });
    b = await e.event(staff, b.id, b.version, 'START');
    clock.now = b.quote.startAt + 2 * 86400000;
    const date = new Date(clock.now + 9 * 60 * minute).toISOString().slice(0, 10);
    const row = (await e.venues.calendar(shop, { date })).entries.find(
      (row) => row.bookingId === b.id,
    );
    assert.equal(row?.phase, 'IN_SERVICE');
    assert.ok(row?.ongoing && row.endAt > clock.now);
    await assert.rejects(e.venues.calendar(shop, { date: '2026-02-30' }), code('INVALID_TIME'));
  }));

test('legacy pending orders do not acquire automatic acceptance on upgrade', () =>
  fixture(async (e, clock) => {
    let b = await start(e, clock);
    clock.now = b.startedAt! + b.quote.endAt - b.quote.startAt;
    b = await e.event(staff, b.id, b.version, 'COMPLETE');
    await e.repo.transaction(async (tx) => {
      const old = (await tx.get<Booking>('bookings', b.id))!;
      delete old.quote.completionPolicy;
      old.completion!.confirmBy = old.completion!.endedAt + 24 * 60 * minute;
      await tx.put('bookings', old);
    });
    clock.now = b.completion!.endedAt + 24 * 60 * minute + 1;
    b = await e.booking(customer, b.id);
    assert.equal(b.completion!.status, 'TIMED_OUT');
    assert.equal(b.capturedAmount, 0);
  }));

const quality = { ...staff, id: 'quality-mio', staffId: 'staff-mio' };
async function lateArrivalSetup(e: E) {
  await configure(e);
  const first = await confirmed(e);
  // Another customer has the only bed 30 minutes after the first session's planned end.
  let second = (await order(e, first.quote.endAt + 30 * minute, 'listing-mio')).b;
  second = await e.accept(shop, second.id, second.version);
  await e.ack(quality, second.id, second.version);
  return first;
}
const closeLate = (e: E, b: Booking) =>
  e.closeLateArrival(shop, b.id, {
    version: b.version,
    note: 'Customer arrived too late for the full purchased session.',
  });

test('an approved venue keeps taking bookings while changed facts are reviewed', () =>
  fixture(async (e) => {
    await configure(e);
    let store = (await e.repo.read((tx) => tx.get<any>('stores', shop.storeId!)))!;
    const pending = await e.venues.save(shop, {
      ...venueDraft,
      version: store.venue.version,
      directions: 'Second floor, east exit',
    });
    assert.equal(pending.status, 'PENDING');
    store = (await e.repo.read((tx) => tx.get<any>('stores', shop.storeId!)))!;
    assert.equal(store.venue.status, 'APPROVED');
    assert.equal(store.venue.directions, venueDraft.directions);
    // Customers keep booking the published venue during the review.
    const q = await e.quote(customer, quoteInput(e));
    assert.equal(q.venue!.directions, venueDraft.directions);
    const listed = (await e.venues.list(admin)).find((x) => x.storeId === shop.storeId)!;
    assert.equal(listed.venue.status, 'PENDING');
    assert.equal(listed.live!.directions, venueDraft.directions);
    const rejected = await e.venues.review(admin, shop.storeId!, {
      version: pending.version,
      decision: 'REJECTED',
      note: 'Directions do not match the building.',
    });
    store = (await e.repo.read((tx) => tx.get<any>('stores', shop.storeId!)))!;
    assert.equal(store.venue.status, 'APPROVED');
    // Sending the same rejected facts again does not queue another review.
    const again = await e.venues.save(shop, {
      ...venueDraft,
      version: rejected.version,
      directions: 'Second floor, east exit',
    });
    assert.equal(again.status, 'REJECTED');
    const fixed = await e.venues.save(shop, {
      ...venueDraft,
      version: again.version,
      directions: 'Second floor, east exit of Shinjuku station',
    });
    assert.equal(fixed.status, 'PENDING');
    await e.venues.review(admin, shop.storeId!, {
      version: fixed.version,
      decision: 'APPROVED',
      note: 'Checked the corrected directions.',
    });
    assert.equal(
      (await e.quote(customer, quoteInput(e))).venue!.directions,
      'Second floor, east exit of Shinjuku station',
    );
  }));

test('operating settings apply at once but cannot strand existing bookings', () =>
  fixture(async (e) => {
    await configure(e);
    const { b } = await order(e);
    const store = (await e.repo.read((tx) => tx.get<any>('stores', shop.storeId!)))!;
    const day = new Date(b.quote.startAt + 9 * 60 * minute).toISOString().slice(0, 10);
    await assert.rejects(
      e.venues.save(shop, { ...venueDraft, version: store.venue.version, closedDates: [day] }),
      code('VENUE_HAS_BOOKINGS'),
    );
    const updated = await e.venues.save(shop, {
      ...venueDraft,
      version: store.venue.version,
      nominationFee: 800,
    });
    assert.equal(updated.status, 'APPROVED');
    const later = quoteInput(e, b.quote.endAt + 60 * minute);
    assert.equal((await e.quote(customer, later)).nominationFee, 800);
  }));

test('home rule edits and venue edits only expire quotes of their own service mode', () =>
  fixture(async (e) => {
    await configure(e);
    const homeInput = (startAt: number) => ({
      listingId: 'listing-aoi',
      offeringId: 'store-nagi-60',
      bookingMode: 'SCHEDULED',
      nominationType: 'NOMINATED',
      startAt,
      area: 'shinjuku',
      requiredLanguage: '',
    });
    const readStore = async () =>
      (await e.repo.read((tx) => tx.get<any>('stores', shop.storeId!)))!;
    const inStoreQuote = await e.quote(customer, quoteInput(e));
    const homeQuote = await e.quote(customer, homeInput(e.now() + 300 * minute));
    const rules = (await readStore()).bookingRules;
    await e.merchant.bookingRules(shop, {
      version: rules?.version ?? 0,
      nominationFee: 1500,
      templateId: 'FLEXIBLE_2H',
    });
    await e.hold(customer, inStoreQuote.id);
    await assert.rejects(e.hold(customer, homeQuote.id), code('SHOP_RULES_CHANGED'));
    const nextHome = await e.quote(customer, homeInput(e.now() + 420 * minute));
    const nextInStore = await e.quote(customer, quoteInput(e, e.now() + 540 * minute));
    await e.venues.save(shop, {
      ...venueDraft,
      version: (await readStore()).venue.version,
      nominationFee: 700,
    });
    assert.equal((await e.hold(customer, nextHome.id)).quoteId, nextHome.id);
    await assert.rejects(e.hold(customer, nextInStore.id), code('SHOP_RULES_CHANGED'));
  }));

test('venue photos must be platform uploads and become public only with an approved venue', () =>
  fixture(async (e) => {
    await configure(e);
    let store = (await e.repo.read((tx) => tx.get<any>('stores', shop.storeId!)))!;
    await assert.rejects(
      e.venues.save(shop, {
        ...venueDraft,
        version: store.venue.version,
        photos: ['https://example.com/front.jpg'],
      }),
    );
    const png = await sharp({
      create: { width: 12, height: 8, channels: 3, background: '#d7e4dc' },
    })
      .png()
      .toBuffer();
    const upload = await e.venues.uploadPhoto(shop, {
      mime: 'image/png',
      data: png.toString('base64'),
    });
    const photoId = upload.url.split('/').at(-1)!;
    await assert.rejects(e.venues.photo(photoId), code('NOT_FOUND'));
    assert.equal((await e.venues.photo(photoId, shop)).published, false);
    const secondShop = { ...shop, id: 'quality-mori', storeId: 'store-mori' };
    await assert.rejects(
      e.venues.save(secondShop, { ...venueDraft, photos: [upload.url] }),
      code('INVALID_PHOTO'),
    );
    const pending = await e.venues.save(shop, {
      ...venueDraft,
      version: store.venue.version,
      photos: [upload.url],
    });
    // Unreviewed while the draft waits; the reviewer can still see it.
    await assert.rejects(e.venues.photo(photoId), code('NOT_FOUND'));
    assert.ok((await e.venues.photo(photoId, admin)).bytes.length);
    await e.venues.review(admin, shop.storeId!, {
      version: pending.version,
      decision: 'APPROVED',
      note: 'Photo matches the reception area.',
    });
    store = (await e.repo.read((tx) => tx.get<any>('stores', shop.storeId!)))!;
    assert.deepEqual(store.venue.photos, [upload.url]);
    assert.equal((await e.venues.photo(photoId)).published, true);
  }));

test('a late home visit still starts when the next visit leaves no room', () =>
  fixture(async (e, clock) => {
    const at = Date.UTC(2026, 9, 18, 3); // 12:00 JST.
    let b = await homeBooking(e, { startAt: at });
    let next = await homeBooking(e, { startAt: at + 120 * minute });
    b = await e.ack(staff, b.id, b.version);
    next = await e.ack(staff, next.id, next.version);
    clock.now = at + 5 * minute;
    for (const event of ['EN_ROUTE', 'ARRIVED', 'START'])
      b = await e.event(staff, b.id, b.version, event);
    assert.equal(b.status, 'IN_SERVICE');
    assert.equal(b.startedAt, clock.now);
  }));

test('an overrunning visit blocks the next hours but not later days', () =>
  fixture(async (e, clock) => {
    const b = await start(e, clock);
    clock.now = b.quote.endAt + 10 * minute;
    const home = (startAt: number) =>
      e.quote(customer, {
        listingId: 'listing-aoi',
        offeringId: 'store-nagi-60',
        bookingMode: 'SCHEDULED',
        nominationType: 'NOMINATED',
        startAt,
        area: 'shinjuku',
        requiredLanguage: '',
      });
    await assert.rejects(home(clock.now + 20 * minute), code('SLOT_CONFLICT'));
    assert.ok(await home(Date.UTC(2026, 9, 25, 5))); // Next week, 14:00 JST.
  }));

test('closures of a venue open past midnight follow the business day', () => {
  const venue = {
    businessHours: { startMinute: 18 * 60, endMinute: 4 * 60 },
    closedWeekdays: [6],
    closedDates: [],
  };
  const jst = (day: number, hour: number) => Date.UTC(2026, 9, day, hour - 9);
  // 2026-10-23 is a Friday; Saturday is the closing day.
  assert.equal(venueCanServe(venue, jst(23, 20), jst(23, 21)), true);
  assert.equal(venueCanServe(venue, jst(24, 1), jst(24, 2)), true, 'Friday night after midnight');
  assert.equal(venueCanServe(venue, jst(24, 20), jst(24, 21)), false, 'Saturday evening');
  assert.equal(venueCanServe(venue, jst(25, 1), jst(25, 2)), false, 'Saturday night');
  const allDay = { ...venue, businessHours: { startMinute: 0, endMinute: 1440 } };
  assert.equal(venueCanServe(allDay, jst(23, 23), jst(24, 0) + 30 * minute), false);
});

test('a customer who arrived too late for the full session can be closed under the booked terms', () =>
  fixture(async (e, clock) => {
    let first = await lateArrivalSetup(e);
    clock.now = first.quote.startAt + 45 * minute;
    first = await e.booking(customer, first.id);
    first = await e.checkIn(shop, first.id, { version: first.version, code: first.checkInCode });
    await assert.rejects(
      e.event(staff, first.id, first.version, 'START'),
      code('RESOURCE_UNAVAILABLE'),
    );
    first = await closeLate(e, first);
    assert.equal(first.status, 'CANCELLED');
    assert.equal(first.cancelReason, 'CUSTOMER_LATE_ARRIVAL');
    // FLEXIBLE_2H: a cancellation at the booked start costs 30% of the order.
    assert.equal(first.capturedAmount, Math.floor(first.quote.total * 0.3));
  }));

test('late-arrival closure is refused for a guest who arrived on time', () =>
  fixture(async (e, clock) => {
    let first = await lateArrivalSetup(e);
    clock.now = first.quote.startAt;
    first = await e.booking(customer, first.id);
    first = await e.checkIn(shop, first.id, { version: first.version, code: first.checkInCode });
    await assert.rejects(closeLate(e, first), code('NOT_LATE'));
  }));

test('a slightly late guest kept waiting by the shop is not charged for late arrival', () =>
  fixture(async (e, clock) => {
    let first = await lateArrivalSetup(e);
    // A full session still fitted at check-in; the shop then waited until it no longer did.
    clock.now = first.quote.startAt + 5 * minute;
    first = await e.booking(customer, first.id);
    first = await e.checkIn(shop, first.id, { version: first.version, code: first.checkInCode });
    clock.now = first.quote.startAt + 45 * minute;
    await assert.rejects(closeLate(e, first), code('SERVICE_STILL_POSSIBLE'));
    assert.equal((await e.booking(customer, first.id)).capturedAmount, 0);
  }));

test('the customer can reply to an in-store no-show report before any fee', () =>
  fixture(async (e, clock) => {
    await configure(e);
    for (const reply of [false, true]) {
      const startAt = Date.UTC(2026, 9, reply ? 20 : 19, 3); // 12:00 JST.
      let { b } = await order(e, startAt);
      b = await e.accept(shop, b.id, b.version);
      b = await e.ack(staff, b.id, b.version);
      clock.now = b.quote.startAt;
      b = await e.booking(customer, b.id);
      const act = async (action: string) =>
        (b = await e.noShowAction(
          shop,
          b.id,
          {
            version: b.version,
            action,
            text: 'Called the customer and waited at the reception desk.',
          },
          randomUUID(),
        ));
      await act('CONTACT');
      clock.now += 2 * minute;
      await act('CONTACT');
      clock.now = b.noShow!.waitUntil;
      await act('REPORT');
      await assert.rejects(act('CONFIRM'), code('NO_SHOW_NOT_READY'));
      if (reply) {
        await e.messages(customer, b.id, 'I was at the reception at the booked time.');
        clock.now += 30 * minute;
        b = await e.booking(shop, b.id);
        await assert.rejects(act('CONFIRM'), code('CUSTOMER_RESPONDED'));
      } else {
        clock.now += 30 * minute;
        await act('CONFIRM');
        assert.equal(b.noShow!.status, 'CONFIRMED');
      }
    }
  }));

test('the assigned therapist can check in an in-store customer; other therapists cannot', () =>
  fixture(async (e, clock) => {
    await configure(e);
    let b = await confirmed(e);
    clock.now = b.quote.startAt;
    b = await e.booking(customer, b.id);
    const code12 = b.checkInCode!;
    b = await e.booking(staff, b.id);
    await assert.rejects(
      e.checkIn(quality, b.id, { version: b.version, code: code12 }),
      (err: any) => ['FORBIDDEN', 'NOT_FOUND'].includes(err.code),
    );
    b = await e.checkIn(staff, b.id, { version: b.version, code: code12 });
    assert.equal(b.checkIn!.actorId, staff.id);
  }));

test('the platform can pause a venue: no new in-store bookings, existing ones continue', () =>
  fixture(async (e, clock) => {
    await configure(e);
    let b = await confirmed(e);
    const note = { note: 'Investigating a report about the reception room.' };
    await e.venues.suspend(admin, shop.storeId!, { suspended: true, ...note });
    await assert.rejects(
      e.quote(customer, quoteInput(e, b.quote.endAt + 60 * minute)),
      code('VENUE_UNAVAILABLE'),
    );
    assert.ok(
      !(await e.publicCatalog({ fulfillmentMode: 'IN_STORE' })).stores.some(
        (s) => s.id === shop.storeId,
      ),
    );
    const anyMode = (await e.publicCatalog({ fulfillmentMode: 'ALL' })).stores.find(
      (s) => s.id === shop.storeId,
    );
    assert.equal(anyMode?.venue, undefined, 'a paused venue is not shown publicly');
    // An operating edit by the shop keeps the platform pause.
    const store = (await e.repo.read((tx) => tx.get<any>('stores', shop.storeId!)))!;
    await e.venues.save(shop, { ...venueDraft, version: store.venue.version, nominationFee: 400 });
    assert.ok((await e.repo.read((tx) => tx.get<any>('stores', shop.storeId!)))!.venue.suspension);
    // The booked customer is still served.
    clock.now = b.quote.startAt;
    b = await e.booking(customer, b.id);
    b = await e.checkIn(shop, b.id, { version: b.version, code: b.checkInCode });
    b = await e.event(staff, b.id, b.version, 'START');
    assert.equal(b.status, 'IN_SERVICE');
    await e.venues.suspend(admin, shop.storeId!, { suspended: false, ...note });
    assert.ok(await e.quote(customer, quoteInput(e, b.quote.endAt + 120 * minute)));
  }));

test('operations staff may review venues; support staff may not change them', () => {
  const operations = { ...admin, adminRole: 'OPERATIONS' as const };
  const support = { ...admin, adminRole: 'SUPPORT' as const };
  assert.doesNotThrow(() => authorizeAdminRoute(operations, 'admin/venues', 'GET'));
  assert.doesNotThrow(() =>
    authorizeAdminRoute(operations, 'admin/venues/store-nagi/review', 'POST'),
  );
  assert.throws(() => authorizeAdminRoute(support, 'admin/venues/store-nagi/suspension', 'POST'));
  assert.doesNotThrow(() => authorizeAdminRoute(operations, 'admin/shop-quality', 'GET'));
});

test('venue address search returns Japanese coordinates only and degrades when unavailable', () =>
  fixture(async (e) => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify([
            {
              geometry: { coordinates: [139.6917, 35.6895] },
              properties: { title: '東京都新宿区西新宿二丁目' },
            },
            { geometry: { coordinates: [2.35, 48.85] }, properties: { title: 'Paris' } },
          ]),
          { status: 200 },
        )) as typeof fetch;
      const rows = await e.venues.geocode(shop, { q: '東京都新宿区西新宿2-8-1' });
      assert.deepEqual(rows, [
        { latitude: 35.6895, longitude: 139.6917, label: '東京都新宿区西新宿二丁目' },
      ]);
      await assert.rejects(e.venues.geocode(customer, { q: '東京都新宿区' }), code('FORBIDDEN'));
      globalThis.fetch = (async () => {
        throw new Error('offline');
      }) as typeof fetch;
      await assert.rejects(
        e.venues.geocode(shop, { q: '東京都新宿区' }),
        code('GEOCODE_UNAVAILABLE'),
      );
    } finally {
      globalThis.fetch = original;
    }
  }));
