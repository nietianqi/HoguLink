import { registerClock, advanceClock, finishVisit } from './helpers/visit-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  type Actor,
  type Booking,
  type Listing,
  type Quote,
  type Store,
} from '@hogulink/contracts';
import { Engine } from '../src/engine.js';
import { Repository } from '../src/repository.js';
import { seed } from '../src/seed.js';
import { DomainError } from '../src/errors.js';
import { purchaseAnnual } from './helpers/subscription-fixture.js';
import { openAllDay } from './helpers/business-hours.js';

const customer: Actor = { id: 'full-customer', role: 'CUSTOMER', verificationLevel: 1 };
const other: Actor = { ...customer, id: 'full-other' };
const owner: Actor = {
  id: 'full-owner',
  role: 'MERCHANT',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const staff: Actor = {
  id: 'full-aoi',
  role: 'STAFF',
  staffId: 'staff-aoi',
  storeId: 'store-nagi',
  verificationLevel: 1,
};
const code = (value: string) => (e: unknown) => e instanceof DomainError && e.code === value;
const address = {
  name: 'Full QA Guest',
  area: 'shinjuku',
  type: 'HOTEL' as const,
  detail: 'Private full-regression address',
  hotelName: 'Sample Hotel',
  room: 'QA-202',
  hotelPermission: true,
};
async function fixture(fn: (e: Engine, clock: { now: number }) => Promise<void>) {
  const repo = new Repository(undefined, ':memory:');
  await repo.init();
  await seed(repo);
  const clock = { now: Date.UTC(2026, 9, 18, 0) },
    e = new Engine(repo, () => clock.now);
  await repo.transaction(async (tx) => {
    for (const l of await tx.list<Listing>('listings'))
      await tx.put('listings', { ...l, dutyUpdatedAt: clock.now });
  });
  registerClock(e, (at) => {
    clock.now = at;
  });
  try {
    await fn(e, clock);
  } finally {
    await repo.close();
  }
}
const input = (e: Engine, extra = {}) => ({
  listingId: 'listing-aoi',
  offeringId: 'store-nagi-60',
  bookingMode: 'SCHEDULED',
  nominationType: 'NOMINATED',
  startAt: e.now() + 180 * 60000,
  area: 'shinjuku',
  requiredLanguage: '',
  ...extra,
});
async function prepare(e: Engine, extra = {}) {
  const q = await e.quote(customer, input(e, extra)),
    h = await e.hold(customer, q.id),
    p = await e.authorizeDemo(customer, h.id, true);
  return {
    q,
    h,
    p,
    data: {
      quoteId: q.id,
      holdId: h.id,
      paymentId: p.id,
      address,
      termsAccepted: true,
      policyVersion: q.cancellationPolicy.version,
    },
  };
}
async function booking(e: Engine, extra = {}) {
  const p = await prepare(e, extra);
  return e.createBooking(customer, p.data, randomUUID());
}
async function confirmed(e: Engine) {
  const b = await booking(e);
  return e.ack(staff, b.id, b.version);
}
async function completed(e: Engine) {
  let b = await confirmed(e);
  return finishVisit(e, b, staff, customer);
}
async function revoke(e: Engine) {
  await e.repo.transaction(async (tx) => {
    const l = (await tx.get<Listing>('listings', 'listing-aoi'))!;
    await tx.put('listings', { ...l, membershipActive: false });
  });
}

for (const state of [
  'REQUESTED',
  'ACCEPTED',
  'CONFIRMED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_SERVICE',
  'AWAITING_COMPLETION',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
] as const)
  test(`FULL-STATE ${state} rejects every out-of-order visit event without financial side effects`, () =>
    fixture(async (e, clock) => {
      if (state === 'REQUESTED' || state === 'REJECTED')
        await e.repo.transaction(async (tx) => {
          const s = (await tx.get<Store>('stores', 'store-nagi'))!;
          await tx.put('stores', { ...s, acceptanceMode: 'MANUAL' });
        });
      let b = await booking(e);
      if (
        [
          'CONFIRMED',
          'EN_ROUTE',
          'ARRIVED',
          'IN_SERVICE',
          'AWAITING_COMPLETION',
          'COMPLETED',
        ].includes(state)
      )
        b = await e.ack(staff, b.id, b.version);
      const paths: { [key: string]: string[] } = {
        EN_ROUTE: ['EN_ROUTE'],
        ARRIVED: ['EN_ROUTE', 'ARRIVED'],
        IN_SERVICE: ['EN_ROUTE', 'ARRIVED', 'START'],
        AWAITING_COMPLETION: ['EN_ROUTE', 'ARRIVED', 'START', 'COMPLETE'],
        COMPLETED: ['EN_ROUTE', 'ARRIVED', 'START', 'COMPLETE'],
      };
      for (const event of paths[state] ?? []) {
        if (event === 'START') clock.now = b.quote.startAt;
        if (event === 'COMPLETE') clock.now = b.startedAt! + b.quote.endAt - b.quote.startAt;
        b = await e.event(staff, b.id, b.version, event);
      }
      if (state === 'COMPLETED')
        b = await e.completionAction(
          customer,
          b.id,
          { version: b.version, action: 'CONFIRM', expectedAmount: b.quote.total },
          randomUUID(),
        );
      if (state === 'CANCELLED') b = await e.cancel(customer, b.id, b.version);
      if (state === 'REJECTED') b = await e.cancel(owner, b.id, b.version, true);
      if (state === 'EXPIRED') {
        clock.now = b.deadline;
        await e.run(async () => {});
        b = await e.booking(customer, b.id);
      }
      assert.equal(b.status, state);
      const allowed: { [key: string]: string } = {
        CONFIRMED: 'EN_ROUTE',
        EN_ROUTE: 'ARRIVED',
        ARRIVED: 'START',
        IN_SERVICE: 'COMPLETE',
      };
      for (const event of ['EN_ROUTE', 'ARRIVED', 'START', 'COMPLETE'].filter(
        (event) => event !== allowed[state],
      ))
        await assert.rejects(e.event(staff, b.id, b.version, event), code('INVALID_TRANSITION'));
      const after = await e.booking(customer, b.id);
      assert.equal(after.version, b.version);
      assert.equal(after.capturedAmount, b.capturedAmount);
      assert.equal(after.refundedAmount, b.refundedAmount);
      assert.equal(after.status, state);
    }));
for (const mode of ['INSTANT', 'SCHEDULED'] as const)
  for (const nomination of ['NOMINATED', 'FREE'] as const)
    test(`FULL-SOLO ${mode}/${nomination} records contract acceptance and task acknowledgment atomically`, () =>
      fixture(async (e) => {
        let b = await booking(e, {
          listingId: 'listing-haru',
          offeringId: 'store-sora-60',
          bookingMode: mode,
          nominationType: nomination,
          startAt: e.now() + 90 * 60000,
        });
        b = await e.accept({ ...owner, storeId: 'store-sora' }, b.id, b.version);
        assert.equal(b.status, 'CONFIRMED');
        assert.equal(b.staffTaskStatus, 'ACKNOWLEDGED');
        assert.equal(b.merchantAcceptance, 'MANUALLY_ACCEPTED');
        assert.equal(b.assignedStaffId, 'staff-haru');
        assert.equal(b.selectedStaffId, nomination === 'FREE' ? null : 'staff-haru');
      }));
for (const nomination of ['NOMINATED', 'FREE'] as const)
  test(`FULL-MANUAL ${nomination} needs shop acceptance before task acknowledgment`, () =>
    fixture(async (e) => {
      let b = await booking(e, {
        listingId: 'listing-yuki',
        offeringId: 'store-mori-60',
        nominationType: nomination,
      });
      const worker = { ...staff, staffId: 'staff-yuki', storeId: 'store-mori' },
        shop = { ...owner, storeId: 'store-mori' };
      await assert.rejects(
        e.ack(worker, b.id, b.version),
        code(nomination === 'FREE' ? 'NOT_FOUND' : 'INVALID_STATE'),
      );
      b = await e.accept(shop, b.id, b.version);
      if (nomination === 'FREE') b = await e.assign(shop, b.id, b.version, 'listing-yuki');
      b = await e.ack(worker, b.id, b.version);
      assert.equal(b.status, 'CONFIRMED');
    }));
for (const [utcHour, restricted] of [
  [12, false],
  [13, true],
  [20, true],
  [21, false],
] as const)
  test(`FULL-RISK first home visit at Japan hour ${(utcHour + 9) % 24}`, () =>
    fixture(async (e) => {
      await openAllDay(e);
      const p = await prepare(e, { startAt: Date.UTC(2026, 9, 18, utcHour) }),
        data = { ...p.data, address: { ...address, type: 'HOME' as const } };
      if (restricted) {
        await assert.rejects(e.createBooking(customer, data, randomUUID()), code('L3_REQUIRED'));
        assert.ok(await e.createBooking({ ...customer, verificationLevel: 3 }, data, randomUUID()));
      } else assert.ok(await e.createBooking(customer, data, randomUUID()));
    }));
test('FULL-MONEY a fully refunded first visit does not earn a repeat-customer platform discount', () =>
  fixture(async (e) => {
    let first = await completed(e);
    first = await e.refund(owner, first.id, first.version, first.capturedAmount);
    const second = await completed(e);
    assert.equal(second.captureFeeRateBps, 1000);
  }));
test('FULL-CONFIG valid boundary configuration really loads and does not mask import failures', () => {
  const source = `const {config}=await import(${JSON.stringify(new URL('../src/config.ts', import.meta.url).href)});process.stdout.write(JSON.stringify(config))`;
  const result = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', source],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        ...process.env,
        CHECKOUT_HOLD_TTL_SECONDS: '30',
        STANDARD_FEE_BPS: '10000',
        ANNUAL_FEE_BPS: '0',
        NOMINATION_FEE_JPY: '0',
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const config = JSON.parse(result);
  assert.equal(config.holdTtlSeconds, 30);
  assert.equal(config.standardFeeBps, 10000);
  assert.equal(config.annualFeeBps, 0);
  assert.equal(config.nominationFee, 0);
});

test('FULL-ACL-06 staff without a bound shop cannot read or enumerate assigned jobs', () =>
  fixture(async (e) => {
    const b = await confirmed(e);
    const unbound = { ...staff, storeId: undefined };
    await assert.rejects(e.booking(unbound, b.id), code('NOT_FOUND'));
    assert.deepEqual(await e.bookings(unbound), []);
  }));

test('FULL-ACL-01 revoked staff cannot read an acknowledged booking or customer address', () =>
  fixture(async (e) => {
    const b = await confirmed(e);
    assert.ok((await e.booking(staff, b.id)).address);
    await revoke(e);
    await assert.rejects(e.booking(staff, b.id), code('NOT_FOUND'));
  }));
test('FULL-ACL-02 revoked staff cannot enumerate tasks or read and send booking messages', () =>
  fixture(async (e) => {
    const b = await confirmed(e);
    await e.messages(customer, b.id, 'Private appointment details');
    await revoke(e);
    assert.deepEqual(await e.bookings(staff), []);
    await assert.rejects(e.messages(staff, b.id), code('NOT_FOUND'));
    await assert.rejects(e.messages(staff, b.id, 'Unauthorized follow-up'), code('NOT_FOUND'));
  }));
test('FULL-ACL-03 revoked staff cannot progress, complete or create safety reports on former jobs', () =>
  fixture(async (e) => {
    const b = await confirmed(e);
    await revoke(e);
    await assert.rejects(e.event(staff, b.id, b.version, 'EN_ROUTE'), code('NOT_FOUND'));
    await assert.rejects(e.safety(staff, b.id, 'SOS', b.version), code('NOT_FOUND'));
    await assert.rejects(
      e.care.feedback(staff, b.id, 'Former staff report from an invalid work membership.'),
      code('NOT_FOUND'),
    );
  }));
test('FULL-ACL-05 suspending public discovery preserves a valid existing staff task', () =>
  fixture(async (e) => {
    let b = await confirmed(e);
    await e.enforce(
      { id: 'admin', role: 'ADMIN', verificationLevel: 3 },
      'listing-aoi',
      true,
      'Suspend new discovery during this demo review.',
    );
    assert.ok((await e.booking(staff, b.id)).address);
    b = await e.event(staff, b.id, b.version, 'EN_ROUTE');
    assert.equal(b.status, 'EN_ROUTE');
  }));
test('FULL-ACL-04 staff sessions cannot cross their bound shop even when global staff identity matches', () =>
  fixture(async (e) => {
    const b = await confirmed(e),
      wrong = { ...staff, storeId: 'store-mori' };
    await assert.rejects(e.booking(wrong, b.id), code('NOT_FOUND'));
    assert.deepEqual(await e.bookings(wrong), []);
  }));

for (const [label, offset, accepted] of [
  ['minimum exact', 15 * 60000, false],
  ['minimum plus one', 15 * 60000 + 1, true],
  ['maximum minus one', 30 * 86400000 - 1, true],
  ['maximum exact', 30 * 86400000, false],
] as const)
  test(`FULL-TIME quote boundary ${label}`, () =>
    fixture(async (e) => {
      await openAllDay(e);
      const run = e.quote(customer, input(e, { startAt: e.now() + offset }));
      if (accepted) assert.equal((await run).startAt, e.now() + offset);
      else await assert.rejects(run, code('INVALID_TIME'));
    }));
for (const [lead, expected] of [
  [1440, 30],
  [1440 + 1 / 60000, 240],
  [180, 30],
] as const)
  test(`FULL-TIME response window at lead ${lead} minutes`, () =>
    fixture(async (e) => {
      const b = await booking(e, { startAt: e.now() + lead * 60000 });
      assert.equal(b.deadline, e.now() + expected * 60000);
    }));
for (const [before, charged] of [
  [120 * 60000, false],
  [120 * 60000 - 1, true],
  [120 * 60000 + 1, false],
] as const)
  test(`FULL-MONEY cancellation at ${before} milliseconds before visit`, () =>
    fixture(async (e, clock) => {
      let b = await confirmed(e);
      clock.now = b.quote.startAt - before;
      b = await e.cancel(customer, b.id, b.version);
      assert.equal(
        b.capturedAmount,
        charged ? Math.floor((b.quote.total - b.quote.transportFee) * 0.3) : 0,
      );
      assert.equal(b.platformFee, 0);
    }));
for (const plan of ['TRIAL', 'STANDARD', 'ANNUAL'] as const)
  test(`FULL-MONEY capture uses actual ${plan} plan and excludes transport`, () =>
    fixture(async (e) => {
      if (plan === 'ANNUAL') await purchaseAnnual(e, owner);
      else
        await e.repo.transaction(async (tx) => {
          const store = (await tx.get<Store>('stores', 'store-nagi'))!;
          await tx.put('stores', { ...store, plan });
        });
      const b = await completed(e),
        rate = plan === 'TRIAL' ? 0 : plan === 'STANDARD' ? 1000 : 500;
      assert.equal(
        b.platformFee,
        Math.floor(((b.quote.serviceFee + b.quote.nominationFee) * rate) / 10000),
      );
      const ledger = (await e.dashboard(owner)).feeEntries;
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].amount, b.platformFee);
    }));
