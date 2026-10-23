import { test } from 'node:test';
import {
  adminTrend,
  filterAdminOrders,
  financeTotals,
  liveListing,
  orderNeedsAttention,
  filterCaseWork,
  type AdminCase,
} from '../hogulink-web/src/lib/admin-model';
import { handlingDateInput, handlingDateValue } from '../hogulink-web/src/lib/handling-i18n';
import type { TicketHandling } from '@hogulink/contracts';
import { adminRoles, canAdmin, type Actor } from '@hogulink/contracts';
import { adminTabAllowed } from '../hogulink-web/src/lib/admin-i18n';
import type { AdminBooking } from '@hogulink/contracts';
import {
  canProgress,
  canRespond,
  focusTask,
  nextEvent,
  staffNumbers,
} from '../hogulink-web/src/lib/staff-model';
import assert from 'node:assert/strict';
import { merchantWorkday } from '../hogulink-web/src/lib/workday-model';
import {
  japanInput,
  parseJapanInput,
  merchantNumbers,
  merchantTrend,
} from '../hogulink-web/src/lib/merchant-model';
import type { Booking, Listing, Offering } from '@hogulink/contracts';
import {
  csvCell,
  filterBookings,
  japanDay,
  matchingOffering,
  needsAttention,
  nominatedTotal,
} from '../hogulink-web/src/lib/desktop-model';
import {
  restoreVisitAddress,
  visitServices,
  visitTeam,
  visitTotal,
} from '../hogulink-web/src/lib/visit-model';

