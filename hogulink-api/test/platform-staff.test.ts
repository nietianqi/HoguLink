import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { Actor, Booking, SafetyEvent } from '@hogulink/contracts';
import {
  fixture,
  booking,
  start,
  customer,
  shop,
  staff,
  admin,
  complete,
} from './helpers/experience-fixture.js';
import { openAllDay } from './helpers/business-hours.js';
import { authorizeAdminRoute } from '../src/admin-access.js';

const minute = 60_000;
const code = (value: string) => (e: unknown) => (e as { code?: string }).code === value;
type E = Parameters<Parameters<typeof fixture>[0]>[0];

async function adminMember(e: E, id: string, adminRole: Actor['adminRole']): Promise<Actor> {
  await e.repo.transaction((tx) =>
    tx.put('adminMembers', {
      id,
      name: id,
      email: `${id}@example.test`,
      adminRole,
      teams: [],
      status: 'ACTIVE',
      version: 1,
      sessionVersion: 1,
      createdAt: e.now(),
      updatedAt: e.now(),
    }),
  );
  return { id, role: 'ADMIN', verificationLevel: 3, adminRole, adminSessionVersion: 1 };
}
async function sos(e: E, clock: { now: number }) {
  const b: Booking = await start(e, clock);
  await e.safety(staff, b.id, 'SOS', b.version);
  const event = (await e.care.safetyEvents(staff)).find((x) => x.bookingId === b.id)!;
  return { b, event };
}
const here = { latitude: 35.6905, longitude: 139.7005, accuracy: 25 };

test('after an SOS the therapist sees the shop emergency number and can share a location once', () =>
  fixture(async (e, clock) => {
    const { event } = await sos(e, clock);
    assert.ok(event.emergencyContact, 'emergency number of the shop');
    assert.equal(event.location, undefined);
    const other = { ...staff, id: 'quality-mio', staffId: 'staff-mio' };
    await assert.rejects(e.care.shareLocation(other, event.id, here), code('NOT_FOUND'));
    const shared = await e.care.shareLocation(staff, event.id, here);
    assert.equal(shared.location!.latitude, here.latitude);
    const forShop = (await e.care.safetyEvents(shop)).find((x) => x.id === event.id)!;
    assert.deepEqual(
      [forShop.location!.latitude, forShop.location!.longitude],
      [here.latitude, here.longitude],
    );
    await assert.rejects(e.care.safetyEvents(customer), code('FORBIDDEN'));
    // Stored encrypted with other private record fields.
    const raw = await e.repo.read((tx) => tx.get<SafetyEvent>('safety', event.id));
    assert.equal(raw!.location!.longitude, here.longitude);
    const resolved = await e.care.resolveSafety(
      admin,
      event.id,
      shared.version ?? 1,
      'Therapist reached safely; the shop confirmed by phone.',
    );
    assert.equal(resolved.status, 'RESOLVED');
    // Once help is no longer needed, the shop no longer sees where the therapist was.
    const after = (await e.care.safetyEvents(shop)).find((x) => x.id === event.id)!;
    assert.equal(after.location, undefined);
    await assert.rejects(e.care.shareLocation(staff, event.id, here), code('INVALID_STATE'));
  }));

test('the safety team can look up the visit place only for an open event, with an audited reason', () =>
  fixture(async (e, clock) => {
    const { b, event } = await sos(e, clock);
    const finance = await adminMember(e, 'finance-member', 'FINANCE');
    const reason = { reason: 'SOS raised; preparing to contact local police.' };
    await assert.rejects(e.care.emergencyLocation(finance, event.id, reason), code('FORBIDDEN'));
    await assert.rejects(e.care.emergencyLocation(admin, event.id, { reason: 'short' }));
    const place = await e.care.emergencyLocation(admin, event.id, reason);
    assert.equal(place.bookingId, b.id);
    assert.equal(place.mode, 'HOME_VISIT');
    assert.match(place.address!, /QA Hotel/);
    const audit = await e.repo.read((tx) => tx.list<any>('audit'));
    assert.ok(
      audit.some(
        (x) =>
          x.action === 'SAFETY_ADDRESS_ACCESSED' &&
          x.actorId === admin.id &&
          x.detail.includes(reason.reason),
      ),
    );
    await e.care.resolveSafety(admin, event.id, 1, 'Resolved after confirming safety by phone.');
    await assert.rejects(e.care.emergencyLocation(admin, event.id, reason), code('INVALID_STATE'));
    clock.now += minute;
  }));

