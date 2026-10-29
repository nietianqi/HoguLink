import test from 'node:test';
import assert from 'node:assert/strict';
import { travelRecordOpensAt, type Booking } from '@hogulink/contracts';
import {
  staffCanMessage,
  staffTravelReady,
  staffAttentionKeys,
  staffNewAttention,
  staffPerformance,
} from '../hogulink-web/src/lib/staff-model';
const now = Date.parse('2026-10-31T23:30:00+09:00');
const task = (changes: Partial<Booking> = {}) =>
  ({
    id: 'task-aoi',
    status: 'CONFIRMED',
    staffTaskStatus: 'ACKNOWLEDGED',
    replacementConsent: 'NONE',
    quote: {
      fulfillmentMode: 'HOME_VISIT',
      bookingMode: 'SCHEDULED',
      startAt: now + 3 * 3600000,
      endAt: now + 4 * 3600000,
    },
    deadline: now + 30 * 60000,
    ...changes,
  }) as Booking;
test('confirmed in-store tasks can use messages without a customer home address', () => {
  const home = task(),
    venue = task({ quote: { ...home.quote, fulfillmentMode: 'IN_STORE' } });
  assert.equal(venue.address, undefined);
  assert.equal(staffCanMessage(venue), true);
  for (const state of ['ACCEPTED', 'AWAITING_COMPLETION', 'COMPLETED', 'CANCELLED'] as const)
    assert.equal(staffCanMessage(task({ status: state })), false);
  assert.equal(staffCanMessage(task({ staffTaskStatus: 'OFFERED' })), false);
  assert.equal(staffCanMessage(task({ replacementConsent: 'PENDING' })), false);
});
test('travel records open at the same 90-minute boundary used by the server', () => {
  const b = task(),
    opens = b.quote.startAt - 90 * 60000;
  assert.equal(travelRecordOpensAt(b.quote), opens);
  assert.equal(staffTravelReady(b, opens - 1), false);
  assert.equal(staffTravelReady(b, opens), true);
  assert.equal(
    staffTravelReady(task({ quote: { ...b.quote, bookingMode: 'INSTANT' } }), now),
    true,
  );
  assert.equal(travelRecordOpensAt({ ...b.quote, fulfillmentMode: 'IN_STORE' }), undefined);
});
test('alerts ignore ordinary updates, notify new offers and notify the urgent threshold once', () => {
  const b = task({ staffTaskStatus: 'OFFERED' });
  const initial = staffAttentionKeys([b], now);
  assert.equal(staffNewAttention(null, initial), 0);
  assert.equal(
    staffNewAttention(initial, staffAttentionKeys([{ ...b, version: 99 }], now + 60000)),
    0,
  );
  const urgent = staffAttentionKeys([b], b.deadline - 5 * 60000);
  assert.equal(staffNewAttention(initial, urgent), 1);
  assert.equal(staffNewAttention(urgent, staffAttentionKeys([b], b.deadline - 4 * 60000)), 0);
  assert.equal(
    staffNewAttention(initial, staffAttentionKeys([b, { ...b, id: 'new-task' }], now)),
    1,
  );
  assert.equal(staffAttentionKeys([{ ...b, replacementConsent: 'PENDING' }], now).size, 0);
  assert.equal(staffAttentionKeys([{ ...b, status: 'CANCELLED' }], now).size, 0);
});
test('monthly work uses JST appointment dates and completed services, never quote totals as wages', () => {
  const b = task({ status: 'COMPLETED' });
  const oct = { ...b, quote: { ...b.quote, startAt: now - 3600000, endAt: now, total: 990000 } };
  const nov = {
    ...b,
    id: 'november',
    quote: { ...b.quote, startAt: now + 3600000, endAt: now + 7200000 },
  };
  assert.deepEqual(staffPerformance([oct, nov, { ...oct, status: 'IN_SERVICE' }], now), {
    month: '2026-10',
    completed: 1,
    minutes: 60,
  });
  assert.deepEqual(staffPerformance([oct, nov], now + 3600000), {
    month: '2026-11',
    completed: 1,
    minutes: 60,
  });
});
