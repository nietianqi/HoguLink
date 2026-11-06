import test from 'node:test';
import assert from 'node:assert/strict';
import type { Booking, CustomerOverview } from '@hogulink/contracts';
import {
  accountBookingAction,
  accountCountdown,
  accountRecent,
  accountStartTime,
  rebookingHref,
  type AccountBooking,
  customerTaskKind,
  groupCustomerBookings,
} from '../hogulink-web/src/lib/account-model';

test('PC order groups prioritize owned review eligibility and urgent decisions before future or closed orders without mutating H5 history', () => {
  const now = Date.UTC(2026, 10, 6);
  const base = { quote: { startAt: now + 3600000, endAt: now + 7200000 }, createdAt: now };
  const bookings = [
    {
      ...base,
      id: 'cancelled',
      status: 'CANCELLED',
      replacementConsent: 'PENDING',
      proposedListingId: 'x',
    },
    { ...base, id: 'reviewed', status: 'COMPLETED' },
    {
      ...base,
      id: 'next-later',
      status: 'CONFIRMED',
      quote: { startAt: now + 86400000, endAt: now + 90000000 },
    },
    { ...base, id: 'review', status: 'COMPLETED' },
    {
      ...base,
      id: 'payment',
      status: 'CONFIRMED',
      paymentStatus: 'FAILED',
      paymentActionBy: now + 1000,
    },
    { ...base, id: 'complete', status: 'AWAITING_COMPLETION', completion: { status: 'PENDING' } },
    {
      ...base,
      id: 'consent',
      status: 'CONFIRMED',
      replacementConsent: 'PENDING',
      proposedListingId: 'x',
    },
    { ...base, id: 'next', status: 'CONFIRMED' },
  ] as Booking[];
  const before = bookings.map((b) => b.id);
  const groups = groupCustomerBookings(bookings, ['review', 'cancelled'], now);
  assert.deepEqual(
    groups.attention.map((b) => b.id),
    ['consent', 'complete', 'payment', 'review'],
  );
  assert.deepEqual(
    groups.upcoming.map((b) => b.id),
    ['next', 'next-later'],
  );
  assert.deepEqual(
    groups.completed.map((b) => b.id),
    ['reviewed'],
  );
  assert.deepEqual(
    groups.closed.map((b) => b.id),
    ['cancelled'],
  );
  assert.deepEqual(
    bookings.map((b) => b.id),
    before,
  );
  assert.equal(customerTaskKind({ ...bookings[4], paymentActionBy: now }, [], now), undefined);
  assert.equal(
    customerTaskKind(
      { ...bookings[5], completion: { status: 'PAYMENT_REVIEW' } } as Booking,
      [],
      now,
    ),
    'payment',
  );
  assert.equal(
    customerTaskKind({ ...bookings[5], completion: { status: 'DISPUTED' } } as Booking, [], now),
    undefined,
  );
});
import { filterBookings } from '../hogulink-web/src/lib/desktop-model';

test('pending-review filter requires authoritative eligibility, intersects dates and search, and never exposes the entire completed history', () => {
  const orders = [
    {
      id: 'pending',
      status: 'COMPLETED',
      quote: { startAt: Date.parse('2026-10-28T03:00Z') },
      createdAt: 2,
    },
    {
      id: 'reviewed',
      status: 'COMPLETED',
      quote: { startAt: Date.parse('2026-10-28T03:00Z') },
      createdAt: 1,
    },
    {
      id: 'active',
      status: 'CONFIRMED',
      quote: { startAt: Date.parse('2026-10-28T03:00Z') },
      createdAt: 3,
    },
  ] as Booking[];
  const options = {
    role: 'CUSTOMER',
    status: 'review',
    reviewBookingIds: ['pending', 'active'],
    search: '',
    period: 'all',
    describe: (b: Booking) => b.id,
  } as const;
  assert.deepEqual(
    filterBookings(orders, options).map((b) => b.id),
    ['pending'],
  );
  assert.deepEqual(filterBookings(orders, { ...options, reviewBookingIds: [] }), []);
  assert.deepEqual(filterBookings(orders, { ...options, reviewBookingIds: undefined }), []);
  assert.deepEqual(filterBookings(orders, { ...options, role: 'MERCHANT' }), []);
  assert.deepEqual(filterBookings(orders, { ...options, search: 'reviewed' }), []);
  assert.deepEqual(
    filterBookings(orders, { ...options, period: 'today', now: Date.parse('2026-10-29T03:00Z') }),
    [],
  );
});

