import test from 'node:test';
import assert from 'node:assert/strict';
import type { Actor, Listing } from '@hogulink/contracts';
import { DomainError } from '../src/errors.js';
import { fixture, booking, customer, shop, staff } from './helpers/experience-fixture.js';

const minute = 60_000;
const fails = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;

for (const state of ['EN_ROUTE', 'ARRIVED', 'IN_SERVICE'] as const)
  test(`an overdue ${state} visit blocks departure for another scheduled task without changing either order`, () =>
    fixture(async (e, clock) => {
      let first = await booking(e);
      let next = await booking(e, { startAt: e.now() + 360 * minute });
      first = await e.ack(staff, first.id, first.version);
      next = await e.ack(staff, next.id, next.version);
      clock.now = first.quote.startAt;
      for (const event of state === 'EN_ROUTE'
        ? ['EN_ROUTE']
        : state === 'ARRIVED'
          ? ['EN_ROUTE', 'ARRIVED']
          : ['EN_ROUTE', 'ARRIVED', 'START'])
        first = await e.event(staff, first.id, first.version, event);
      clock.now = first.quote.endAt + 45 * minute;
      await assert.rejects(
        e.event(staff, next.id, next.version, 'EN_ROUTE'),
        fails('STAFF_VISIT_IN_PROGRESS'),
      );
      assert.equal((await e.booking(customer, first.id)).status, state);
      const current = await e.booking(shop, next.id);
      assert.equal(current.status, 'CONFIRMED');
      assert.equal(current.version, next.version);
      assert.equal(
        (await e.coordination.detail(customer, next.id)).timeline.filter(
          (item) => item.action === 'STAFF_EN_ROUTE',
        ).length,
        0,
      );
      // Waiting for the customer's completion confirmation does not block the next visit.
      if (state === 'IN_SERVICE') {
        first = await e.event(staff, first.id, first.version, 'COMPLETE');
        assert.equal(first.status, 'AWAITING_COMPLETION');
      } else first = await e.cancel(shop, first.id, first.version);
      assert.equal((await e.event(staff, next.id, next.version, 'EN_ROUTE')).status, 'EN_ROUTE');
    }));

test('two simultaneous departures for the same person have exactly one winner', () =>
  fixture(async (e, clock) => {
    const tasks = await Promise.all([booking(e), booking(e, { startAt: e.now() + 360 * minute })]);
    const confirmed = [];
    for (const task of tasks) confirmed.push(await e.ack(staff, task.id, task.version));
    clock.now = confirmed[1].quote.startAt - 90 * minute;
    const results = await Promise.allSettled(
      confirmed.map((task) => e.event(staff, task.id, task.version, 'EN_ROUTE')),
    );
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert(rejected && rejected.status === 'rejected');
    assert(fails('STAFF_VISIT_IN_PROGRESS')(rejected.reason));
  }));

const soloOwner: Actor = { ...shop, id: 'solo-owner', storeId: 'store-sora' };
for (const [name, change] of [
  ['portrait consent withdrawn', { portraitConsent: false }],
  ['publication suspended', { publicationStatus: 'SUSPENDED' }],
  ['service authorization removed', { offeringIds: [] }],
] as const)
  test(`SOLO free assignment rechecks the current person when ${name}`, () =>
    fixture(async (e) => {
      const b = await booking(e, {
        listingId: 'listing-haru',
        offeringId: 'store-sora-60',
        nominationType: 'FREE',
      });
      await e.repo.transaction(async (tx) => {
        const l = (await tx.get<Listing>('listings', 'listing-haru'))!;
        await tx.put('listings', { ...l, ...change });
      });
      await assert.rejects(e.accept(soloOwner, b.id, b.version), fails('INVALID_ASSIGNMENT'));
      const current = await e.booking(customer, b.id);
      assert.equal(current.status, 'REQUESTED');
      assert.equal(current.assignedStaffId, null);
      assert.equal(current.version, b.version);
      // A failed acceptance can still be closed by the original shop without a fee.
      assert.equal((await e.cancel(soloOwner, b.id, b.version)).capturedAmount, 0);
    }));

test('SOLO instant acceptance cannot confirm a person who went off duty after submission', () =>
  fixture(async (e) => {
    const b = await booking(e, {
      mode: 'INSTANT',
      listingId: 'listing-haru',
      offeringId: 'store-sora-60',
      nominationType: 'FREE',
    });
    const soloStaff: Actor = {
      ...staff,
      id: 'solo-staff',
      staffId: 'staff-haru',
      storeId: 'store-sora',
    };
    await e.staff.duty(soloStaff, false);
    await assert.rejects(e.accept(soloOwner, b.id, b.version), fails('INVALID_ASSIGNMENT'));
    assert.equal((await e.booking(customer, b.id)).status, 'REQUESTED');
  }));
