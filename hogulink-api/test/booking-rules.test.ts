import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  makeCancellationPolicy,
  scheduledCancellationBps,
  storeBookingRulesInput,
  type Actor,
  type Booking,
  type Store,
} from '@hogulink/contracts';
import { Engine } from '../src/engine.js';
import { Repository } from '../src/repository.js';
import { seed } from '../src/seed.js';
import { DomainError } from '../src/errors.js';
import { registerClock, finishVisit } from './helpers/visit-fixture.js';

const owner: Actor = {
  id: 'terms-owner',
  role: 'MERCHANT',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const customer: Actor = { id: 'terms-customer', role: 'CUSTOMER', verificationLevel: 1 };
const worker: Actor = {
  id: 'aoi',
  role: 'STAFF',
  staffId: 'staff-aoi',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const minute = 60000;
const code = (name: string) => (error: unknown) =>
  error instanceof DomainError && error.code === name;
async function fixture(fn: (e: Engine, clock: { now: number }) => Promise<void>) {
  const repo = new Repository('', ':memory:');
  await repo.init();
  await seed(repo);
  const clock = { now: Date.UTC(2026, 9, 19, 0) };
  const e = new Engine(repo, () => clock.now);
  registerClock(e, (at) => {
    clock.now = at;
  });
  try {
    await fn(e, clock);
  } finally {
    await repo.close();
  }
}
async function update(e: Engine, extra: Record<string, unknown> = {}, actor = owner) {
  const snapshot = await e.merchant.snapshot(actor);
  return e.merchant.bookingRules(actor, {
    version: snapshot.bookingRules.version,
    nominationFee: 1200,
    templateId: 'STANDARD_24H',
    ...extra,
  });
}
async function prepare(e: Engine, extra: Record<string, unknown> = {}, actor = customer) {
  const q = await e.quote(actor, {
    listingId: 'listing-aoi',
    offeringId: 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt: e.now() + 180 * minute,
    area: 'shinjuku',
    requiredLanguage: '',
    ...extra,
  });
  const h = await e.hold(actor, q.id),
    p = await e.authorizeDemo(actor, h.id, true);
  const data = {
    quoteId: q.id,
    holdId: h.id,
    paymentId: p.id,
    termsAccepted: true,
    policyVersion: q.cancellationPolicy.version,
    address: {
      name: 'QA Guest',
      area: 'shinjuku',
      type: 'HOTEL',
      detail: 'QA address 123',
      hotelName: 'QA Hotel',
      room: '101',
      hotelPermission: true,
    },
  };
  return { q, h, p, data, key: randomUUID() };
}
async function create(e: Engine, extra: Record<string, unknown> = {}, actor = customer) {
  const p = await prepare(e, extra, actor);
  return e.createBooking(actor, p.data, p.key);
}
async function confirmed(e: Engine, extra: Record<string, unknown> = {}) {
  const b = await create(e, extra);
  return e.ack(worker, b.id, b.version, b.quote.bookingMode === 'INSTANT' ? 45 : undefined);
}

test('legacy shops retain demo terms until explicit save; rules and history are tenant scoped', () =>
  fixture(async (e) => {
    const old = await e.merchant.snapshot(owner);
    assert.equal(old.bookingRules.version, 0);
    assert.equal(old.bookingRules.nominationFee, 500);
    assert.equal(old.bookingRules.templateId, 'LEGACY');
    assert.equal(old.bookingRulesHistory.length, 0);
    const next = await update(e);
    assert.equal(next.version, 1);
    assert.equal(next.cancellationPolicy.version, 'store-nagi-policy-v1');
    const own = await e.merchant.snapshot(owner);
    assert.equal(own.bookingRulesHistory[0].changedBy, owner.id);
    const other = await e.merchant.snapshot({ ...owner, storeId: 'store-mori' });
    assert.equal(other.bookingRules.version, 0);
    assert.equal(other.bookingRulesHistory.length, 0);
    const publicStore = (await e.publicCatalog()).stores.find((s) => s.id === 'store-nagi')!;
    assert.equal(publicStore.bookingRules.nominationFee, 1200);
    assert(!JSON.stringify(publicStore).includes(owner.id));
  }));
test('new nominated and FREE quotes use the selected shop fee including zero', () =>
  fixture(async (e) => {
    await update(e);
    const p = await prepare(e);
    assert.equal(p.q.nominationFee, 1200);
    assert.equal(p.q.total, 9400);
    assert.equal(p.q.bookingRulesVersion, 1);
    const free = await e.quote(customer, {
      listingId: 'listing-ren',
      offeringId: 'store-nagi-60',
      bookingMode: 'SCHEDULED',
      nominationType: 'FREE',
      startAt: e.now() + 360 * minute,
      area: 'shinjuku',
      requiredLanguage: '',
    });
    assert.equal(free.nominationFee, 0);
    assert.equal(free.total, 8200);
  }));
test('zero nomination fee is preserved in quotes and other shops retain their own amounts', () =>
  fixture(async (e) => {
    await update(e, { nominationFee: 0 });
    const p = await prepare(e);
    assert.equal(p.q.nominationFee, 0);
    assert.equal(p.q.total, 8200);
    const q = await e.quote(customer, {
      listingId: 'listing-yuki',
      offeringId: 'store-mori-60',
      bookingMode: 'SCHEDULED',
      nominationType: 'NOMINATED',
      startAt: e.now() + 180 * minute,
      area: 'shinjuku',
      requiredLanguage: '',
    });
    assert.equal(q.nominationFee, 500);
    assert.equal(q.total, 8700);
  }));
for (const [before, rate] of [
  [1440, 0],
  [1439, 3000],
  [180, 3000],
  [179, 5000],
  [0, 5000],
  [-1, 5000],
])
  test(`standard cancellation ${before} minutes before start charges the frozen ${rate} basis points`, () =>
    fixture(async (e, clock) => {
      await update(e);
      const b = await confirmed(e, { startAt: e.now() + 26 * 60 * minute });
      clock.now = b.quote.startAt - before * minute;
      const expected = Math.floor((8400 * rate) / 10000),
        preview = await e.cancellationPreview(customer, b.id);
      assert.equal(preview.fee, expected);
      const done = await e.cancel(customer, b.id, b.version, false, expected);
      assert.equal(done.capturedAmount, expected);
      assert.equal(done.platformFee, 0);
      const p = await e.repo.transaction((tx) =>
        tx.get<{ amount: number; capturedAmount: number; voidedAmount: number }>(
          'payments',
          b.paymentId,
        ),
      );
      assert.equal(p!.capturedAmount + p!.voidedAmount, p!.amount);
    }));
test('fee and policy changes invalidate quote/hold/payment stages but keep submitted orders and cancellation snapshots', () =>
  fixture(async (e, clock) => {
    const b = await confirmed(e);
    const pending = await prepare(e, { listingId: 'listing-ren', startAt: e.now() + 360 * minute });
    await update(e);
    await assert.rejects(e.checkout(customer, pending.h.id), code('SHOP_RULES_CHANGED'));
    await assert.rejects(
      e.createBooking(customer, pending.data, pending.key),
      code('SHOP_RULES_CHANGED'),
    );
    const old = await e.booking(customer, b.id);
    assert.equal(old.quote.total, 8700);
    assert.equal(old.quote.cancellationPolicy.version, 'demo-policy-v3');
    clock.now = b.quote.startAt - 30 * minute;
    assert.equal((await e.cancellationPreview(customer, b.id)).fee, 2310);
    assert.equal((await e.cancel(customer, b.id, b.version, false, 2310)).capturedAmount, 2310);
  }));
test('changing only nomination fees versions the terms once, identical saves do not invalidate new quotes', () =>
  fixture(async (e) => {
    const first = await update(e);
    const second = await update(e);
    assert.equal(second.version, first.version);
    assert.equal((await e.merchant.snapshot(owner)).bookingRulesHistory.length, 1);
    const before = await prepare(e);
    await update(e, { nominationFee: 1500 });
    await assert.rejects(e.hold(customer, before.q.id), code('SHOP_RULES_CHANGED'));
  }));
test('custom two-tier policy enforces ordering and fixes instant and no-show evidence safeguards', () =>
  fixture(async (e) => {
    const custom = {
      freeBeforeMinutes: 720,
      lateFeeBps: 1500,
      nearBeforeMinutes: 60,
      nearFeeBps: 4000,
      noShowFeeBps: 6000,
    };
    const r = await update(e, { templateId: 'CUSTOM', customPolicy: custom });
    assert.deepEqual(r.cancellationPolicy.scheduledTiers, [
      { withinMinutes: 60, feeBps: 4000 },
      { withinMinutes: 720, feeBps: 1500 },
    ]);
    assert.equal(scheduledCancellationBps(r.cancellationPolicy, 60), 1500);
    assert.equal(scheduledCancellationBps(r.cancellationPolicy, 59), 4000);
    assert.equal(r.cancellationPolicy.instantTravelOnly, true);
    assert.equal(r.cancellationPolicy.instantDelayGraceMinutes, 15);
    assert.deepEqual(r.cancellationPolicy.noShow, {
      feeBps: 6000,
      waitMinutes: 15,
      minContacts: 2,
      contactGapMinutes: 2,
    });
  }));
test('single-rate custom and zero rates remain valid without inventing an extra tier', () => {
  const p = makeCancellationPolicy('CUSTOM', 'test', {
    freeBeforeMinutes: 120,
    lateFeeBps: 0,
    nearBeforeMinutes: 0,
    nearFeeBps: 0,
    noShowFeeBps: 0,
  });
  assert.equal(p.scheduledTiers?.length, 1);
  assert.equal(scheduledCancellationBps(p, -10), 0);
});
test('instant cancellation stays free before departure, travel-only afterwards, and free when arrival is late', () =>
  fixture(async (e, clock) => {
    await update(e);
    let b = await confirmed(e, { bookingMode: 'INSTANT', startAt: e.now() + 60 * minute });
    assert.equal((await e.cancellationPreview(customer, b.id)).fee, 0);
    b = await e.event(worker, b.id, b.version, 'EN_ROUTE');
    assert.equal((await e.cancellationPreview(customer, b.id)).fee, 1000);
    clock.now = b.arrival!.promisedAt + 15 * minute;
    assert.equal((await e.cancellationPreview(customer, b.id)).fee, 0);
    assert.equal((await e.cancel(customer, b.id, b.version)).capturedAmount, 0);
  }));
test('no-show review charges the original custom percentage only after two contacts and the full wait', () =>
  fixture(async (e, clock) => {
    await update(e, {
      templateId: 'CUSTOM',
      customPolicy: {
        freeBeforeMinutes: 720,
        lateFeeBps: 1500,
        nearBeforeMinutes: 60,
        nearFeeBps: 4000,
        noShowFeeBps: 6000,
      },
    });
    let b = await confirmed(e);
    await update(e, { nominationFee: 3000, templateId: 'FLEXIBLE_2H' });
    clock.now = b.quote.startAt;
    b = await e.event(worker, b.id, b.version, 'EN_ROUTE');
    b = await e.event(worker, b.id, b.version, 'ARRIVED');
    const action = (action: 'CONTACT' | 'REPORT' | 'CONFIRM', actor = worker) =>
      e.noShowAction(
        actor,
        b.id,
        {
          version: b.version,
          action,
          text: 'Recorded visit contact and policy review for this test.',
        },
        randomUUID(),
      );
    b = await action('CONTACT');
    clock.now += 2 * minute;
    b = await action('CONTACT');
    await assert.rejects(action('REPORT'), code('NO_SHOW_NOT_READY'));
    clock.now = b.quote.startAt + 15 * minute;
    b = await action('REPORT');
    b = await action('CONFIRM', owner);
    assert.equal(b.capturedAmount, 5040);
    assert.equal(b.platformFee, 0);
    assert.equal(b.quote.nominationFee, 1200);
  }));
test('a policy version from a different quote cannot be substituted at submission', () =>
  fixture(async (e) => {
    await update(e);
    const p = await prepare(e);
    await assert.rejects(
      e.createBooking(customer, { ...p.data, policyVersion: 'store-mori-policy-v1' }, p.key),
      code('POLICY_OR_AREA_CHANGED'),
    );
    assert.equal((await e.bookings(customer)).length, 0);
  }));
test('merchant/provider cancellation is free under the strictest selected policy', () =>
  fixture(async (e, clock) => {
    await update(e);
    const b = await confirmed(e);
    clock.now = b.quote.startAt - 30 * minute;
    assert.equal((await e.cancellationPreview(owner, b.id)).fee, 0);
    assert.equal((await e.cancel(owner, b.id, b.version)).capturedAmount, 0);
  }));

test('crossing a tier boundary requires reviewing the new cancellation fee before any capture', () =>
  fixture(async (e, clock) => {
    await update(e);
    const b = await confirmed(e);
    const preview = await e.cancellationPreview(customer, b.id);
    assert.equal(preview.fee, 2520);
    clock.now += 1;
    await assert.rejects(
      e.cancel(customer, b.id, b.version, false, preview.fee),
      code('CANCELLATION_PRICE_CHANGED'),
    );
    assert.equal((await e.booking(customer, b.id)).capturedAmount, 0);
    assert.equal((await e.cancellationPreview(customer, b.id)).fee, 4200);
  }));
test('new nomination fees participate in automatic acceptance amount gates for both nomination modes', () =>
  fixture(async (e) => {
    await e.repo.transaction(async (tx) => {
      const store = (await tx.get<Store>('stores', 'store-nagi'))!;
      await tx.put('stores', {
        ...store,
        acceptanceRule: { ...store.acceptanceRule!, maxTotal: 9000 },
      });
    });
    await update(e);
    const nominated = await create(e);
    assert.equal(nominated.acceptanceDecision?.reason, 'AMOUNT');
    assert.equal(nominated.status, 'REQUESTED');
    const free = await create(e, { nominationType: 'FREE', startAt: e.now() + 360 * minute });
    assert.equal(free.status, 'ACCEPTED');
    assert.equal(free.quote.nominationFee, 0);
  }));
test('replacement consent waives exactly the frozen nomination fee after the shop changes current pricing', () =>
  fixture(async (e) => {
    await update(e);
    let b = await confirmed(e);
    await update(e, { nominationFee: 3000 });
    b = await e.assign(owner, b.id, b.version, 'listing-ren', true);
    b = await e.consent(customer, b.id, b.version, true);
    assert.equal(b.quote.nominationFee, 0);
    assert.equal(b.quote.total, 8200);
  }));
test('fulfillment and refunds use the original fee and never reprice after a shop edit', () =>
  fixture(async (e) => {
    await update(e);
    const b = await confirmed(e);
    await update(e, { nominationFee: 3000, templateId: 'FLEXIBLE_2H' });
    const done = await finishVisit(e, b, worker, customer);
    assert.equal(done.capturedAmount, 9400);
    const refunded = await e.refund(owner, done.id, done.version, 1000);
    assert.equal(refunded.refundedAmount, 1000);
    assert.equal(refunded.quote.total, 9400);
  }));
test('concurrent price policy updates have one winner and cannot overwrite another shop or accept forged input', () =>
  fixture(async (e) => {
    const inputs = [1200, 1500].map((nominationFee) =>
      e.merchant.bookingRules(owner, { version: 0, nominationFee, templateId: 'STANDARD_24H' }),
    );
    const result = await Promise.allSettled(inputs);
    assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
    const rejected = result.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert(code('VERSION_CONFLICT')(rejected.reason));
    for (const actor of [customer, worker])
      await assert.rejects(
        e.merchant.bookingRules(actor, { version: 1, nominationFee: 0, templateId: 'FLEXIBLE_2H' }),
        code('FORBIDDEN'),
      );
    assert.equal(
      (await e.merchant.snapshot({ ...owner, storeId: 'store-mori' })).bookingRules.nominationFee,
      500,
    );
  }));
test('policy contract rejects negative/fractional prices, full-charge rates, inverted windows, decreasing tiers and unknown fields', () => {
  const custom = {
    freeBeforeMinutes: 1440,
    lateFeeBps: 3000,
    nearBeforeMinutes: 180,
    nearFeeBps: 5000,
    noShowFeeBps: 5000,
  };
  const base = { version: 0, nominationFee: 1200, templateId: 'CUSTOM', customPolicy: custom };
  for (const extra of [
    { nominationFee: -1 },
    { nominationFee: 1.5 },
    { nominationFee: 200001 },
    { storeId: 'other' },
    { templateId: 'CUSTOM', customPolicy: undefined },
    { templateId: 'STANDARD_24H', customPolicy: custom },
  ])
    assert(!storeBookingRulesInput.safeParse({ ...base, ...extra }).success);
  for (const extra of [
    { freeBeforeMinutes: 0 },
    { nearBeforeMinutes: 1440 },
    { nearFeeBps: 2000 },
    { noShowFeeBps: 4000 },
    { lateFeeBps: 10000 },
    { instantTravelOnly: false },
    { minContacts: 0 },
  ])
    assert(
      !storeBookingRulesInput.safeParse({ ...base, customPolicy: { ...custom, ...extra } }).success,
    );
});
