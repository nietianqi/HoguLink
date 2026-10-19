import { registerClock, advanceClock, finishVisit } from './helpers/visit-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Actor, Listing } from '@hogulink/contracts';
import { Repository } from '../src/repository.js';
import { Engine } from '../src/engine.js';
import { seed } from '../src/seed.js';
import { DomainError } from '../src/errors.js';

const owner: Actor = { id: 'owner', role: 'MERCHANT', storeId: 'store-nagi', verificationLevel: 1 };
const stranger: Actor = { ...owner, id: 'other-owner', storeId: 'store-mori' };
const customer: Actor = { id: 'customer', role: 'CUSTOMER', verificationLevel: 1 };
const staff: Actor = {
  id: 'aoi',
  role: 'STAFF',
  staffId: 'staff-aoi',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const code = (value: string) => (error: unknown) =>
  error instanceof DomainError && error.code === value;
async function fixture(fn: (e: Engine) => Promise<void>) {
  const repo = new Repository(undefined, ':memory:');
  await repo.init();
  await seed(repo);
  const clock = { now: Date.UTC(2026, 9, 18, 0) };
  const e = new Engine(repo, () => clock.now);
  registerClock(e, (at) => {
    clock.now = at;
  });
  try {
    await fn(e);
  } finally {
    await repo.close();
  }
}
const quote = (e: Engine, extra = {}) =>
  e.quote(customer, {
    listingId: 'listing-aoi',
    offeringId: 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt: e.now() + 180 * 60000,
    area: 'shinjuku',
    requiredLanguage: '',
    ...extra,
  });
const block = (e: Engine, extra = {}) => ({
  listingId: 'listing-aoi',
  startAt: e.now() + 150 * 60000,
  endAt: e.now() + 270 * 60000,
  reason: 'BREAK',
  ...extra,
});
async function booking(e: Engine, extra = {}) {
  const q = await quote(e, extra),
    h = await e.hold(customer, q.id),
    p = await e.authorizeDemo(customer, h.id, true);
  const input = {
    quoteId: q.id,
    holdId: h.id,
    paymentId: p.id,
    termsAccepted: true,
    policyVersion: q.cancellationPolicy.version,
    address: {
      name: 'Test Guest',
      area: 'shinjuku',
      type: 'HOTEL',
      detail: 'Test address 1-2-3',
      hotelName: 'Demo Hotel',
      room: '101',
      hotelPermission: true,
    },
  };
  return { q, h, p, input };
}

test('merchant snapshot is tenant scoped, excludes PSP routing and rejects other roles', () =>
  fixture(async (e) => {
    const s = await e.merchant.snapshot(owner);
    assert.equal(s.store.id, 'store-nagi');
    assert.ok(!('pspAccount' in s.store));
    assert.ok(s.listings.every((x) => x.storeId === 'store-nagi'));
    assert.ok(s.offerings.every((x) => x.storeId === 'store-nagi'));
    assert.deepEqual(s.totals, { captured: 0, refunded: 0, net: 0, platform: 0, afterFees: 0 });
    await assert.rejects(e.merchant.snapshot(customer), code('FORBIDDEN'));
  }));

test('blocked time removes nominated availability while FREE can use other team capacity', () =>
  fixture(async (e) => {
    const target = (await e.availability('listing-aoi', 'store-nagi-60')).slots[0];
    assert.ok(target);
    const q = await quote(e, { startAt: target });
    const b = await e.merchant.block(
      owner,
      block(e, { startAt: target - 30 * 60000, endAt: target + 90 * 60000 }),
      'block-key-01',
    );
    assert.ok(!(await e.availability('listing-aoi', 'store-nagi-60')).slots.includes(target));
    assert.ok((await e.availability('listing-aoi', 'store-nagi-60', true)).slots.includes(target));
    await assert.rejects(e.hold(customer, q.id), code('SLOT_CONFLICT'));
    await e.merchant.releaseBlock(owner, b.id, { version: b.version });
    assert.ok((await e.availability('listing-aoi', 'store-nagi-60')).slots.includes(target));
  }));

test('blocked time retries are idempotent and changed retry payload is rejected', () =>
  fixture(async (e) => {
    const a = await e.merchant.block(owner, block(e), 'same-retry-key');
    const b = await e.merchant.block(owner, block(e), 'same-retry-key');
    assert.equal(a.id, b.id);
    assert.equal((await e.merchant.snapshot(owner)).blocks.length, 1);
    await assert.rejects(
      e.merchant.block(owner, block(e, { reason: 'TRAINING' }), 'same-retry-key'),
      code('IDEMPOTENCY_CONFLICT'),
    );
  }));

test('time blocks protect shop scope, valid dates, version checks and existing travel buffers', () =>
  fixture(async (e) => {
    await assert.rejects(e.merchant.block(stranger, block(e), 'scope-test-key'), code('NOT_FOUND'));
    await assert.rejects(
      e.merchant.block(owner, block(e, { startAt: e.now() - 1 }), 'past-time-key'),
      code('INVALID_TIME'),
    );
    const q = await quote(e);
    await e.hold(customer, q.id);
    await assert.rejects(
      e.merchant.block(
        owner,
        block(e, { startAt: q.startAt - 20 * 60000, endAt: q.startAt - 5 * 60000 }),
        'buffer-test-key',
      ),
      code('SLOT_CONFLICT'),
    );
    const b = await e.merchant.block(
      owner,
      block(e, { startAt: q.endAt + 31 * 60000, endAt: q.endAt + 90 * 60000 }),
      'after-buffer-key',
    );
    await assert.rejects(
      e.merchant.releaseBlock(stranger, b.id, { version: 1 }),
      code('NOT_FOUND'),
    );
    await assert.rejects(
      e.merchant.releaseBlock(owner, b.id, { version: 2 }),
      code('VERSION_CONFLICT'),
    );
  }));

test('concurrent checkout and blocked time have one winner in the shared database interval', () =>
  fixture(async (e) => {
    const q = await quote(e);
    const results = await Promise.allSettled([
      e.hold(customer, q.id),
      e.merchant.block(owner, block(e), 'concurrent-key'),
    ]);
    assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(
      results.filter((x) => x.status === 'rejected' && code('SLOT_CONFLICT')(x.reason)).length,
      1,
    );
  }));

test('price and pause updates are versioned, shop scoped and cannot grant regulatory approval', () =>
  fixture(async (e) => {
    await assert.rejects(
      e.merchant.service(owner, 'store-nagi-60', {
        version: 1,
        price: 8000,
        transportFee: 1000,
        active: true,
        approved: true,
      }),
    );
    await assert.rejects(
      e.merchant.service(stranger, 'store-nagi-60', {
        version: 1,
        price: 8000,
        transportFee: 1000,
        active: true,
      }),
      code('NOT_FOUND'),
    );
    const q = await quote(e),
      h = await e.hold(customer, q.id);
    const o = await e.merchant.service(owner, 'store-nagi-60', {
      version: 1,
      price: 8200,
      transportFee: 1200,
      active: false,
    });
    assert.equal(o.version, 2);
    assert.ok(!(await e.publicCatalog()).offerings.some((x) => x.id === o.id));
    assert.ok((await e.merchant.snapshot(owner)).offerings.some((x) => x.id === o.id));
    await assert.rejects(e.authorizeDemo(customer, h.id, true), code('PRICE_CHANGED'));
    await assert.rejects(
      e.merchant.service(owner, o.id, {
        version: 1,
        price: 8000,
        transportFee: 1000,
        active: true,
      }),
      code('VERSION_CONFLICT'),
    );
    await e.releaseCheckoutHold(customer, h.id);
    await e.merchant.service(owner, o.id, {
      version: 2,
      price: 8200,
      transportFee: 1200,
      active: true,
    });
    assert.equal((await quote(e)).total, 9900);
  }));

test('editing a submitted service keeps the order frozen and completion charges its original total', () =>
  fixture(async (e) => {
    const { q, input } = await booking(e);
    let b = await e.createBooking(customer, input, 'create-frozen-order');
    await e.merchant.service(owner, q.offeringId, {
      version: 1,
      price: 9900,
      transportFee: 500,
      active: false,
    });
    b = await e.ack(staff, b.id, b.version);
    b = await finishVisit(e, b, staff, customer);
    assert.equal(b.capturedAmount, q.total);
    assert.equal(b.quote.total, q.total);
    assert.equal((await e.merchant.snapshot(owner)).totals.captured, q.total);
  }));

test('changed shop rules invalidate pending quotes while preserving submitted acceptance snapshots', () =>
  fixture(async (e) => {
    const { input } = await booking(e);
    const b = await e.createBooking(customer, input, 'rules-old-booking');
    const pending = await quote(e, { startAt: e.now() + 360 * 60000 });
    const s = await e.merchant.settings(owner, {
      version: 1,
      acceptanceMode: 'MANUAL',
      emergencyContact: 'demo-private-contact',
    });
    assert.equal(s.ruleVersion, 2);
    assert.ok(!('pspAccount' in s));
    await assert.rejects(e.hold(customer, pending.id), code('SHOP_RULES_CHANGED'));
    assert.equal((await e.booking(owner, b.id)).acceptanceMode, 'AUTO_PREAUTHORIZED');
    await assert.rejects(
      e.merchant.settings(owner, {
        version: 1,
        acceptanceMode: 'MANUAL',
        emergencyContact: 'valid-contact',
      }),
      code('VERSION_CONFLICT'),
    );
    await assert.rejects(quote(e, { bookingMode: 'INSTANT' }), code('INSTANT_UNAVAILABLE'));
  }));

test('SOLO ownership cannot be enabled or replaced through ordinary shop settings', () =>
  fixture(async (e) => {
    await assert.rejects(
      e.merchant.settings(owner, {
        version: 1,
        acceptanceMode: 'SOLO',
        emergencyContact: 'valid-contact',
      }),
      code('INVALID_STATE'),
    );
    await assert.rejects(
      e.merchant.settings(
        { ...owner, storeId: 'store-sora' },
        { version: 1, acceptanceMode: 'MANUAL', emergencyContact: 'valid-contact' },
      ),
      code('INVALID_STATE'),
    );
  }));

test('assignment candidates respect selected language, team identity and blocked time', () =>
  fixture(async (e) => {
    const { input } = await booking(e, { nominationType: 'FREE', requiredLanguage: 'en' });
    const b = await e.createBooking(customer, input, 'assignment-candidate-key');
    const before = await e.assignmentCandidates(owner, b.id);
    assert.ok(before.length > 0);
    assert.ok(before.every((x) => x.storeId === 'store-nagi' && x.languages.includes('en')));
    const candidate = before.find((x) => x.staffId !== 'staff-aoi')!;
    assert.ok(candidate);
    await e.merchant.block(owner, block(e, { listingId: candidate.id }), 'candidate-block-key');
    assert.ok(!(await e.assignmentCandidates(owner, b.id)).some((x) => x.id === candidate.id));
    await assert.rejects(e.assignmentCandidates(stranger, b.id), code('NOT_FOUND'));
  }));
