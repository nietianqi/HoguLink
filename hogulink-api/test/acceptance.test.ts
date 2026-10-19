import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  acceptanceScopeInput,
  type AcceptanceScope,
  type Actor,
  type Booking,
  type Listing,
  type Store,
} from '@hogulink/contracts';
import { Engine } from '../src/engine.js';
import { Repository } from '../src/repository.js';
import { seed } from '../src/seed.js';
import { DomainError } from '../src/errors.js';

const owner: Actor = {
  id: 'owner-nagi',
  role: 'MERCHANT',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const customer: Actor = { id: 'acceptance-customer', role: 'CUSTOMER', verificationLevel: 1 };
const worker: Actor = {
  id: 'aoi',
  role: 'STAFF',
  staffId: 'staff-aoi',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const code = (name: string) => (e: unknown) => e instanceof DomainError && e.code === name;
async function fixture(fn: (e: Engine) => Promise<void>) {
  const repo = new Repository('', ':memory:');
  await repo.init();
  await seed(repo);
  const now = Date.UTC(2026, 9, 19, 0); // Monday, 09:00 JST.
  const e = new Engine(repo, () => now);
  await repo.transaction(async (tx) => {
    for (const l of await tx.list<Listing>('listings'))
      await tx.put('listings', { ...l, dutyUpdatedAt: now });
  });
  try {
    await fn(e);
  } finally {
    await repo.close();
  }
}
async function rules(
  e: Engine,
  extra: Partial<AcceptanceScope> = {},
  overrides: Record<string, unknown> = {},
) {
  const { store } = await e.merchant.snapshot(owner);
  const scope = Object.fromEntries(
    Object.keys(acceptanceScopeInput.shape).map((key) => [
      key,
      store.acceptanceRule![key as keyof typeof store.acceptanceRule],
    ]),
  );
  return e.merchant.settings(owner, {
    version: store.ruleVersion,
    acceptanceMode: 'AUTO_PREAUTHORIZED',
    emergencyContact: store.emergencyContact,
    acceptanceRule: { ...scope, ...extra },
    confirmAuthorization: true,
    ...overrides,
  });
}
async function prepare(e: Engine, extra: Record<string, unknown> = {}, actor = customer) {
  const q = await e.quote(actor, {
    listingId: 'listing-aoi',
    offeringId: 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt: e.now() + 3 * 3600000,
    area: 'shinjuku',
    requiredLanguage: '',
    ...extra,
  });
  const h = await e.hold(actor, q.id);
  const p = await e.authorizeDemo(actor, h.id, true);
  const data = {
    quoteId: q.id,
    holdId: h.id,
    paymentId: p.id,
    policyVersion: q.cancellationPolicy.version,
    termsAccepted: true,
    address: {
      name: 'QA Guest',
      type: 'HOTEL',
      area: q.area,
      detail: 'QA address 123',
      hotelName: 'QA Hotel',
      room: '101',
      hotelPermission: true,
    },
  };
  return { q, h, p, data, actor, key: randomUUID() };
}
async function create(e: Engine, extra: Record<string, unknown> = {}, actor = customer) {
  const prepared = await prepare(e, extra, actor);
  return e.createBooking(actor, prepared.data, prepared.key);
}

test('authorized acceptance freezes the full rule privately and still requires therapist confirmation', () =>
  fixture(async (e) => {
    await rules(e, { dailyLimit: 5 });
    const p = await prepare(e);
    const b = await e.createBooking(customer, p.data, p.key);
    assert.equal(b.status, 'ACCEPTED');
    assert.equal(b.staffTaskStatus, 'OFFERED');
    assert.equal(b.acceptanceDecision?.outcome, 'AUTO_ACCEPTED');
    assert.equal(b.acceptanceDecision?.rule, undefined);
    const privateOrder = await e.booking(owner, b.id);
    assert.equal(privateOrder.acceptanceDecision?.rule?.authorizedBy, owner.id);
    assert.equal(privateOrder.acceptanceDecision?.rule?.version, 2);
    assert.equal((await e.booking(worker, b.id)).acceptanceDecision?.rule, undefined);
    const retry = await e.createBooking(customer, p.data, p.key);
    assert.equal(retry.id, b.id);
    assert.equal(retry.acceptanceDecision?.rule, undefined);
    await rules(e, { active: false }, { confirmAuthorization: false });
    assert.equal((await e.booking(owner, b.id)).acceptanceDecision?.rule?.active, true);
    assert.equal((await e.ack(worker, b.id, b.version)).status, 'CONFIRMED');
    const history = (await e.merchant.snapshot(owner)).acceptanceHistory;
    assert.deepEqual(
      history.map((r) => r.version),
      [3, 2, 1],
    );
    assert.equal(history[0].active, false);
    assert.equal(
      (await e.publicCatalog()).stores.some((s) => 'acceptanceRule' in s),
      false,
    );
  }));

for (const [name, scope, reason] of [
  ['paused', { active: false }, 'PAUSED'],
  ['service excluded', { offeringIds: ['store-nagi-90'] }, 'OFFERING'],
  ['therapist excluded', { listingIds: ['listing-ren'] }, 'STAFF'],
  ['area excluded', { areas: ['taito'] }, 'AREA'],
  ['start before window', { startHour: 13 }, 'TIME'],
  ['service ends after window', { endHour: 12 }, 'TIME'],
  ['total below minimum', { minTotal: 9000 }, 'AMOUNT'],
  ['total above maximum', { maxTotal: 8600 }, 'AMOUNT'],
] as const)
  test(`scheduled ${name} goes to shop review without notifying a therapist`, () =>
    fixture(async (e) => {
      await rules(e, scope as Partial<AcceptanceScope>);
      const p = await prepare(e);
      assert.equal((await e.checkout(customer, p.h.id)).visit.acceptanceMode, 'MANUAL');
      const b = await e.createBooking(customer, p.data, p.key);
      assert.equal(b.status, 'REQUESTED');
      assert.equal(b.merchantAcceptance, 'PENDING');
      assert.equal(b.staffTaskStatus, 'NOT_SENT');
      assert.equal(b.acceptanceMode, 'MANUAL');
      assert.equal((await e.booking(owner, b.id)).acceptanceDecision?.reason, reason);
      await assert.rejects(e.ack(worker, b.id, b.version), code('INVALID_STATE'));
      const accepted = await e.accept(owner, b.id, b.version);
      assert.equal(accepted.merchantAcceptance, 'MANUALLY_ACCEPTED');
      assert.equal((await e.ack(worker, b.id, accepted.version)).status, 'CONFIRMED');
    }));

test('missing legacy authorization fails closed and does not invent a grant', () =>
  fixture(async (e) => {
    await e.repo.transaction(async (tx) => {
      const store = (await tx.get<Store>('stores', 'store-nagi'))!;
      delete store.acceptanceRule;
      await tx.put('stores', store);
    });
    const b = await create(e);
    assert.equal(b.status, 'REQUESTED');
    assert.equal(b.acceptanceDecision?.reason, 'NO_RULE');
    const catalog = await e.publicCatalog({ mode: 'INSTANT' });
    assert(!catalog.listings.some((x) => x.storeId === 'store-nagi'));
    await assert.rejects(
      prepare(e, {
        listingId: 'listing-ren',
        bookingMode: 'INSTANT',
        startAt: e.now() + 90 * 60000,
      }),
      code('INSTANT_UNAVAILABLE'),
    );
  }));

test('FREE reservations choose an authorized available therapist without changing original nomination', () =>
  fixture(async (e) => {
    await rules(e, { listingIds: ['listing-ren'] });
    const p = await prepare(e, { nominationType: 'FREE', requiredLanguage: 'en' });
    assert.equal(p.h.listingId, 'listing-ren');
    const b = await e.createBooking(customer, p.data, p.key);
    assert.equal(b.status, 'ACCEPTED');
    assert.equal(b.assignedStaffId, null);
    assert.equal(b.selectedStaffId, null);
  }));

test('time and inclusive amount boundaries use the complete frozen quote', () =>
  fixture(async (e) => {
    await rules(e, { startHour: 12, endHour: 13, minTotal: 8700, maxTotal: 8700 });
    assert.equal((await create(e)).status, 'ACCEPTED');
  }));

test('two simultaneous submissions cannot exceed a daily limit, retries do not consume another quota', () =>
  fixture(async (e) => {
    await rules(e, { dailyLimit: 1 });
    const p1 = await prepare(e);
    const p2 = await prepare(
      e,
      { listingId: 'listing-ren' },
      { ...customer, id: 'second-customer' },
    );
    const orders = await Promise.all([p1, p2].map((p) => e.createBooking(p.actor, p.data, p.key)));
    assert.deepEqual(orders.map((b) => b.status).sort(), ['ACCEPTED', 'REQUESTED']);
    assert.equal(orders[1].acceptanceDecision?.reason, 'DAILY_LIMIT');
    const retry = await e.createBooking(p1.actor, p1.data, p1.key);
    assert.equal(retry.id, orders[0].id);
    await e.cancel(customer, orders[0].id, orders[0].version);
    assert.equal(
      (await create(e, { startAt: e.now() + 6 * 3600000 })).acceptanceDecision?.reason,
      'DAILY_LIMIT',
    );
    assert.equal(
      (await create(e, { startAt: e.now() + 18 * 3600000 }, { ...customer, id: 'next-day' }))
        .status,
      'ACCEPTED',
    );
  }));

test('instant availability, quote, and hold all honor service, staff, area, time, price and pause rules', () =>
  fixture(async (e) => {
    await rules(e, { listingIds: ['listing-ren'], areas: ['taito'], maxTotal: 9000 });
    assert.equal(
      (await e.availability('listing-aoi', 'store-nagi-60', false, '', 'INSTANT', 'taito')).slots
        .length,
      0,
    );
    assert.equal(
      (await e.availability('listing-aoi', 'store-nagi-60', true, 'en', 'INSTANT', 'shinjuku'))
        .slots.length,
      0,
    );
    const slots = (
      await e.availability('listing-aoi', 'store-nagi-60', true, 'en', 'INSTANT', 'taito')
    ).slots;
    assert(slots.length > 0);
    const p = await prepare(e, {
      bookingMode: 'INSTANT',
      nominationType: 'FREE',
      area: 'taito',
      startAt: slots[0],
    });
    assert.equal(p.h.listingId, 'listing-ren');
    assert.equal((await e.createBooking(customer, p.data, p.key)).status, 'ACCEPTED');
    await rules(e, { active: false });
    assert.equal(
      (await e.availability('listing-ren', 'store-nagi-60', false, '', 'INSTANT', 'taito')).slots
        .length,
      0,
    );
    assert(
      !(await e.publicCatalog({ mode: 'INSTANT' })).listings.some(
        (x) => x.storeId === 'store-nagi',
      ),
    );
  }));

test('instant quota is checked again after payment authentication and cannot silently become manual', () =>
  fixture(async (e) => {
    await rules(e, { dailyLimit: 1 });
    const p = await prepare(e, { bookingMode: 'INSTANT', startAt: e.now() + 90 * 60000 });
    await create(e, { listingId: 'listing-ren' }, { ...customer, id: 'quota-racer' });
    await assert.rejects(e.createBooking(customer, p.data, p.key), code('INSTANT_UNAVAILABLE'));
    assert.equal((await e.bookings(customer)).length, 0);
    const payment = await e.repo.transaction((tx) =>
      tx.get<{ status: string; bookingId?: string }>('payments', p.p.id),
    );
    assert.equal(payment?.status, 'AUTHORIZED');
    assert.equal(payment?.bookingId, undefined);
  }));

test('rule changes invalidate checkout holds, while existing orders retain their acceptance and money', () =>
  fixture(async (e) => {
    const b = await create(e);
    const p = await prepare(e, { startAt: e.now() + 6 * 3600000 });
    await rules(e, { areas: ['taito'] });
    await assert.rejects(e.createBooking(customer, p.data, p.key), code('SHOP_RULES_CHANGED'));
    const preserved = await e.booking(owner, b.id);
    assert.equal(preserved.status, 'ACCEPTED');
    assert.equal(preserved.quote.total, 8700);
    assert(preserved.acceptanceDecision?.rule?.areas.includes('shinjuku'));
  }));

test('authorization and tenant validation reject forged scope, stale versions and other roles', () =>
  fixture(async (e) => {
    await assert.rejects(
      rules(e, { dailyLimit: 5 }, { confirmAuthorization: false }),
      code('ACCEPTANCE_AUTHORIZATION_REQUIRED'),
    );
    for (const extra of [
      { listingIds: ['listing-yuki'] },
      { offeringIds: ['store-mori-60'] },
      { areas: ['outside'] },
    ])
      await assert.rejects(rules(e, extra), code('INVALID_ACCEPTANCE_SCOPE'));
    await rules(e, { dailyLimit: 5 });
    await assert.rejects(rules(e, { dailyLimit: 6 }, { version: 1 }), code('VERSION_CONFLICT'));
    for (const actor of [customer, worker])
      await assert.rejects(
        e.merchant.settings(actor, {
          version: 2,
          acceptanceMode: 'MANUAL',
          emergencyContact: 'valid-contact',
        }),
        code('FORBIDDEN'),
      );
    const snapshot = await e.merchant.snapshot({ ...owner, storeId: 'store-mori' });
    assert.equal(snapshot.acceptanceHistory.length, 0);
    assert.equal((await e.merchant.snapshot(owner)).store.acceptanceRule?.dailyLimit, 5);
  }));

test('immediate pause remains possible after a previously authorized therapist is suspended', () =>
  fixture(async (e) => {
    await e.repo.transaction(async (tx) => {
      const l = (await tx.get<Listing>('listings', 'listing-aoi'))!;
      await tx.put('listings', { ...l, publicationStatus: 'SUSPENDED' });
    });
    assert.equal(
      (await rules(e, { active: false }, { confirmAuthorization: false })).acceptanceRule?.active,
      false,
    );
  }));

test('re-enabling automatic mode requires fresh shop authorization and records a new rule version', () =>
  fixture(async (e) => {
    await e.merchant.settings(owner, {
      version: 1,
      acceptanceMode: 'MANUAL',
      emergencyContact: 'valid-contact',
    });
    await assert.rejects(
      e.merchant.settings(owner, {
        version: 2,
        acceptanceMode: 'AUTO_PREAUTHORIZED',
        emergencyContact: 'valid-contact',
      }),
      code('ACCEPTANCE_AUTHORIZATION_REQUIRED'),
    );
    const next = await e.merchant.settings(owner, {
      version: 2,
      acceptanceMode: 'AUTO_PREAUTHORIZED',
      emergencyContact: 'valid-contact',
      confirmAuthorization: true,
    });
    assert.equal(next.acceptanceRule?.version, 3);
    assert.equal(next.acceptanceRule?.authorizedBy, owner.id);
  }));

test('scope validation rejects unbounded or inverted values and client-supplied authorization metadata', () => {
  const valid = {
    active: true,
    instantEnabled: true,
    offeringIds: ['o'],
    listingIds: ['l'],
    areas: ['a'],
    startHour: 0,
    endHour: 24,
    minTotal: 0,
    maxTotal: 100,
    dailyLimit: 1,
  };
  for (const extra of [
    { offeringIds: [] },
    { listingIds: [] },
    { areas: [] },
    { startHour: 22, endHour: 9 },
    { minTotal: 101 },
    { dailyLimit: 0 },
    { dailyLimit: 1.5 },
    { authorizedBy: 'forged' },
  ])
    assert.equal(acceptanceScopeInput.safeParse({ ...valid, ...extra }).success, false);
});

test('switching to manual needs no new grant even when the UI returns scope choices in a different order', () =>
  fixture(async (e) => {
    const { store } = await e.merchant.snapshot(owner);
    const { version: _v, authorizedAt: _at, authorizedBy: _by, ...scope } = store.acceptanceRule!;
    const result = await e.merchant.settings(owner, {
      version: store.ruleVersion,
      acceptanceMode: 'MANUAL',
      emergencyContact: store.emergencyContact,
      acceptanceRule: {
        ...scope,
        listingIds: [...scope.listingIds].reverse(),
        areas: [...scope.areas].reverse(),
      },
      confirmAuthorization: false,
    });
    assert.equal(result.acceptanceMode, 'MANUAL');
    assert.equal(result.acceptanceRule?.version, 1);
    assert.equal((await e.merchant.snapshot(owner)).acceptanceHistory.length, 1);
  }));
