import test from 'node:test';
import assert from 'node:assert/strict';
import type { Actor, Booking, Hold, Listing, Store, SupportTicket } from '@hogulink/contracts';
import { DomainError } from '../src/errors.js';
import {
  booking,
  complete,
  customer,
  fixture,
  reviewScores,
  reviewText,
  shop,
  staff,
  admin,
  moderation,
  start,
} from './helpers/experience-fixture.js';
import { openAllDay } from './helpers/business-hours.js';
const fail = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;
const other: Actor = { ...customer, id: 'other-hub-customer' };
test('completion confirmation remains on customer home while urgent replacement consent keeps priority', () =>
  fixture(async (e, clock) => {
    let done = await start(e, clock);
    clock.now = done.quote.endAt;
    done = await e.event(staff, done.id, done.version, 'COMPLETE');
    assert.equal((await e.experience.overview(customer)).focus?.id, done.id);
    let changed = await booking(e);
    changed = await e.assign(shop, changed.id, changed.version, 'listing-mio', true);
    assert.equal((await e.experience.overview(customer)).focus?.id, changed.id);
    await e.consent(customer, changed.id, changed.version, false);
    const focus = (await e.experience.overview(customer)).focus!;
    assert.equal(focus.id, done.id);
    assert.equal(focus.status, 'AWAITING_COMPLETION');
    assert.equal((await e.booking(customer, done.id)).capturedAmount, 0);
  }));
async function pending(e: Parameters<Parameters<typeof fixture>[0]>[0]) {
  const q = await e.quote(customer, {
    listingId: 'listing-aoi',
    offeringId: 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt: e.now() + 3 * 3600000,
    area: 'shinjuku',
    requiredLanguage: '',
  });
  return e.hold(customer, q.id);
}
test('customer overview starts empty and rejects workspace identities', () =>
  fixture(async (e) => {
    const o = await e.experience.overview(customer);
    assert.deepEqual(o.counts, {
      checkout: 0,
      active: 0,
      review: 0,
      support: 0,
      favorites: 0,
      closed: 0,
      completed: 0,
    });
    assert.deepEqual(o.recent, []);
    assert.deepEqual(o.reviewBookingIds, []);
    for (const actor of [staff, shop, admin])
      await assert.rejects(() => e.experience.overview(actor), fail('FORBIDDEN'));
  }));
test('a resumable checkout is a live unsubmitted hold, never an accepted booking or captured charge', () =>
  fixture(async (e) => {
    const h = await pending(e),
      o = await e.experience.overview(customer);
    assert.equal(o.counts.checkout, 1);
    assert.equal(o.counts.active, 0);
    assert.equal(o.resumeCheckout?.holdId, h.id);
    assert.equal(o.recent.length, 0);
    await e.releaseCheckoutHold(customer, h.id);
    const b = await booking(e);
    const next = await e.experience.overview(customer);
    assert.equal(next.counts.checkout, 0);
    assert.equal(next.counts.active, 1);
    assert.equal(next.recent[0].id, b.id);
    assert.equal(b.capturedAmount, 0);
  }));
test('expired holds and failed authorizations disappear from resume without recreating checkout or bypassing limits', () =>
  fixture(async (e, clock) => {
    const h = await pending(e);
    clock.now = h.expiresAt;
    assert.equal((await e.experience.overview(customer)).counts.checkout, 0);
    const next = await pending(e);
    await assert.rejects(() => e.authorizeDemo(customer, next.id, false), fail('PAYMENT_FAILED'));
    assert.equal((await e.experience.overview(customer)).counts.checkout, 0);
  }));
test('review counters track actionable completed charges and do not count content already under review', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock);
    assert.equal((await e.experience.overview(customer)).counts.review, 1);
    assert.deepEqual((await e.experience.overview(customer)).reviewBookingIds, [b.id]);
    const r = await e.experience.saveReview(customer, b.id, {
      version: 0,
      scores: reviewScores,
      text: reviewText,
    });
    assert.equal((await e.experience.overview(customer)).counts.review, 0);
    assert.deepEqual((await e.experience.overview(customer)).reviewBookingIds, []);
    await e.experience.moderate(admin, 'REVIEW', r.id, {
      ...moderation,
      version: r.version,
      decision: 'REJECT',
    });
    assert.equal((await e.experience.overview(customer)).reviewBookingId, b.id);
    assert.deepEqual((await e.experience.overview(customer)).reviewBookingIds, [b.id]);
    const current = (await e.experience.customerExperience(customer, b.id)).review!;
    await e.experience.withdraw(customer, r.id, { version: current.version });
    assert.equal((await e.experience.overview(customer)).counts.review, 1);
    await e.refund(shop, b.id, b.version, b.capturedAmount);
    assert.equal((await e.experience.overview(customer)).counts.review, 1);
  }));