// ---- Therapist shifts
const jst = (day: number, hour: number, m = 0) => Date.UTC(2026, 9, day, hour - 9, m);
const off: never[] = [];
const days = (map: Record<number, [number, number]>) =>
  Array.from({ length: 7 }, (_, d) =>
    map[d] ? [{ startMinute: map[d][0] * 60, endMinute: map[d][1] * 60 }] : off,
  );
const homeQuote = (e: E, startAt: number, listingId = 'listing-aoi') =>
  e.quote(customer, {
    listingId,
    offeringId: 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt,
    area: 'shinjuku',
    requiredLanguage: '',
  });

test('scheduled visits are offered only inside the therapist shifts; date changes override the week', () =>
  fixture(async (e) => {
    // The fixture day, 2026-10-18, is a Sunday (index 0).
    let listing = await e.staff.saveShifts(staff, {
      version: 0,
      weekly: days({ 0: [10, 14] }),
      exceptions: [],
    });
    assert.ok(await homeQuote(e, jst(18, 12)));
    await assert.rejects(homeQuote(e, jst(18, 13, 30)), code('SLOT_CONFLICT'), 'ends after 14:00');
    await assert.rejects(homeQuote(e, jst(19, 12)), code('SLOT_CONFLICT'), 'Monday off');
    const { slots } = await e.availability('listing-aoi', 'store-nagi-60');
    assert.ok(slots.length);
    for (const at of slots) {
      const startMinute = ((at + 9 * 60 * minute) / minute) % 1440;
      assert.ok(startMinute >= 600 && startMinute + 60 <= 840, 'every listed visit fits the shift');
    }
    listing = await e.staff.saveShifts(staff, {
      version: listing.shifts!.version,
      weekly: days({ 0: [10, 14] }),
      exceptions: [{ date: '2026-10-18', windows: [] }],
    });
    await assert.rejects(homeQuote(e, jst(18, 12)), code('SLOT_CONFLICT'), 'date marked off');
    assert.equal((await e.availability('listing-aoi', 'store-nagi-60')).slots.length, 0);
  }));

test('a shift past midnight belongs to the day it starts', () =>
  fixture(async (e) => {
    await openAllDay(e);
    await e.staff.saveShifts(staff, {
      version: 0,
      weekly: days({ 6: [20, 2] }),
      exceptions: [{ date: '2026-10-25', windows: [] }],
    });
    // Saturday 24th night, 01:00 on Sunday 25th: still Saturday's shift.
    assert.ok(await homeQuote(e, jst(25, 1)));
    await assert.rejects(homeQuote(e, jst(25, 2)), code('SLOT_CONFLICT'));
  }));

test('shifts cannot drop a booked visit; the shop can edit them; instant visits follow duty', () =>
  fixture(async (e) => {
    const b = await booking(e, { startAt: jst(18, 12) });
    await assert.rejects(
      e.staff.saveShifts(staff, { version: 0, weekly: days({ 0: [14, 20] }), exceptions: [] }),
      code('SHIFT_HAS_BOOKINGS'),
    );
    const otherShop = { ...shop, id: 'quality-mori', storeId: 'store-mori' };
    await assert.rejects(
      e.staff.saveShiftsAsShop(otherShop, 'listing-aoi', {
        version: 0,
        weekly: days({ 0: [10, 14] }),
        exceptions: [],
      }),
      code('NOT_FOUND'),
    );
    const listing = await e.staff.saveShiftsAsShop(shop, 'listing-aoi', {
      version: 0,
      weekly: days({ 0: [10, 14] }),
      exceptions: [],
    });
    assert.equal(listing.shifts!.updatedBy, shop.id);
    assert.equal(b.status !== 'CANCELLED', true);
    // Shifts concern scheduled visits; instant availability still follows on-duty status.
    await e.staff.saveShifts(staff, { version: 1, weekly: days({ 0: [10, 14] }), exceptions: [] });
    assert.ok(await booking(e, { mode: 'INSTANT', listingId: 'listing-mio' }));
  }));