test('FULL-MONEY split refunds reconcile exactly despite integer rounding and concurrent retries', () =>
  fixture(async (e) => {
    let b = await completed(e);
    const captured = b.capturedAmount,
      fee = b.platformFee;
    for (const amount of [1, 17, 999, 1001]) b = await e.refund(owner, b.id, b.version, amount);
    const remaining = captured - b.refundedAmount;
    const outcomes = await Promise.allSettled([
      e.refund(owner, b.id, b.version, remaining),
      e.refund(owner, b.id, b.version, remaining),
    ]);
    assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
    const fresh = await e.booking(customer, b.id);
    assert.equal(fresh.refundedAmount, captured);
    assert.equal(fresh.paymentStatus, 'REFUNDED');
    const entries = (await e.dashboard(owner)).feeEntries;
    assert.equal(
      entries.reduce((n, f) => n + f.amount, 0),
      0,
    );
    assert.equal(
      entries.filter((f) => f.type === 'REFUND').reduce((n, f) => n + f.amount, 0),
      -fee,
    );
  }));
for (const [field, value] of [
  ['amount', 1],
  ['account', 'wrong-merchant-account'],
  ['verified3ds', false],
  ['status', 'VOIDED'],
  ['expiresAt', 1],
  ['bookingId', 'already-used'],
  ['customerId', 'other-customer'],
] as const)
  test(`FULL-PAYMENT tampered ${field} cannot create any order`, () =>
    fixture(async (e) => {
      const p = await prepare(e);
      await e.repo.transaction(async (tx) => {
        const raw = (await tx.get<{ id: string }>('payments', p.p.id))!;
        await tx.put('payments', { ...raw, [field]: value });
      });
      await assert.rejects(
        e.createBooking(customer, p.data, randomUUID()),
        code('PAYMENT_REQUIRED'),
      );
      assert.deepEqual(await e.bookings(customer), []);
      assert.equal(
        (await e.repo.transaction((tx) => tx.list<{ action: string }>('audit'))).filter(
          (a) => a.action === 'BOOKING_CREATED',
        ).length,
        0,
      );
    }));
