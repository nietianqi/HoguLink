import test from 'node:test';
import assert from 'node:assert/strict';
import type { Booking } from '@hogulink/contracts';
import {
  merchantAttentionKeys,
  merchantNewAttention,
  merchantBookingStatus,
} from '../hogulink-web/src/lib/merchant-model.ts';
import { filterBookings } from '../hogulink-web/src/lib/desktop-model.ts';
import { mo } from '../hogulink-web/src/lib/merchant-operations-i18n.ts';
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
