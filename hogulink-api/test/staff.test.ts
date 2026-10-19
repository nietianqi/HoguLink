import test from 'node:test';
import assert from 'node:assert/strict';
import type { Actor, Listing, Store } from '@hogulink/contracts';
import { Repository } from '../src/repository.js';
import { Engine } from '../src/engine.js';
import { seed } from '../src/seed.js';
import { DomainError } from '../src/errors.js';
import { timeOffHistory } from '../src/staff.js';
import type { TimeOffRequest } from '@hogulink/contracts';
test('recent history never hides old pending approvals and does not reorder the source', () => {
  const requests = Array.from({ length: 140 }, (_, i) => ({
    id: String(i),
    createdAt: i,
    status: i < 20 ? 'PENDING' : 'APPROVED',
  })) as TimeOffRequest[];
  const result = timeOffHistory(requests);
  assert.equal(result.length, 120);
  assert.equal(result.filter((x) => x.status === 'PENDING').length, 20);
  assert.equal(result[0].id, '19');
  assert.equal(requests[0].id, '0');
});
const staff: Actor = {
  id: 'aoi',
  role: 'STAFF',
  staffId: 'staff-aoi',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const owner: Actor = { id: 'owner', role: 'MERCHANT', storeId: 'store-nagi', verificationLevel: 1 };
const other: Actor = { ...owner, storeId: 'store-mori' };
const customer: Actor = { id: 'customer', role: 'CUSTOMER', verificationLevel: 1 };
const code = (v: string) => (e: unknown) => e instanceof DomainError && e.code === v;
async function fixture(fn: (e: Engine, advance: (ms: number) => void) => Promise<void>) {
  const repo = new Repository(undefined, ':memory:');
  await repo.init();
  await seed(repo);
  let now = Date.UTC(2026, 9, 18, 0);
  const e = new Engine(repo, () => now);
  try {
    await fn(e, (ms) => {
      now += ms;
    });
  } finally {
    await repo.close();
  }
}
const input = (e: Engine, extra = {}) => ({
  startAt: e.now() + 3 * 3600000,
  endAt: e.now() + 4 * 3600000,
  reason: 'BREAK',
  ...extra,
});
const quote = (e: Engine, startAt: number) =>
  e.quote(customer, {
    listingId: 'listing-aoi',
    offeringId: 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt,
    area: 'shinjuku',
    requiredLanguage: '',
  });
test('staff snapshot includes only own membership, calendar, requests and safety, without payment routing', () =>
  fixture(async (e) => {
    const s = await e.staff.snapshot(staff);
    assert.equal(s.listing.id, 'listing-aoi');
    assert.ok(!('pspAccount' in s.store));
    assert.ok(!('totals' in s));
    assert.ok(!('listings' in s));
    await assert.rejects(e.staff.snapshot(owner), code('FORBIDDEN'));
    await assert.rejects(e.staff.snapshot({ ...staff, storeId: 'store-mori' }), code('NOT_FOUND'));
  }));
test('pending time off leaves availability unchanged; shop approval blocks the shared calendar', () =>
  fixture(async (e) => {
    const slot = (await e.availability('listing-aoi', 'store-nagi-60')).slots[0];
    const r = await e.staff.request(
      staff,
      input(e, { startAt: slot - 30 * 60000, endAt: slot + 90 * 60000 }),
      'pending-approval',
    );
    assert.ok((await e.availability('listing-aoi', 'store-nagi-60')).slots.includes(slot));
    const approved = await e.staff.review(owner, r.id, {
      version: r.version,
      decision: 'APPROVED',
    });
    assert.equal(approved.status, 'APPROVED');
    assert.ok(approved.blockId);
    assert.ok(!(await e.availability('listing-aoi', 'store-nagi-60')).slots.includes(slot));
    assert.equal((await e.merchant.snapshot(owner)).timeOffRequests[0].id, r.id);
    assert.equal((await e.staff.snapshot(staff)).blocks[0].id, approved.blockId);
    const block = (await e.merchant.snapshot(owner)).blocks[0];
    await e.merchant.releaseBlock(owner, block.id, { version: block.version });
    assert.ok((await e.availability('listing-aoi', 'store-nagi-60')).slots.includes(slot));
  }));
test('time off submission is idempotent, validates input, and rejects overlapping pending requests', () =>
  fixture(async (e) => {
    const r = await e.staff.request(staff, input(e), 'retry-request-01');
    assert.equal((await e.staff.request(staff, input(e), 'retry-request-01')).id, r.id);
    await assert.rejects(
      e.staff.request(staff, input(e, { reason: 'TRAINING' }), 'retry-request-01'),
      code('IDEMPOTENCY_CONFLICT'),
    );
    await assert.rejects(
      e.staff.request(staff, input(e), 'retry-request-02'),
      code('SLOT_CONFLICT'),
    );
    await assert.rejects(
      e.staff.request(staff, input(e, { startAt: e.now() - 1 }), 'past-request-01'),
      code('INVALID_TIME'),
    );
    await assert.rejects(
      e.staff.request(staff, input(e, { endAt: e.now() + 20 * 86400000 }), 'long-request-01'),
      code('INVALID_TIME'),
    );
    await assert.rejects(e.staff.request(staff, input(e), ''), code('IDEMPOTENCY_REQUIRED'));
    await assert.rejects(
      e.staff.request(staff, { ...input(e), staffId: 'staff-mio' }, 'spoof-request-01'),
    );
  }));
test('approval rechecks booking holds and travel buffers; conflict keeps request pending', () =>
  fixture(async (e) => {
    const start = e.now() + 3 * 3600000;
    const r = await e.staff.request(
      staff,
      input(e, { startAt: start - 20 * 60000, endAt: start - 5 * 60000 }),
      'approval-race-01',
    );
    const q = await quote(e, start);
    await e.hold(customer, q.id);
    await assert.rejects(
      e.staff.review(owner, r.id, { version: 1, decision: 'APPROVED' }),
      code('SLOT_CONFLICT'),
    );
    assert.equal((await e.staff.snapshot(staff)).requests[0].status, 'PENDING');
    assert.equal((await e.staff.snapshot(staff)).blocks.length, 0);
    await assert.rejects(
      e.staff.request(
        staff,
        input(e, { startAt: start - 20 * 60000, endAt: start - 5 * 60000 }),
        'hold-buffer-01',
      ),
      code('SLOT_CONFLICT'),
    );
  }));
test('staff cannot approve, other shops and other staff cannot access a request, and stale reviews fail', () =>
  fixture(async (e) => {
    const r = await e.staff.request(staff, input(e), 'scope-request-01');
    await assert.rejects(
      e.staff.review(staff, r.id, { version: 1, decision: 'APPROVED' }),
      code('FORBIDDEN'),
    );
    await assert.rejects(
      e.staff.review(other, r.id, { version: 1, decision: 'APPROVED' }),
      code('NOT_FOUND'),
    );
    await assert.rejects(
      e.staff.review({ ...staff, staffId: 'staff-mio' }, r.id, {
        version: 1,
        decision: 'WITHDRAWN',
      }),
      code('NOT_FOUND'),
    );
    assert.equal((await e.staff.snapshot({ ...staff, staffId: 'staff-mio' })).requests.length, 0);
    await assert.rejects(
      e.staff.review(owner, r.id, { version: 99, decision: 'APPROVED' }),
      code('VERSION_CONFLICT'),
    );
    await e.staff.review(staff, r.id, { version: 1, decision: 'WITHDRAWN' });
    await assert.rejects(
      e.staff.review(owner, r.id, { version: 1, decision: 'APPROVED' }),
      code('VERSION_CONFLICT'),
    );
    await assert.rejects(
      e.staff.review(owner, r.id, { version: 2, decision: 'APPROVED' }),
      code('INVALID_STATE'),
    );
  }));
test('shop rejection and staff withdrawal never create booking blocks; expired requests cannot be approved', () =>
  fixture(async (e, advance) => {
    const r = await e.staff.request(staff, input(e), 'rejected-request');
    await e.staff.review(owner, r.id, { version: 1, decision: 'REJECTED' });
    const w = await e.staff.request(staff, input(e), 'withdraw-request');
    await e.staff.review(staff, w.id, { version: 1, decision: 'WITHDRAWN' });
    const x = await e.staff.request(staff, input(e), 'expired-request');
    advance(3 * 3600000);
    const snapshot = await e.staff.snapshot(staff);
    assert.equal(snapshot.requests.find((v) => v.id === x.id)?.status, 'EXPIRED');
    assert.equal(snapshot.blocks.length, 0);
    await assert.rejects(
      e.staff.review(owner, x.id, { version: 1, decision: 'APPROVED' }),
      code('VERSION_CONFLICT'),
    );
  }));
test('standby protects membership and stale updates, while always allowing an eligible account to go offline', () =>
  fixture(async (e) => {
    const s = await e.staff.snapshot(staff);
    const updated = await e.duty(staff, true, s.listing.dutyUpdatedAt);
    assert.ok(updated.dutyUpdatedAt > s.listing.dutyUpdatedAt);
    await assert.rejects(e.duty(staff, false, s.listing.dutyUpdatedAt), code('VERSION_CONFLICT'));
    await e.repo.transaction(async (tx) => {
      const x = (await tx.get<Listing>('listings', 'listing-aoi'))!;
      x.publicationStatus = 'SUSPENDED';
      await tx.put('listings', x);
    });
    await assert.rejects(e.duty(staff, true), code('LISTING_UNAVAILABLE'));
    assert.equal((await e.duty(staff, false)).onDuty, false);
    await assert.rejects(e.duty({ ...staff, storeId: 'store-mori' }, true), code('NOT_FOUND'));
  }));
test('shop blocks and other staff requests remain private in the therapist snapshot', () =>
  fixture(async (e) => {
    await e.merchant.block(owner, { ...input(e), listingId: 'listing-mio' }, 'private-shop-block');
    await e.staff.request(
      { ...staff, staffId: 'staff-mio' },
      input(e, { startAt: e.now() + 5 * 3600000, endAt: e.now() + 6 * 3600000 }),
      'private-mio-request',
    );
    const s = await e.staff.snapshot(staff);
    assert.equal(s.blocks.length, 0);
    assert.equal(s.requests.length, 0);
    await e.repo.transaction(async (tx) => {
      const store = (await tx.get<Store>('stores', 'store-nagi'))!;
      store.active = false;
      await tx.put('stores', store);
    });
    await assert.rejects(
      e.staff.request(staff, input(e), 'inactive-store-01'),
      code('LISTING_UNAVAILABLE'),
    );
  }));