for (const [field, value] of [
  ['merchantId', 'other'],
  ['storeId', 'other'],
  ['selectedStaffId', 'other'],
  ['selectedStaffListingId', 'other'],
] as const)
  test(`FULL-DB immutable ${field} survives an attempted direct update`, () =>
    fixture(async (e) => {
      const b = await booking(e);
      await assert.rejects(
        e.repo.transaction((tx) => tx.put('bookings', { ...b, [field]: value })),
        /Immutable booking identity/,
      );
      assert.equal((await e.booking(customer, b.id))[field], b[field]);
    }));
test('FULL-DB mode and nomination snapshots cannot be changed directly', () =>
  fixture(async (e) => {
    const b = await booking(e);
    for (const quote of [
      { ...b.quote, bookingMode: 'INSTANT' },
      { ...b.quote, nominationType: 'FREE' },
    ])
      await assert.rejects(
        e.repo.transaction((tx) => tx.put('bookings', { ...b, quote })),
        /Immutable booking identity/,
      );
  }));
test('FULL-DB failed multi-record transactions roll back business records and preserve later capacity checks', () =>
  fixture(async (e) => {
    const p = await prepare(e);
    await assert.rejects(
      e.repo.transaction(async (tx) => {
        await tx.put('qaRollback', { id: 'must-not-persist' });
        await tx.interval({
          id: 'conflicting-qa-block',
          staffId: p.h.staffId,
          startAt: p.q.startAt,
          endAt: p.q.endAt,
          expiresAt: p.q.endAt,
        });
      }),
      /SLOT_CONFLICT/,
    );
    assert.equal(
      await e.repo.transaction((tx) => tx.get('qaRollback', 'must-not-persist')),
      undefined,
    );
    await e.releaseCheckoutHold(customer, p.h.id);
    const q = await e.quote(other, input(e));
    assert.ok(await e.hold(other, q.id));
  }));