test('account times use Japan midnight and only future visits count down in all languages', () => {
  const now = Date.parse('2026-10-28T14:30:00Z');
  for (const [l, today, tomorrow] of [
    ['zh-cn', '今天', '明天'],
    ['en', 'Today', 'Tomorrow'],
    ['ja', '今日', '明日'],
  ] as const) {
    assert(accountStartTime(l, now, now).includes(today));
    assert(accountStartTime(l, now + 3600000, now).includes(tomorrow));
    assert(accountStartTime(l, now + 3600000, now).includes('00:30'));
    assert(accountStartTime(l, now, now).includes('JST'));
    assert(!accountCountdown(l, now - 1, now).includes('-'));
    assert(accountCountdown(l, now + 26 * 3600000, now).includes('26'));
    assert(accountCountdown(l, now + 12 * 60000, now).includes('12'));
    assert(accountCountdown(l, now + 61 * 60000, now).startsWith('1 '));
  }
});

test('consent and completion take priority over ordinary home/in-store instructions, and history does not duplicate focus', () => {
  const b = { id: 'focus', status: 'CONFIRMED', fulfillmentMode: 'IN_STORE' } as AccountBooking;
  assert.equal(accountBookingAction({ ...b, requiresConsent: true }).label, 'consent');
  assert.equal(accountBookingAction({ ...b, status: 'AWAITING_COMPLETION' }).label, 'completion');
  assert.equal(accountBookingAction(b).help, 'storeHelp');
  assert.equal(accountBookingAction({ ...b, fulfillmentMode: 'HOME_VISIT' }).help, 'homeHelp');
  assert.equal(accountBookingAction({ ...b, status: 'REQUESTED' }).help, 'waitingHelp');
  assert.equal(accountBookingAction({ ...b, status: 'ARRIVED' }).help, 'checkedInHelp');
  assert.equal(
    accountBookingAction({ ...b, status: 'ARRIVED', fulfillmentMode: 'HOME_VISIT' }).help,
    'arrivedHelp',
  );
  assert.equal(
    accountBookingAction({ ...b, status: 'EN_ROUTE', fulfillmentMode: 'HOME_VISIT' }).help,
    'onWayHelp',
  );
  const overview = {
    focus: { ...b, requiresConsent: false },
    recent: [b, { ...b, id: 'history' }],
  } as CustomerOverview;
  assert.deepEqual(
    accountRecent(overview).map((b) => b.id),
    ['history'],
  );
  assert.equal(overview.recent.length, 2);
});

test('booking again carries the original chosen service mode and menu but never the old time, price or address', () => {
  const legacy = new URL(
    rebookingHref('en', {
      listingSlug: 'aoi',
      offeringId: 'menu-60',
      nominationType: 'NOMINATED',
      bookingMode: 'SCHEDULED',
      area: 'shinjuku',
    }),
    'http://localhost',
  );
  assert.equal(legacy.searchParams.get('fulfillmentMode'), 'HOME_VISIT');
  for (const fulfillmentMode of ['HOME_VISIT', 'IN_STORE'] as const) {
    const url = new URL(
      rebookingHref('zh-cn', {
        listingSlug: 'aoi',
        offeringId: 'menu-60',
        nominationType: 'FREE',
        bookingMode: 'SCHEDULED',
        fulfillmentMode,
        area: 'minato',
        language: 'en',
      }),
      'http://localhost',
    );
    assert.equal(url.pathname, '/zh-cn/book/aoi');
    assert.equal(url.searchParams.get('fulfillmentMode'), fulfillmentMode);
    assert.equal(url.searchParams.get('nomination'), 'FREE');
    assert.equal(url.searchParams.get('language'), 'en');
    for (const key of ['startAt', 'price', 'address', 'room', 'contact'])
      assert(!url.searchParams.has(key));
  }
});