test('overview is tenant private and never returns address, payment routing, another customer or staff safety tickets', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock);
    await e.repo.transaction(async (tx) => {
      for (const [id, reporterId, reporterRole] of [
        ['own', customer.id, 'CUSTOMER'],
        ['other', other.id, 'CUSTOMER'],
        ['staff-secret', staff.id, 'STAFF'],
      ] as const)
        await tx.put('supportTickets', {
          id,
          customerId: customer.id,
          reporterId,
          reporterRole,
          status: 'OPEN',
          description: 'Private support evidence',
        } as SupportTicket);
      await tx.put('bookings', { ...b, id: 'other-booking', customerId: other.id });
    });
    const o = await e.experience.overview(customer);
    assert.equal(o.counts.support, 1);
    assert.equal(o.recent.length, 1);
    const text = JSON.stringify(o);
    for (const value of [
      'address',
      'room',
      'paymentId',
      'customerId',
      'Private support evidence',
      'other-booking',
    ])
      assert(!text.includes(value), value);
    assert.equal((await e.experience.overview(other)).recent[0].id, 'other-booking');
  }));
test('only active private favorites are counted, independently of booking totals', () =>
  fixture(async (e) => {
    const r = await e.experience.favorite(customer, 'listing-aoi', { version: 0, active: true });
    assert.equal((await e.experience.overview(customer)).counts.favorites, 1);
    assert.equal((await e.experience.overview(other)).counts.favorites, 0);
    await e.experience.favorite(customer, 'listing-aoi', { version: r.version, active: false });
    assert.equal((await e.experience.overview(customer)).counts.favorites, 0);
  }));

test('account cards identify the shop, assigned therapist and service mode without private address details', () =>
  fixture(async (e) => {
    const b = await booking(e);
    const { store, listing } = await e.repo.transaction(async (tx) => ({
      store: (await tx.get<Store>('stores', b.storeId))!,
      listing: (await tx.get<Listing>('listings', 'listing-aoi'))!,
    }));
    let o = await e.experience.overview(customer);
    assert.deepEqual(o.focus?.storeName, store.name);
    assert.deepEqual(o.focus?.therapistName, listing.name);
    assert.equal(o.focus?.therapistPhoto, listing.photo);
    assert.equal(o.focus?.fulfillmentMode, 'HOME_VISIT');
    assert.equal(o.focus?.area, b.quote.area);
    assert.equal(o.focus?.endAt, b.quote.endAt);
    assert(!JSON.stringify(o).includes('Private QA address'));
    assert(!JSON.stringify(o).includes('QA Hotel'));
    await e.repo.transaction(async (tx) => {
      await tx.put('listings', { ...listing, portraitConsent: false });
      await tx.put('bookings', {
        ...b,
        id: 'in-store-summary',
        quote: {
          ...b.quote,
          startAt: b.quote.startAt + 7200000,
          endAt: b.quote.endAt + 7200000,
          fulfillmentMode: 'IN_STORE',
          venue: { area: 'minato' },
        },
      } as Booking);
    });
    o = await e.experience.overview(customer);
    assert.equal(o.focus?.therapistPhoto, undefined);
    assert.equal(o.recent.find((b) => b.id === 'in-store-summary')?.fulfillmentMode, 'IN_STORE');
    assert.equal(o.recent.find((b) => b.id === 'in-store-summary')?.area, 'minato');
    await e.repo.transaction(async (tx) => {
      await tx.put('bookings', {
        ...b,
        id: 'unassigned-summary',
        assignedStaffId: null,
        selectedStaffId: null,
        assignedListingId: null,
        selectedStaffListingId: null,
        quote: { ...b.quote, nominationType: 'FREE' },
      });
    });
    assert.equal(
      (await e.experience.overview(customer)).recent.find((b) => b.id === 'unassigned-summary')
        ?.therapistName['zh-cn'],
      '由店铺安排技师',
    );
  }));