test('FULL-RETRY booking replay remains idempotent after cancellation and quote expiry', () =>
  fixture(async (e, clock) => {
    const p = await prepare(e),
      key = randomUUID();
    let b = await e.createBooking(customer, p.data, key);
    b = await e.cancel(customer, b.id, b.version);
    clock.now = p.q.expiresAt + 1;
    const replay = await e.createBooking(customer, p.data, key);
    assert.equal(replay.id, b.id);
    assert.equal(replay.status, 'CANCELLED');
    assert.equal((await e.bookings(customer)).length, 1);
  }));
test('FULL-EXPIRY checkout is unavailable exactly at the hold expiry time', () =>
  fixture(async (e, clock) => {
    const p = await prepare(e);
    clock.now = p.h.expiresAt;
    await assert.rejects(e.checkout(customer, p.h.id), code('HOLD_EXPIRED'));
    await e.run(async () => {});
    assert.equal(
      (await e.repo.transaction((tx) => tx.get<{ status: string }>('payments', p.p.id)))?.status,
      'VOIDED',
    );
  }));
test('FULL-PERSIST isolated file storage retains orders, payment state and staff time across restart', async () => {
  const folder = fileURLToPath(new URL('../../.qa/full-regression', import.meta.url));
  mkdirSync(folder, { recursive: true });
  const file = resolve(folder, `persistence-${randomUUID()}.sqlite`);
  let repo = new Repository(undefined, file);
  await repo.init();
  await seed(repo);
  const now = () => Date.UTC(2026, 9, 18, 0),
    e = new Engine(repo, now);
  const b = await booking(e);
  await repo.close();
  repo = new Repository(undefined, file);
  await repo.init();
  try {
    const restarted = new Engine(repo, now);
    assert.equal((await restarted.booking(customer, b.id)).quote.total, b.quote.total);
    const q = await restarted.quote(other, input(restarted, { nominationType: 'FREE' }));
    const h = await restarted.hold(other, q.id);
    assert.notEqual(h.staffId, 'staff-aoi');
  } finally {
    await repo.close();
  }
});
for (const [name, value] of [
  ['CHECKOUT_HOLD_TTL_SECONDS', '29'],
  ['CHECKOUT_HOLD_TTL_SECONDS', '3601'],
  ['NOMINATION_FEE_JPY', '-1'],
  ['STANDARD_FEE_BPS', '10001'],
  ['ANNUAL_FEE_BPS', 'NaN'],
  ['STANDARD_FEE_BPS', '1.5'],
] as const)
  test(`FULL-CONFIG invalid ${name}=${value} fails startup configuration`, () => {
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '--eval',
          `await import(${JSON.stringify(new URL('../src/config.ts', import.meta.url).href)})`,
        ],
        {
          cwd: fileURLToPath(new URL('..', import.meta.url)),
          env: { ...process.env, [name]: value },
          stdio: 'pipe',
        },
      ),
    );
  });