test('a therapist off shift is not offered as a replacement', () =>
  fixture(async (e) => {
    const b = await booking(e, { startAt: jst(18, 12) });
    const before = await e.assignmentCandidates(shop, b.id);
    assert.ok(before.some((x) => x.id === 'listing-mio'));
    await e.staff.saveShiftsAsShop(shop, 'listing-mio', {
      version: 0,
      weekly: days({ 1: [10, 20] }),
      exceptions: [],
    });
    const after = await e.assignmentCandidates(shop, b.id);
    assert.ok(!after.some((x) => x.id === 'listing-mio'));
  }));

// ---- Platform supply governance
test('shop reliability counts shop-side failures, cases and safety, without customer details', () =>
  fixture(async (e, clock) => {
    const cancelled = await booking(e, { startAt: jst(18, 12) });
    await e.cancel(shop, cancelled.id, cancelled.version);
    const visited = await start(e, clock, await booking(e, { startAt: jst(18, 15) }));
    await e.safety(staff, visited.id, 'SOS', visited.version);
    const rows = await e.quality.shops(admin, {});
    const nagi = rows.find((x) => x.storeId === 'store-nagi')!;
    assert.equal(nagi.orders, 2);
    assert.equal(nagi.shopCancelled, 1);
    assert.equal(nagi.safetyEvents, 1);
    assert.deepEqual(nagi.flags, ['SAFETY'], 'rates are flagged only from 10 orders');
    assert.ok(!JSON.stringify(rows).includes('QA Hotel'));
    const finance = await adminMember(e, 'finance-quality', 'FINANCE');
    await assert.rejects(e.quality.shops(finance, {}), code('FORBIDDEN'));
  }));

test('suspending a therapist or shop lists the bookings that still need aftercare', () =>
  fixture(async (e) => {
    const b = await booking(e, { startAt: jst(18, 12) });
    assert.deepEqual(await e.quality.suspensionImpact(admin), []);
    await e.enforce(admin, 'listing-aoi', true, 'Profile photo under review.');
    let impact = await e.quality.suspensionImpact(admin);
    assert.equal(impact.length, 1);
    assert.equal(impact[0].targetType, 'LISTING');
    assert.deepEqual(
      impact[0].bookings.map((x) => x.id),
      [b.id],
    );
    assert.ok(!('address' in impact[0].bookings[0]));
    const store = await e.repo.read((tx) => tx.get<any>('stores', 'store-nagi'));
    await e.admin.review(admin, {
      targetType: 'STORE',
      targetId: 'store-nagi',
      decision: 'SUSPEND',
      version: store.moderationVersion ?? 1,
      reason: 'Compliance investigation of advertising content.',
    });
    impact = await e.quality.suspensionImpact(admin);
    assert.ok(impact.some((x) => x.targetType === 'STORE' && x.bookings[0].id === b.id));
  }));

// ---- Therapist safety conditions
test('a late-night condition applies after shop approval and only to first-time home customers', () =>
  fixture(async (e, clock) => {
    await openAllDay(e);
    const night = jst(19, 23);
    let listing = await e.staff.requestSafetyConditions(staff, { noFirstLateNight: true });
    assert.equal(listing.safetyRequest!.status, 'PENDING');
    assert.ok(await homeQuote(e, night), 'not enforced before approval');
    const otherShop = { ...shop, id: 'quality-mori', storeId: 'store-mori' };
    await assert.rejects(
      e.staff.reviewSafetyConditions(otherShop, 'listing-aoi', { approve: true }),
      code('NOT_FOUND'),
    );
    listing = await e.staff.reviewSafetyConditions(shop, 'listing-aoi', { approve: true });
    assert.ok(listing.safetyConditions!.noFirstLateNight);
    await assert.rejects(homeQuote(e, night), code('STAFF_CONDITIONS'));
    assert.ok(await homeQuote(e, jst(19, 15)), 'daytime is unaffected');
    // The time list follows the same rule, so a first-time viewer is not offered the night.
    const listed = async (viewer?: string) =>
      (
        await e.availability(
          'listing-aoi',
          'store-nagi-60',
          false,
          '',
          'SCHEDULED',
          'shinjuku',
          'HOME_VISIT',
          3,
          viewer,
        )
      ).slots;
    assert.ok(!(await listed()).includes(night));
    assert.ok(!(await listed(customer.id)).includes(night));
    assert.ok((await listed(customer.id)).includes(jst(19, 15)));
    // After one completed visit with this shop the customer is a returning customer.
    await complete(e, clock);
    assert.ok(await homeQuote(e, night));
    assert.ok((await listed(customer.id)).includes(night));
    assert.ok(!(await listed()).includes(night), 'signed-out viewers still see only safe times');
    // Relaxing the condition is the therapist's own choice and applies at once.
    listing = await e.staff.requestSafetyConditions(staff, { noFirstLateNight: false });
    assert.equal(listing.safetyConditions, undefined);
  }));

