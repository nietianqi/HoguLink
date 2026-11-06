import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, start, shop, admin, staff } from './helpers/experience-fixture.js';

test('merchant workspace exposes server time and an empty scoped safety summary', () =>
  fixture(async (e) => {
    const workspace = await e.merchant.snapshot(shop);
    assert.equal(workspace.serverNow, e.now());
    assert.deepEqual(workspace.urgentSafetyBookingIds, []);
  }));

test('merchant safety summary deduplicates escalation and incident, stays open after contact, and clears only on resolution', () =>
  fixture(async (e, clock) => {
    const b = await start(e, clock);
    clock.now = b.quote.endAt + 20 * 60000;
    const desk = await e.fulfillment.desk(shop);
    assert.equal(desk.checks[0].status, 'ESCALATED');
    assert.equal(desk.events[0].status, 'OPEN');
    assert.deepEqual((await e.merchant.snapshot(shop)).urgentSafetyBookingIds, [b.id]);
    assert.deepEqual(
      (await e.merchant.snapshot({ ...shop, storeId: 'store-mori' })).urgentSafetyBookingIds,
      [],
    );
    await e.fulfillment.contact(shop, b.id, {
      version: desk.checks[0].version,
      note: 'Contacted the therapist; the safety incident still needs follow-up.',
    });
    assert.deepEqual((await e.merchant.snapshot(shop)).urgentSafetyBookingIds, [b.id]);
    await e.care.resolveSafety(
      admin,
      desk.events[0].id,
      desk.events[0].version ?? 1,
      'Verified the therapist is safe and resolved the incident.',
    );
    assert.deepEqual((await e.merchant.snapshot(shop)).urgentSafetyBookingIds, []);
  }));

test('SOS without an overdue check-in is included, while ordinary waiting checks are not shop actions', () =>
  fixture(async (e, clock) => {
    let b = await start(e, clock);
    clock.now = b.quote.endAt + 15 * 60000;
    assert.equal((await e.fulfillment.desk(shop)).checks[0].status, 'WAITING');
    assert.deepEqual((await e.merchant.snapshot(shop)).urgentSafetyBookingIds, []);
    b = await e.booking(staff, b.id);
    await e.safety(staff, b.id, 'SOS', b.version);
    assert.deepEqual((await e.merchant.snapshot(shop)).urgentSafetyBookingIds, [b.id]);
  }));
