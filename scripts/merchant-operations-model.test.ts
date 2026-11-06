import test from 'node:test';
import assert from 'node:assert/strict';
import type { Booking } from '@hogulink/contracts';
import {
  merchantAttentionKeys,
  merchantNewAttention,
  merchantBookingStatus,
  merchantCanApproveTimeOff,
  merchantUpcoming,
} from '../hogulink-web/src/lib/merchant-model.ts';
import { filterBookings, japanDay } from '../hogulink-web/src/lib/desktop-model.ts';
import { serverClockNow } from '../hogulink-web/src/lib/server-clock.ts';
import { mo } from '../hogulink-web/src/lib/merchant-operations-i18n.ts';
import { merchantWorkday } from '../hogulink-web/src/lib/workday-model.ts';
const now = Date.UTC(2026, 9, 28, 0);
function booking(status: Booking['status'], id = status): Booking {
  return {
    id,
    status,
    staffTaskStatus: 'NOT_SENT',
    assignedStaffId: null,
    assignedListingId: null,
    replacementConsent: 'NOT_REQUIRED',
    deadline: now + 600000,
    createdAt: now,
    quote: { startAt: now + 3600000, endAt: now + 7200000 },
  } as Booking;
}

test('merchant workday keeps overdue travel, arrival and service actionable after the planned end', () => {
  const live = (['EN_ROUTE', 'ARRIVED', 'IN_SERVICE'] as const).map((status) => ({
    ...booking(status),
    staffTaskStatus: 'ACKNOWLEDGED' as const,
    quote: { ...booking(status).quote, startAt: now - 7200000, endAt: now - 3600000 },
  }));
  assert.deepEqual(
    merchantWorkday(live, now)
      .attention.map((b) => b.id)
      .sort(),
    ['ARRIVED', 'EN_ROUTE', 'IN_SERVICE'],
  );
  assert.equal(merchantWorkday([booking('IN_SERVICE')], now).attention.length, 0);
  assert.equal(merchantWorkday([booking('COMPLETED')], now).attention.length, 0);
});

test('merchant approval uses the server boundary and refuses expired, processed or unsynced requests', () => {
  const request = { status: 'PENDING' as const, startAt: now + 120000 };
  const anchor = { serverNow: now, sampledAt: 50 };
  assert.equal(merchantCanApproveTimeOff(request, 0), false);
  assert.equal(merchantCanApproveTimeOff(request, serverClockNow(anchor, 50)), true);
  assert.equal(merchantCanApproveTimeOff(request, serverClockNow(anchor, 120049)), true);
  assert.equal(merchantCanApproveTimeOff(request, serverClockNow(anchor, 120050)), false);
  assert.equal(merchantCanApproveTimeOff({ ...request, status: 'APPROVED' }, now), false);
  const midnight = Date.parse('2026-11-06T23:59:59+09:00');
  assert.equal(
    japanDay(serverClockNow({ serverNow: midnight, sampledAt: 50 }, 1050)),
    '2026-11-07',
  );
});

test('upcoming keeps active overdue visits reachable but excludes closed and finished records', () => {
  const old = booking('IN_SERVICE');
  old.quote = { ...old.quote, startAt: now - 7200000, endAt: now - 3600000 };
  assert.deepEqual(
    merchantUpcoming([old, booking('COMPLETED'), booking('CANCELLED')], now).map((b) => b.id),
    [old.id],
  );
  assert.equal(merchantUpcoming([booking('CONFIRMED')], now).length, 1);
});
test('merchant pending assignment is explicit in all three locales, while assigned orders keep the original task status', () => {
  const b = booking('ACCEPTED');
  for (const l of ['ja', 'en', 'zh-cn'] as const)
    assert.equal(merchantBookingStatus(l, b), mo(l, 'assign'));
  assert.notEqual(
    merchantBookingStatus('zh-cn', { ...b, assignedStaffId: 'staff-aoi' }),
    mo('zh-cn', 'assign'),
  );
});
test('confirmed/in-progress merchant filter excludes requests and assignment while keeping customer active bookings', () => {
  const bookings = (
    ['REQUESTED', 'ACCEPTED', 'CONFIRMED', 'IN_SERVICE', 'COMPLETED', 'CANCELLED'] as const
  ).map((s) => booking(s));
  const options = {
    role: 'MERCHANT' as const,
    status: 'active' as const,
    search: '',
    period: 'all',
    describe: () => '',
    now,
  };
  assert.deepEqual(
    filterBookings(bookings, options)
      .map((b) => b.status)
      .sort(),
    ['CONFIRMED', 'IN_SERVICE'],
  );
  assert.equal(filterBookings(bookings, { ...options, role: 'CUSTOMER' }).length, 4);
});
test('first load and refreshes do not repeat alerts, but new requests and near-deadline work are distinct', () => {
  const a = booking('REQUESTED'),
    initial = merchantAttentionKeys([a], now);
  assert.equal(merchantNewAttention(null, initial), 0);
  assert.equal(merchantNewAttention(initial, merchantAttentionKeys([a], now)), 0);
  assert.equal(
    merchantNewAttention(initial, merchantAttentionKeys([a, booking('ACCEPTED')], now)),
    1,
  );
  const due = merchantAttentionKeys([a], now + 310000);
  assert.equal(merchantNewAttention(initial, due), 1);
  assert.equal(merchantNewAttention(due, merchantAttentionKeys([a], now + 320000)), 0);
  assert.equal(merchantAttentionKeys([booking('COMPLETED')], now).size, 0);
});