// ---- Case evidence
test('case photos follow the case visibility and are stored without metadata', () =>
  fixture(async (e) => {
    const b = await booking(e, { startAt: jst(18, 12) });
    const ticket = await e.care.create(
      customer,
      {
        bookingId: b.id,
        category: 'SERVICE_QUALITY',
        subject: 'Room was not prepared',
        description: 'The towels and bed were not ready when the visit began.',
      },
      'evidence-case-1',
    );
    const png = await sharp({ create: { width: 10, height: 6, channels: 3, background: '#eee' } })
      .png()
      .toBuffer();
    const added = await e.care.attach(customer, ticket.id, {
      mime: 'image/png',
      data: png.toString('base64'),
    });
    assert.equal(added.role, 'CUSTOMER');
    const file = await e.care.attachment(shop, ticket.id, added.id);
    assert.equal(file.mime, 'image/jpeg');
    assert.deepEqual([...file.bytes.subarray(0, 3)], [255, 216, 255]);
    const otherShop = { ...shop, id: 'quality-mori', storeId: 'store-mori' };
    await assert.rejects(e.care.attachment(otherShop, ticket.id, added.id), code('NOT_FOUND'));
    assert.equal((await e.care.detail(customer, ticket.id)).attachments.length, 1);
    await assert.rejects(
      e.care.attach(customer, ticket.id, { mime: 'image/png', data: 'bm90IGFuIGltYWdl' }),
      code('INVALID_PHOTO'),
    );
  }));

// ---- Platform to-do board
test('the platform to-do counts each queue for those who may work it', () =>
  fixture(async (e, clock) => {
    const visited = await start(e, clock, await booking(e, { startAt: jst(18, 12) }));
    await e.safety(staff, visited.id, 'SOS', visited.version);
    const owner = await e.adminTodo(admin);
    assert.equal(owner.safetyEvents, 1);
    assert.ok(owner.orderAlerts && owner.cases && owner.finance);
    assert.equal(typeof owner.onboarding, 'number');
    assert.equal(typeof owner.experience, 'number');
    // Finance staff see only the queues their role covers; absent means "not yours".
    const finance = await adminMember(e, 'finance-todo', 'FINANCE');
    const theirs = await e.adminTodo(finance);
    assert.ok(theirs.finance && theirs.orderAlerts);
    assert.equal(theirs.safetyEvents, undefined);
    assert.equal(theirs.cases, undefined);
    assert.equal(theirs.onboarding, undefined);
    await assert.rejects(e.adminTodo(customer), code('FORBIDDEN'));
  }));

test('safety staff can open blocked-message review; every admin can read the to-do board', () => {
  const trust = { ...admin, adminRole: 'TRUST_SAFETY' as const };
  const support = { ...admin, adminRole: 'SUPPORT' as const };
  assert.doesNotThrow(() => authorizeAdminRoute(trust, 'admin/content-reviews', 'GET'));
  assert.throws(() => authorizeAdminRoute(support, 'admin/content-reviews', 'GET'));
  assert.doesNotThrow(() => authorizeAdminRoute(support, 'admin/todo', 'GET'));
});