test('review list includes every actionable owned booking and excludes foreign and already submitted reviews', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock);
    await e.repo.transaction(async (tx) => {
      await tx.put('bookings', { ...b, id: 'second-owned' });
      await tx.put('bookings', { ...b, id: 'foreign-completed', customerId: other.id });
    });
    let o = await e.experience.overview(customer);
    assert.deepEqual(new Set(o.reviewBookingIds), new Set([b.id, 'second-owned']));
    assert.equal(o.counts.completed, 2);
    await e.experience.saveReview(customer, b.id, {
      version: 0,
      scores: reviewScores,
      text: reviewText,
    });
    o = await e.experience.overview(customer);
    assert.deepEqual(o.reviewBookingIds, ['second-owned']);
    assert.equal(o.counts.review, 1);
    assert.equal(o.counts.completed, 2);
  }));
test('cancelled charged orders do not create review tasks and recent cards retain their service snapshot', () =>
  fixture(async (e) => {
    const b = await booking(e);
    await e.repo.transaction(async (tx) => {
      await tx.put('bookings', {
        ...b,
        status: 'CANCELLED',
        capturedAmount: 1000,
      } satisfies Booking);
      const o = await tx.get<any>('offerings', b.quote.offeringId);
      await tx.put('offerings', { ...o, name: { ja: '変更', en: 'Renamed', 'zh-cn': '已改名' } });
    });
    const o = await e.experience.overview(customer);
    assert.equal(o.counts.active, 0);
    assert.equal(o.counts.review, 0);
    assert.deepEqual(o.recent[0].serviceName, b.quote.serviceName);
  }));
test('recent orders are bounded and response counts cover the full owned history', () =>
  fixture(async (e, clock) => {
    await openAllDay(e);
    for (let i = 0; i < 4; i++) await complete(e, clock);
    const o = await e.experience.overview(customer);
    assert.equal(o.recent.length, 3);
    assert.equal(o.counts.review, 4);
    assert.equal(o.counts.completed, 4);
    assert.equal(o.reviewBookingIds.length, 4);
    assert.equal(o.counts.active, 0);
  }));
test('current visit is selected from all owned orders, prioritizing consent and preserving the service snapshot', () =>
  fixture(async (e) => {
    const b = await booking(e);
    await e.repo.transaction(async (tx) => {
      await tx.put('bookings', {
        ...b,
        id: 'old-live',
        createdAt: b.createdAt - 10000,
        status: 'IN_SERVICE',
        staffTaskStatus: 'ACKNOWLEDGED',
      } satisfies Booking);
      await tx.put('bookings', {
        ...b,
        id: 'consent',
        createdAt: b.createdAt - 20000,
        replacementConsent: 'PENDING',
        proposedListingId: 'listing-mio',
      } satisfies Booking);
      await tx.put('bookings', {
        ...b,
        id: 'foreign-consent',
        customerId: other.id,
        replacementConsent: 'PENDING',
        proposedListingId: 'listing-mio',
      } satisfies Booking);
      for (let i = 0; i < 4; i++)
        await tx.put('bookings', {
          ...b,
          id: `recent-completed-${i}`,
          createdAt: b.createdAt + i + 1,
          status: 'COMPLETED',
        } satisfies Booking);
    });
    const overview = await e.experience.overview(customer);
    assert.equal(overview.recent.length, 3);
    assert(!overview.recent.some((x) => x.id === 'consent'));
    assert.equal(overview.focus?.id, 'consent');
    assert.equal(overview.focus?.requiresConsent, true);
    assert.deepEqual(overview.focus?.serviceName, b.quote.serviceName);
    for (const forbidden of ['address', 'customerId', 'staffId', 'paymentId', 'foreign-consent'])
      assert(!JSON.stringify(overview.focus).includes(forbidden));
    await e.repo.transaction(async (tx) => {
      const consent = (await tx.get<Booking>('bookings', 'consent'))!;
      await tx.put('bookings', { ...consent, status: 'CANCELLED' });
    });
    assert.equal((await e.experience.overview(customer)).focus?.id, 'old-live');
  }));
