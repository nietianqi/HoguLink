import test from 'node:test';
import assert from 'node:assert/strict';
import type { Booking, Locale } from '@hogulink/contracts';
import {
  customerBookingStage,
  visibleVisitTimes,
  visitTimeRange,
  holdSecondsRemaining,
} from '../hogulink-web/src/lib/booking-presentation';

test('hold countdown follows server time even with large device clock differences', () => {
  const serverNow = Date.parse('2026-10-20T18:00:00+09:00');
  assert.equal(holdSecondsRemaining(serverNow + 600000, serverNow, 0), 600);
  assert.equal(holdSecondsRemaining(serverNow + 600000, serverNow, 45000), 555);
  // Only elapsed monotonic time is applied; changing the device's wall clock is irrelevant.
  assert.equal(holdSecondsRemaining(serverNow + 600000, serverNow, 601000), 0);
});
test('inactive or expired holds never regain time and a negative elapsed clock cannot extend a hold', () => {
  assert.equal(holdSecondsRemaining(600000, 0, -1000), 600);
  assert.equal(holdSecondsRemaining(600000, 0, 0, false), 0);
  assert.equal(holdSecondsRemaining(1000, 2000, 0), 0);
});

test('collapsed times retain a selected late slot without expanding every slot', () => {
  const times = Array.from({ length: 26 }, (_, i) => i + 100);
  const visible = visibleVisitTimes(times, 123, false, 12);
  assert.equal(visible.length, 12);
  assert.equal(visible.at(-1), 123);
  assert.equal(new Set(visible).size, 12);
  assert.deepEqual(visibleVisitTimes(times, 999, false, 12), times.slice(0, 12));
  assert.deepEqual(visibleVisitTimes(times, 123, true, 12), times);
  assert.deepEqual(visibleVisitTimes([], 123, false, 12), []);
});
test('visit ranges show both Tokyo dates across midnight and use a 24-hour clock in three languages', () => {
  for (const locale of ['ja', 'en', 'zh-cn'] as Locale[]) {
    const overnight = visitTimeRange(
      locale,
      Date.parse('2026-10-20T23:30:00+09:00'),
      Date.parse('2026-10-21T01:00:00+09:00'),
    );
    assert.match(overnight, /20/);
    assert.match(overnight, /21/);
    assert.match(overnight, /23:30/);
    assert.match(overnight, /01:00 JST$/);
    const midnight = visitTimeRange(
      locale,
      Date.parse('2026-10-20T00:00:00+09:00'),
      Date.parse('2026-10-20T01:00:00+09:00'),
    );
    assert.match(midnight, /00:00/);
    assert.doesNotMatch(midnight, /24:00/);
  }
});
const booking = (fields: Partial<Booking>) =>
  ({
    status: 'CONFIRMED',
    staffTaskStatus: 'ACKNOWLEDGED',
    replacementConsent: 'NOT_REQUIRED',
    ...fields,
  }) as Booking;
test('customer progress separates confirmation, service and customer approval', () => {
  assert.equal(customerBookingStage(booking({ status: 'REQUESTED' })), 0);
  assert.equal(
    customerBookingStage(booking({ status: 'ACCEPTED', staffTaskStatus: 'OFFERED' })),
    1,
  );
  assert.equal(customerBookingStage(booking({})), 2);
  for (const status of ['EN_ROUTE', 'ARRIVED'] as const)
    assert.equal(customerBookingStage(booking({ status })), 2);
  assert.equal(customerBookingStage(booking({ status: 'IN_SERVICE' })), 3);
  for (const status of ['PENDING', 'DISPUTED', 'TIMED_OUT', 'PAYMENT_REVIEW'] as const)
    assert.equal(
      customerBookingStage(
        booking({ status: 'AWAITING_COMPLETION', completion: { status } as Booking['completion'] }),
      ),
      4,
    );
  assert.equal(customerBookingStage(booking({ status: 'COMPLETED' })), 5);
});
test('replacement returns to confirmation and closed bookings never imply service completion', () => {
  assert.equal(customerBookingStage(booking({ replacementConsent: 'PENDING' })), 1);
  assert.equal(customerBookingStage(booking({ staffTaskStatus: 'WITHDRAWN' })), 1);
  for (const status of ['CANCELLED', 'REJECTED', 'EXPIRED'] as const)
    assert.equal(customerBookingStage(booking({ status })), null);
});