const now = Date.parse('2026-10-17T15:30:00Z'); // 18 October in Japan
test('staff navigation follows role permissions rather than merely the ADMIN account type', () => {
  const actor = (adminRole: Actor['adminRole']): Actor => ({
    id: 'employee',
    role: 'ADMIN',
    verificationLevel: 3,
    adminRole,
  });
  assert.equal(adminTabAllowed(actor('SUPPORT'), 'members'), false);
  assert.equal(adminTabAllowed(actor('SUPPORT'), 'finance'), false);
  assert.equal(adminTabAllowed(actor('SUPPORT'), 'safety'), true);
  assert.equal(adminTabAllowed(actor('FINANCE'), 'finance'), true);
  assert.equal(adminTabAllowed(actor('FINANCE'), 'safety'), false);
  assert.equal(adminTabAllowed(actor('AUDITOR'), 'audit'), true);
  for (const role of adminRoles) assert.equal(adminTabAllowed(actor(role), 'overview'), true);
});
test('read-only roles never gain mutation, dispatch or employee-management permissions', () => {
  for (const adminRole of ['FINANCE', 'AUDITOR'] as const) {
    const actor: Actor = { id: 'employee', role: 'ADMIN', verificationLevel: 3, adminRole };
    for (const permission of [
      'cases.write',
      'cases.assign',
      'supply.write',
      'safety.write',
      'members.manage',
    ] as const)
      assert.equal(canAdmin(actor, permission), false);
  }
  assert.equal(
    canAdmin({ id: 'customer', role: 'CUSTOMER', verificationLevel: 1 }, 'members.manage'),
    false,
  );
});
test('case work filters intersect business groups and ownership while excluding ended work from due queues', () => {
  const cases = [
    { id: 'a', status: 'OPEN', priority: 'NORMAL', dueAt: now - 1 },
    { id: 'b', status: 'RESOLVED', priority: 'HIGH', dueAt: now - 1 },
    { id: 'c', status: 'OPEN', priority: 'NORMAL', dueAt: now + 1000 },
  ] as AdminCase[];
  const handling = [
    { id: 'a', team: 'TRUST_SAFETY', ownerId: 'me', followUpAt: now - 1 },
    { id: 'b', team: 'TRUST_SAFETY', ownerId: 'me', followUpAt: now - 1 },
    { id: 'c', team: 'CUSTOMER_SUPPORT', ownerId: null, followUpAt: now + 1000 },
  ] as TicketHandling[];
  const input = { team: 'TRUST_SAFETY', filter: 'mine', actorId: 'me', now };
  assert.deepEqual(
    filterCaseWork(cases, handling, input).map((x) => x.id),
    ['a'],
  );
  assert.deepEqual(
    filterCaseWork(cases, handling, { ...input, filter: 'followUpDue' }).map((x) => x.id),
    ['a'],
  );
  assert.deepEqual(
    filterCaseWork(cases, handling, { ...input, team: '', filter: 'unassigned' }).map((x) => x.id),
    ['c'],
  );
  assert.deepEqual(
    cases.map((x) => x.id),
    ['a', 'b', 'c'],
  );
});
test('case work places due actions before future priority cases and keeps finished cases last', () => {
  const cases = [
    { id: 'future', status: 'OPEN', priority: 'HIGH', dueAt: now + 5000 },
    { id: 'due', status: 'OPEN', priority: 'NORMAL', dueAt: now - 1 },
    { id: 'done', status: 'CLOSED', priority: 'HIGH', dueAt: now - 1000 },
  ] as AdminCase[];
  assert.deepEqual(
    filterCaseWork(cases, [], { team: '', filter: 'all', actorId: 'me', now }).map((x) => x.id),
    ['due', 'future', 'done'],
  );
});
test('case follow-up dates use Japan time and reject malformed or impossible calendar dates', () => {
  assert.equal(handlingDateInput(now), '2026-10-18T00:30');
  assert.equal(handlingDateValue('2026-10-18T00:30'), now);
  for (const value of ['2026-02-30T10:00', 'invalid', '2026-10-18T00:30:01'])
    assert.equal(Number.isNaN(handlingDateValue(value)), true);
});
test('admin financial totals use captured facts and negative fee reversals, not quoted revenue', () => {
  const rows = [
    { capturedAmount: 8700, refundedAmount: 1000, quote: { total: 99999 } },
    { capturedAmount: 0, refundedAmount: 0, quote: { total: 15900 } },
  ] as AdminBooking[];
  assert.deepEqual(financeTotals(rows, [{ amount: 770 }, { amount: -88 }] as never), {
    captured: 8700,
    refunded: 1000,
    net: 7700,
    platform: 682,
    afterFees: 7018,
  });
});
test('admin publication count respects parent shop state and every therapist eligibility flag', () => {
  const listing = {
    storeId: 'shop',
    publicationStatus: 'PUBLISHED_INDEXABLE',
    membershipActive: true,
    identityVerified: true,
    portraitConsent: true,
  } as Listing;
  const shops = [{ id: 'shop', active: true, approved: true, pspReady: true }];
  assert.equal(liveListing(listing, shops as never), true);
  assert.equal(liveListing({ ...listing, portraitConsent: false }, shops as never), false);
  assert.equal(liveListing(listing, [{ ...shops[0], active: false }] as never), false);
});
test('admin order filters intersect shop, status, search and Japan visit date without mutating input', () => {
  const rows = [
    {
      id: 'one',
      storeId: 'shop',
      status: 'ACCEPTED',
      staffTaskStatus: 'OFFERED',
      quote: { startAt: now },
    },
    { id: 'two', storeId: 'other', status: 'COMPLETED', quote: { startAt: now - 3600000 } },
  ] as AdminBooking[];
  const result = filterAdminOrders(rows, {
    storeId: 'shop',
    status: 'attention',
    period: 'today',
    search: 'shinjuku',
    now,
    describe: () => 'Shinjuku',
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'one');
  assert.equal(rows.length, 2);
  assert.equal(orderNeedsAttention(rows[1]), false);
});
test('admin seven-day trend uses booking creation dates in Japan and includes closed bookings', () => {
  const rows = [
    { createdAt: now, status: 'CANCELLED' },
    { createdAt: now - 3600000, status: 'COMPLETED' },
    { createdAt: now - 9 * 86400000, status: 'COMPLETED' },
  ] as AdminBooking[];
  const trend = adminTrend(rows, now);
  assert.equal(trend[6].count, 1);
  assert.equal(trend[5].count, 1);
  assert.equal(
    trend.reduce((n, r) => n + r.count, 0),
    2,
  );
});
test('staff action eligibility blocks replacement consent and withdrawn or closed tasks', () => {
  const task = {
    status: 'CONFIRMED',
    staffTaskStatus: 'ACKNOWLEDGED',
    replacementConsent: 'NOT_REQUIRED',
  } as Booking;
  assert.equal(nextEvent(task), 'EN_ROUTE');
  assert.equal(nextEvent({ ...task, status: 'EN_ROUTE' }), 'ARRIVED');
  assert.equal(nextEvent({ ...task, status: 'ARRIVED' }), 'START');
  assert.equal(nextEvent({ ...task, status: 'IN_SERVICE' }), 'COMPLETE');
  assert.equal(canProgress({ ...task, replacementConsent: 'PENDING' }), false);
  assert.equal(nextEvent({ ...task, staffTaskStatus: 'WITHDRAWN' }), undefined);
  assert.equal(nextEvent({ ...task, status: 'COMPLETED' }), undefined);
  assert.equal(canRespond({ ...task, status: 'ACCEPTED', staffTaskStatus: 'OFFERED' }), true);
  assert.equal(
    canRespond({
      ...task,
      status: 'ACCEPTED',
      staffTaskStatus: 'OFFERED',
      replacementConsent: 'PENDING',
    }),
    false,
  );
});
test('staff focus prioritizes response deadlines, then active visits by start time', () => {
  const task = {
    id: 'confirmed',
    status: 'CONFIRMED',
    staffTaskStatus: 'ACKNOWLEDGED',
    replacementConsent: 'NOT_REQUIRED',
    deadline: now + 50000,
    quote: { startAt: now },
  } as Booking;
  const offered = {
    ...task,
    id: 'offered',
    status: 'ACCEPTED',
    staffTaskStatus: 'OFFERED',
    quote: { startAt: now + 10000 },
  } as Booking;
  const urgent = { ...offered, id: 'urgent', deadline: now + 1000 } as Booking;
  assert.equal(focusTask([task, offered, urgent])?.id, 'urgent');
  assert.equal(focusTask([{ ...task, status: 'COMPLETED' }]), undefined);
  assert.equal(focusTask([task])?.id, 'confirmed');
  for (const status of ['EN_ROUTE', 'ARRIVED', 'IN_SERVICE'] as const)
    assert.equal(focusTask([urgent, { ...task, status }])?.id, 'confirmed');
});
test('merchant first-screen work separates customer consent and therapist replies from actions, and omits ended orders', () => {
  const base = {
    id: 'manual',
    status: 'REQUESTED',
    deadline: now + 3000,
    quote: { startAt: now },
    staffTaskStatus: 'NOT_SENT',
    replacementConsent: 'NOT_REQUIRED',
  } as Booking;
  const waiting = {
    ...base,
    id: 'waiting',
    status: 'ACCEPTED',
    staffTaskStatus: 'OFFERED',
    assignedStaffId: 'staff-aoi',
  } as Booking;
  const consent = {
    ...base,
    id: 'consent',
    status: 'CONFIRMED',
    staffTaskStatus: 'WITHDRAWN',
    replacementConsent: 'PENDING',
    proposedListingId: 'listing-mio',
  } as Booking;
  const withdrawn = { ...consent, id: 'withdrawn', proposedListingId: null } as Booking;
  const work = merchantWorkday([
    base,
    waiting,
    consent,
    withdrawn,
    { ...waiting, id: 'ended', status: 'COMPLETED' },
  ]);
  assert.deepEqual(
    work.attention.map((b) => b.id),
    ['manual', 'withdrawn'],
  );
  assert.deepEqual(
    work.waitingStaff.map((b) => b.id),
    ['waiting'],
  );
  assert.deepEqual(
    work.waitingCustomer.map((b) => b.id),
    ['consent'],
  );
  assert.deepEqual(merchantWorkday([]), { attention: [], waitingStaff: [], waitingCustomer: [] });
});
test('staff metrics use Japan visit dates and completed service durations, never quote value as wages', () => {
  const rows = [
    { status: 'COMPLETED', quote: { startAt: now, endAt: now + 3600000, total: 8700 } },
    { status: 'CANCELLED', quote: { startAt: now, endAt: now + 5400000 } },
    {
      status: 'ACCEPTED',
      staffTaskStatus: 'OFFERED',
      quote: { startAt: now + 3600000, endAt: now + 7200000 },
    },
  ] as Booking[];
  assert.deepEqual(staffNumbers(rows, now), { pending: 1, today: 2, minutes: 60 });
});
test('merchant local datetimes use Japan time and reject invalid calendar dates', () => {
  assert.equal(japanInput(now), '2026-10-18T00:30');
  assert.equal(parseJapanInput('2026-10-18T00:30'), now);
  assert.ok(Number.isNaN(parseJapanInput('2026-02-30T10:00')));
  assert.ok(Number.isNaN(parseJapanInput('2026-10-18T24:30')));
});
test('merchant finance separates captured, refunded and reversed platform fees', () => {
  const rows = [
    { quote: { startAt: now }, status: 'COMPLETED', capturedAmount: 8700, refundedAmount: 2000 },
    { quote: { startAt: now }, status: 'CANCELLED', capturedAmount: 0, refundedAmount: 0 },
  ] as Booking[];
  assert.deepEqual(merchantNumbers(rows, [{ amount: 770 }, { amount: -177 }] as never, now), {
    today: 1,
    captured: 8700,
    refunded: 2000,
    net: 6700,
    platform: 593,
    afterFees: 6107,
  });
});
test('merchant trends use creation dates in Japan and include closed bookings without inventing demand', () => {
  const rows = [
    { createdAt: now },
    { createdAt: now - 3600_000 },
    { createdAt: now - 8 * 86400_000 },
  ] as Booking[];
  const trend = merchantTrend(rows, now);
  assert.equal(trend.length, 7);
  assert.equal(trend[6].day, '2026-10-18');
  assert.equal(trend[6].count, 1);
  assert.equal(trend[5].count, 1);
  assert.equal(
    trend.reduce((n, x) => n + x.count, 0),
    2,
  );
});
test('visit services and language candidates stay inside the selected shop and nomination', () => {
  const a = { storeId: 'one', offeringIds: ['short'], languages: ['ja'], onDuty: false } as Listing;
  const b = { storeId: 'one', offeringIds: ['long'], languages: ['en'], onDuty: true } as Listing;
  const outside = { ...b, storeId: 'two' };
  const offerings = [
    {
      id: 'short',
      storeId: 'one',
      durationMinutes: 60,
      approved: true,
      regulatoryCategory: 'RELAXATION',
    },
    {
      id: 'long',
      storeId: 'one',
      durationMinutes: 90,
      approved: true,
      regulatoryCategory: 'RELAXATION',
    },
    { id: 'licensed', storeId: 'one', approved: true, regulatoryCategory: 'LICENSED' },
  ] as Offering[];
  assert.deepEqual(
    visitServices(offerings, a, [a, b, outside], 'NOMINATED').map((x) => x.id),
    ['short'],
  );
  assert.deepEqual(
    visitServices(offerings, a, [a, b, outside], 'FREE').map((x) => x.id),
    ['short', 'long'],
  );
  assert.deepEqual(visitTeam([a, b, outside], a, 'long', 'FREE', 'en', 'INSTANT'), [b]);
  assert.equal(visitTeam([a, b], a, 'short', 'NOMINATED', 'ja', 'INSTANT').length, 0);
});
test('visit totals use configured nomination fee and selected service travel fee', () => {
  const offering = { price: 8000, transportFee: 1700 } as Offering;
  assert.equal(visitTotal(offering, 'NOMINATED', 900).total, 10600);
  assert.equal(visitTotal(offering, 'FREE', 900).total, 9700);
  assert.equal(visitTotal(offering, 'FREE', 900).nominationFee, 0);
});
test('checkout drafts preserve same-area fields but reset incompatible addresses and hotel consent', () => {
  const saved = {
    name: 'Guest',
    area: 'shinjuku',
    type: 'HOME',
    detail: 'Old address',
    hotelPermission: true,
  };
  const changed = restoreVisitAddress(saved, 'shibuya', true);
  assert.equal(changed.name, 'Guest');
  assert.equal(changed.detail, '');
  assert.equal(changed.area, 'shibuya');
  assert.equal(changed.type, 'HOTEL');
  assert.equal(changed.hotelPermission, false);
  assert.equal(restoreVisitAddress(saved, 'shinjuku', false).detail, 'Old address');
  assert.equal(
    restoreVisitAddress({ ...saved, type: 'HOTEL' }, 'shinjuku', true).hotelPermission,
    true,
  );
  assert.equal(restoreVisitAddress(['bad'], 'shinjuku', false).name, '');
});
function booking(id: string, overrides: Partial<Booking> = {}): Booking {
  return {
    id,
    status: 'CONFIRMED',
    createdAt: now,
    staffTaskStatus: 'ACKNOWLEDGED',
    replacementConsent: 'NOT_REQUIRED',
    assignedStaffId: 'staff-aoi',
    quote: { startAt: now + 3600000, endAt: now + 7200000 },
    ...overrides,
  } as Booking;
}
test('JST date uses the Japan midnight boundary regardless of host timezone', () => {
  assert.equal(japanDay(now), '2026-10-18');
  assert.equal(japanDay(Date.parse('2026-10-17T14:59:59Z')), '2026-10-17');
});
test('service price matches this listing and duration, including nomination and actual travel fee', () => {
  const offerings = [
    { id: 'other', durationMinutes: 90, price: 100, transportFee: 50 },
    { id: 'short', durationMinutes: 60, price: 7200, transportFee: 1000 },
    { id: 'long', durationMinutes: 90, price: 10800, transportFee: 1500 },
  ] as Offering[];
  const listing = { offeringIds: ['short', 'long'] } as Listing;
  const selected = matchingOffering(listing, offerings, 90)!;
  assert.equal(selected.id, 'long');
  assert.equal(nominatedTotal(selected), 12800);
  assert.equal(matchingOffering(listing, offerings, 120), undefined);
});
test('attention depends on role, ignores closed bookings and separates pending staff from merchant work', () => {
  const pending = booking('p', { status: 'ACCEPTED', staffTaskStatus: 'OFFERED' });
  assert.equal(needsAttention(pending, 'STAFF'), true);
  assert.equal(needsAttention(pending, 'MERCHANT'), false);
  assert.equal(
    needsAttention(booking('free', { status: 'ACCEPTED', assignedStaffId: null }), 'MERCHANT'),
    true,
  );
  assert.equal(
    needsAttention(
      booking('replacement', { replacementConsent: 'PENDING', proposedListingId: 'listing-ren' }),
      'CUSTOMER',
    ),
    true,
  );
  assert.equal(
    needsAttention(
      booking('cancelled', { status: 'CANCELLED', staffTaskStatus: 'OFFERED' }),
      'STAFF',
    ),
    false,
  );
});
test('search intersects status and date; today is calculated in Japan; filtering never mutates input', () => {
  const rows = [
    booking('old', { createdAt: now - 100 }),
    booking('pending', { status: 'REQUESTED', createdAt: now - 200 }),
    booking('closed', { status: 'CANCELLED' }),
    booking('yesterday', { quote: { startAt: now - 4 * 3600000 } as Booking['quote'] }),
  ];
  const options = {
    role: 'MERCHANT' as const,
    status: 'all' as const,
    search: '',
    period: 'today',
    now,
    describe: () => 'Nagi 葵',
  };
  assert.deepEqual(
    filterBookings(rows, options).map((b) => b.id),
    ['pending', 'closed', 'old'],
  );
  assert.deepEqual(
    filterBookings(rows, { ...options, status: 'attention', search: '  NAGI ' }).map((b) => b.id),
    ['pending'],
  );
  assert.equal(filterBookings(rows, { ...options, search: 'missing' }).length, 0);
  assert.deepEqual(
    filterBookings(rows, { ...options, period: 'upcoming' }).map((b) => b.id),
    ['pending', 'old'],
  );
  assert.equal(rows[0].id, 'old');
});
test('CSV escapes quotes, newlines and formula-triggering text without changing positive amounts', () => {
  assert.equal(csvCell('Nagi "shop"'), '"Nagi ""shop"""');
  assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
  assert.equal(csvCell(' @SUM(A1)'), '"\' @SUM(A1)"');
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
  assert.equal(csvCell(8700), '"8700"');
  assert.equal(csvCell(-88), '"-88"');
  assert.equal(csvCell('-SUM(A1)'), '"\'-SUM(A1)"');
});

test('replacement without a candidate does not ask the customer to approve an unnamed therapist', () => {
  const waiting = booking('waiting', {
    replacementConsent: 'PENDING',
    proposedListingId: undefined,
  });
  assert.equal(needsAttention(waiting, 'CUSTOMER'), false);
  assert.equal(needsAttention({ ...waiting, proposedListingId: 'listing-ren' }, 'CUSTOMER'), true);
});
test('a withdrawn replacement returns to merchant work and never asks staff to respond before consent', () => {
  const waiting = booking('withdrawn-candidate', {
    replacementConsent: 'PENDING',
    proposedListingId: undefined,
    staffTaskStatus: 'ACKNOWLEDGED',
  });
  assert.equal(needsAttention(waiting, 'MERCHANT'), true);
  assert.deepEqual(
    merchantWorkday([waiting]).attention.map((b) => b.id),
    [waiting.id],
  );
  const proposed = {
    ...waiting,
    proposedListingId: 'listing-ren',
    staffTaskStatus: 'OFFERED' as const,
  };
  assert.equal(needsAttention(proposed, 'STAFF'), false);
  assert.equal(canRespond(proposed), false);
  assert.equal(merchantWorkday([proposed]).attention.length, 0);
  assert.equal(merchantWorkday([proposed]).waitingCustomer.length, 1);
});
test('no-show reports require shop and platform attention while resolved cases do not', () => {
  const reported = booking('no-show', {
    status: 'ARRIVED',
    noShow: { status: 'REPORTED', startedAt: now, waitUntil: now, contacts: [] },
  });
  assert.equal(needsAttention(reported, 'MERCHANT'), true);
  assert.equal(orderNeedsAttention(reported as AdminBooking), true);
  assert.equal(needsAttention({ ...reported, status: 'CANCELLED' }, 'MERCHANT'), false);
});
test('completion consent belongs to customer; exceptions belong to shop and platform and staff cannot progress again', () => {
  const pending = booking('completion', {
    status: 'AWAITING_COMPLETION',
    completion: { status: 'PENDING' } as Booking['completion'],
  });
  assert.equal(needsAttention(pending, 'CUSTOMER'), true);
  assert.equal(needsAttention(pending, 'MERCHANT'), false);
  assert.deepEqual(
    merchantWorkday([pending]).waitingCustomer.map((b) => b.id),
    ['completion'],
  );
  assert.equal(nextEvent(pending), undefined);
  assert.equal(canProgress(pending), false);
  const next = booking('upcoming', {
    status: 'CONFIRMED',
    quote: { ...pending.quote, startAt: pending.quote.startAt + 86400000 },
  });
  assert.equal(focusTask([pending, next])?.id, 'upcoming');
  for (const status of ['DISPUTED', 'TIMED_OUT', 'PAYMENT_REVIEW'] as const) {
    const issue = { ...pending, completion: { ...pending.completion!, status } };
    assert.equal(needsAttention(issue, 'MERCHANT'), true);
    assert.equal(orderNeedsAttention(issue as AdminBooking), true);
    assert.equal(merchantWorkday([issue]).attention.length, 1);
    assert.equal(merchantWorkday([issue]).waitingCustomer.length, 0);
  }
});
