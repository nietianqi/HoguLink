import { finishVisit } from './helpers/visit-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type {
  Actor,
  AdminMember,
  MerchantSubscription,
  PlanInvoice,
  Store,
  Listing,
} from '@hogulink/contracts';
import {
  fixture,
  booking,
  complete,
  customer,
  shop,
  staff,
  admin,
} from './helpers/experience-fixture.js';
import { billingNote as note, purchaseAnnual } from './helpers/subscription-fixture.js';
import { annualEnd } from '../src/subscription.js';
import type { Engine } from '../src/engine.js';
import { DomainError } from '../src/errors.js';
const day = 86400000;
const code = (v: string) => (e: unknown) => e instanceof DomainError && e.code === v;
const ws = (e: Engine, a = shop) =>
  e.subscriptions.workspace(a, a.role === 'ADMIN' ? { storeId: 'store-nagi' } : {});
async function change(e: Engine, action: string, extra: Record<string, unknown> = {}) {
  const w = await ws(e);
  return e.subscriptions.change(
    shop,
    w.storeId,
    { version: w.subscription.version, action, note, ...extra },
    randomUUID(),
  );
}
async function pay(
  e: Engine,
  action = 'PAY_SUCCEEDED',
  a = shop,
  extra: Record<string, unknown> = {},
) {
  const w = await ws(e),
    i = w.invoices.find((i) => i.status === 'OPEN')!;
  return e.subscriptions.invoiceAction(
    a,
    i.id,
    {
      version: i.version,
      subscriptionVersion: w.subscription.version,
      action,
      note,
      ...(action === 'PAY_SUCCEEDED' ? { reference: `plan_${randomUUID()}` } : {}),
      ...extra,
    },
    randomUUID(),
  );
}
async function trial(e: Engine) {
  await e.repo.transaction(async (tx) => {
    const st = (await tx.get<Store>('stores', 'store-nagi'))!;
    await tx.put('stores', { ...st, plan: 'TRIAL' });
  });
  return ws(e);
}
async function due(e: Engine, clock: { now: number }, policy = 'SUSPEND') {
  let w = await purchaseAnnual(e, shop);
  await change(e, 'SET_OVERDUE_ACTION', { overdueAction: policy });
  clock.now = w.subscription.annualEndsAt!;
  w = await ws(e);
  assert.equal(w.subscription.status, 'GRACE_PERIOD');
  return w;
}
test('billing permissions scope shop, customer, therapist and finance readers', () =>
  fixture(async (e) => {
    for (const a of [customer, staff]) await assert.rejects(() => ws(e, a), code('FORBIDDEN'));
    await assert.rejects(
      () => e.subscriptions.workspace(shop, { storeId: 'store-mori' }),
      code('NOT_FOUND'),
    );
    await assert.rejects(
      () =>
        e.subscriptions.change(
          admin,
          'store-nagi',
          { version: 1, action: 'SELECT_STANDARD', note },
          randomUUID(),
        ),
      code('FORBIDDEN'),
    );
    const w = await ws(e);
    assert.equal(w.stores.length, 1);
    for (const v of ['pspAccount', 'emergencyContact', 'customerId', 'Private QA address'])
      assert(!JSON.stringify(w).includes(v));
  }));
test('trial waits for first publication, starts once, and does not reset after suspension', () =>
  fixture(async (e, clock) => {
    await e.repo.transaction(async (tx) => {
      const st = (await tx.get<Store>('stores', 'store-nagi'))!;
      await tx.put('stores', { ...st, plan: 'TRIAL', approved: false });
    });
    assert.equal((await ws(e)).subscription.status, 'WAITING_PUBLICATION');
    clock.now += 30 * day;
    await e.repo.transaction(async (tx) => {
      const st = (await tx.get<Store>('stores', 'store-nagi'))!;
      await tx.put('stores', { ...st, approved: true });
    });
    const w = await ws(e);
    assert.equal(w.subscription.trialStartedAt, clock.now);
    assert.equal(w.subscription.trialEndsAt, clock.now + 90 * day);
    await e.repo.transaction(async (tx) => {
      const st = (await tx.get<Store>('stores', 'store-nagi'))!;
      await tx.put('stores', { ...st, active: false });
    });
    clock.now += 3 * day;
    await ws(e);
    await e.repo.transaction(async (tx) => {
      const st = (await tx.get<Store>('stores', 'store-nagi'))!;
      await tx.put('stores', { ...st, active: true });
    });
    assert.equal((await ws(e)).subscription.trialEndsAt, w.subscription.trialEndsAt);
  }));
test('trial boundary changes capture rate without creating an annual charge', () =>
  fixture(async (e, clock) => {
    const w = await trial(e);
    clock.now = w.subscription.trialEndsAt! - 1;
    assert.equal((await ws(e)).standing.plan, 'TRIAL');
    clock.now++;
    const next = await ws(e);
    assert.equal(next.subscription.status, 'STANDARD');
    assert.equal(next.invoices.length, 0);
    assert.equal(next.standing.plan, 'STANDARD');
    const b = await complete(e, clock);
    assert.equal(b.captureFeeRateBps, 1000);
  }));
test('leaving trial is one-way and does not add a new free period', () =>
  fixture(async (e) => {
    await trial(e);
    await change(e, 'SELECT_STANDARD');
    assert.equal((await ws(e)).subscription.status, 'STANDARD');
    await assert.rejects(async () =>
      e.subscriptions.change(
        shop,
        'store-nagi',
        { version: (await ws(e)).subscription.version, action: 'TRIAL', note },
        randomUUID(),
      ),
    );
  }));
test('annual request and failed payment never activate discounted fees', () =>
  fixture(async (e) => {
    await change(e, 'REQUEST_ANNUAL');
    let w = await ws(e);
    assert.equal(w.invoices.length, 1);
    assert.equal(w.invoices[0].kind, 'ANNUAL_PLAN_FEE');
    assert.equal(w.standing.plan, 'STANDARD');
    await pay(e, 'PAY_FAILED');
    w = await ws(e);
    assert.equal(w.standing.plan, 'STANDARD');
    assert.equal(w.invoices[0].status, 'OPEN');
    assert.equal(w.invoices[0].attempts.length, 1);
    await pay(e);
    w = await ws(e);
    assert.equal(w.standing.plan, 'ANNUAL');
    assert.equal(w.invoices[0].status, 'PAID');
    assert.equal(w.invoices[0].attempts.length, 2);
  }));
test('paid annual charge is a separate domain and does not change service statements or settlement amounts', () =>
  fixture(async (e, clock) => {
    await complete(e, clock);
    const before = await e.finance.workspace(shop);
    await purchaseAnnual(e, shop);
    const after = await e.finance.workspace(shop);
    assert.deepEqual(after.rows, before.rows);
    assert.deepEqual(after.totals, before.totals);
    assert.equal(after.billing.plan, 'ANNUAL');
    const ledger = await e.repo.transaction((tx) => tx.list('feeEntries'));
    assert.equal(ledger.length, 1);
  }));
test('early renewal preserves remaining days and cannot be requested before the window', () =>
  fixture(async (e, clock) => {
    const w = await purchaseAnnual(e, shop),
      end = w.subscription.annualEndsAt!;
    await assert.rejects(() => change(e, 'REQUEST_ANNUAL'), code('RENEWAL_TOO_EARLY'));
    clock.now = end - 30 * day;
    let next = await ws(e);
    assert.equal(next.invoices.filter((i) => i.status === 'OPEN').length, 1);
    await pay(e);
    next = await ws(e);
    assert.equal(next.subscription.annualStartedAt, end);
    assert.equal(next.subscription.annualEndsAt, annualEnd(end));
    assert.equal(next.standing.plan, 'ANNUAL');
  }));
test('calendar anniversary clamps leap day in Japan', () => {
  assert.equal(
    annualEnd(Date.parse('2028-02-29T00:30:00+09:00')),
    Date.parse('2029-02-28T00:30:00+09:00'),
  );
  assert.equal(
    annualEnd(Date.parse('2026-12-31T23:50:00+09:00')),
    Date.parse('2027-12-31T23:50:00+09:00'),
  );
});
test('selecting Standard keeps paid annual benefits until expiry and cancels future renewal', () =>
  fixture(async (e, clock) => {
    const w = await purchaseAnnual(e, shop);
    clock.now = w.subscription.annualEndsAt! - 20 * day;
    await ws(e);
    await change(e, 'SELECT_STANDARD');
    let next = await ws(e);
    assert.equal(next.standing.plan, 'ANNUAL');
    assert.equal(next.subscription.renewal, 'STANDARD');
    assert(next.invoices.some((i) => i.status === 'VOID'));
    clock.now = w.subscription.annualEndsAt!;
    next = await ws(e);
    assert.equal(next.standing.plan, 'STANDARD');
    assert.equal(next.standing.newBookingsBlocked, false);
    assert.equal(next.invoices.filter((i) => i.status === 'OPEN').length, 0);
  }));
test('renewal grace uses Standard capture rates; expiry suspends only new business', () =>
  fixture(async (e, clock) => {
    let w = await due(e, clock);
    assert.equal(w.standing.plan, 'STANDARD');
    assert.equal(w.standing.newBookingsBlocked, false);
    const end = w.invoices.find((i) => i.status === 'OPEN')!.graceEndsAt;
    clock.now = end - 1;
    assert.equal((await ws(e)).subscription.status, 'GRACE_PERIOD');
    clock.now++;
    w = await ws(e);
    assert.equal(w.subscription.status, 'SUSPENDED');
    assert(w.standing.newBookingsBlocked);
    assert(!(await e.publicCatalog()).stores.some((s) => s.id === 'store-nagi'));
    await assert.rejects(() => booking(e), code('LISTING_UNAVAILABLE'));
    assert((await e.merchant.snapshot(shop)).store.active);
  }));
test('overdue downgrade leaves invoice visible and can resume at Standard without forgiving it', () =>
  fixture(async (e, clock) => {
    const w = await due(e, clock);
    clock.now = w.invoices.find((i) => i.status === 'OPEN')!.graceEndsAt;
    await ws(e);
    await change(e, 'SET_OVERDUE_ACTION', { overdueAction: 'DOWNGRADE' });
    const next = await ws(e);
    assert.equal(next.subscription.status, 'STANDARD');
    assert.equal(next.standing.newBookingsBlocked, false);
    assert.equal(next.standing.openAnnualAmount, 100000);
    assert.equal(
      next.invoices.find((i) => i.status === 'OPEN')!.id,
      w.invoices.find((i) => i.status === 'OPEN')!.id,
    );
    await booking(e);
  }));
test('overdue renewal succeeds from payment time and restores billing access', () =>
  fixture(async (e, clock) => {
    const w = await due(e, clock);
    clock.now = w.subscription.annualEndsAt! + 10 * day;
    assert.equal((await ws(e)).subscription.status, 'SUSPENDED');
    const at = clock.now;
    await pay(e);
    const next = await ws(e);
    assert.equal(next.subscription.annualStartedAt, at);
    assert.equal(next.subscription.annualEndsAt, annualEnd(at));
    assert.equal(next.standing.newBookingsBlocked, false);
  }));
test('choosing Standard directly resumes a suspended annual merchant without deleting the overdue invoice', () =>
  fixture(async (e, clock) => {
    const w = await due(e, clock);
    clock.now = w.subscription.annualEndsAt! + 8 * day;
    assert((await ws(e)).standing.newBookingsBlocked);
    await change(e, 'SELECT_STANDARD');
    const next = await ws(e);
    assert.equal(next.subscription.status, 'STANDARD');
    assert(!next.standing.newBookingsBlocked);
    assert.equal(next.standing.openAnnualAmount, 100000);
    assert.equal(next.subscription.renewal, 'STANDARD');
  }));
test('renewal failure cannot clear overdue restrictions or extend coverage', () =>
  fixture(async (e, clock) => {
    const w = await due(e, clock);
    clock.now = w.subscription.annualEndsAt! + 8 * day;
    await pay(e, 'PAY_FAILED');
    const next = await ws(e);
    assert.equal(next.subscription.status, 'SUSPENDED');
    assert.equal(next.subscription.annualEndsAt, w.subscription.annualEndsAt);
  }));
test('platform void is explicit, cannot void paid receipts, and does not refund service funds', () =>
  fixture(async (e, clock) => {
    const w = await due(e, clock);
    clock.now = w.subscription.annualEndsAt! + 8 * day;
    await pay(e, 'VOID', admin);
    const next = await ws(e);
    assert.equal(next.subscription.status, 'STANDARD');
    assert.equal(next.standing.openAnnualAmount, 0);
    const paid = next.invoices.find((i) => i.status === 'PAID')!;
    await assert.rejects(
      () =>
        e.subscriptions.invoiceAction(
          admin,
          paid.id,
          {
            version: paid.version,
            subscriptionVersion: next.subscription.version,
            action: 'VOID',
            note,
          },
          randomUUID(),
        ),
      code('IMMUTABLE_PLAN_INVOICE'),
    );
  }));
test('merchant cannot use administrative void or reminders and another shop cannot pay invoice', () =>
  fixture(async (e) => {
    await change(e, 'REQUEST_ANNUAL');
    const w = await ws(e),
      i = w.invoices[0],
      input = {
        version: i.version,
        subscriptionVersion: w.subscription.version,
        action: 'VOID',
        note,
      };
    await assert.rejects(
      () => e.subscriptions.invoiceAction(shop, i.id, input, randomUUID()),
      code('FORBIDDEN'),
    );
    await assert.rejects(
      () =>
        e.subscriptions.invoiceAction(
          { ...shop, storeId: 'store-mori' },
          i.id,
          { ...input, action: 'PAY_FAILED' },
          randomUUID(),
        ),
      code('NOT_FOUND'),
    );
  }));
test('invoice and subscription optimistic versions protect concurrent decisions', () =>
  fixture(async (e) => {
    await change(e, 'REQUEST_ANNUAL');
    const w = await ws(e),
      i = w.invoices[0],
      input = {
        version: i.version,
        subscriptionVersion: w.subscription.version,
        action: 'PAY_SUCCEEDED',
        reference: `plan_${randomUUID()}`,
        note,
      };
    const results = await Promise.allSettled([
      e.subscriptions.invoiceAction(shop, i.id, input, randomUUID()),
      e.subscriptions.invoiceAction(admin, i.id, input, randomUUID()),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await ws(e)).invoices[0].attempts.length, 1);
  }));
test('idempotent payment returns original response after later renewal and rejects changed payload', () =>
  fixture(async (e, clock) => {
    await change(e, 'REQUEST_ANNUAL');
    const w = await ws(e),
      i = w.invoices[0],
      input = {
        version: i.version,
        subscriptionVersion: w.subscription.version,
        action: 'PAY_SUCCEEDED',
        reference: `plan_${randomUUID()}`,
        note,
      },
      key = randomUUID();
    const result = await e.subscriptions.invoiceAction(shop, i.id, input, key);
    const paid = await ws(e);
    clock.now = paid.subscription.annualEndsAt! - day;
    await pay(e);
    assert.deepEqual(await e.subscriptions.invoiceAction(shop, i.id, input, key), result);
    await assert.rejects(
      () => e.subscriptions.invoiceAction(shop, i.id, { ...input, note: note + ' changed' }, key),
      code('IDEMPOTENCY_CONFLICT'),
    );
  }));
test('duplicate annual receipt and repeated enrollment invoices are rejected', () =>
  fixture(async (e, clock) => {
    await change(e, 'REQUEST_ANNUAL');
    await assert.rejects(() => change(e, 'REQUEST_ANNUAL'), code('OPEN_PLAN_INVOICE'));
    await pay(e, 'PAY_SUCCEEDED', shop, { reference: 'plan_fixed_receipt' });
    const w = await ws(e);
    clock.now = w.subscription.annualEndsAt! - day;
    await assert.rejects(
      () => pay(e, 'PAY_SUCCEEDED', shop, { reference: 'plan_fixed_receipt' }),
      code('REFERENCE_USED'),
    );
  }));
test('stale plan choice, malformed notes and missing keys cannot change access', () =>
  fixture(async (e) => {
    const w = await ws(e);
    await change(e, 'SET_OVERDUE_ACTION', { overdueAction: 'SUSPEND' });
    await assert.rejects(
      () =>
        e.subscriptions.change(
          shop,
          w.storeId,
          { version: w.subscription.version, action: 'SELECT_STANDARD', note },
          randomUUID(),
        ),
      code('VERSION_CONFLICT'),
    );
    await assert.rejects(() => change(e, 'SELECT_STANDARD', { note: 'short' }));
    const next = await ws(e);
    await assert.rejects(
      () =>
        e.subscriptions.change(
          shop,
          w.storeId,
          { version: next.subscription.version, action: 'SELECT_STANDARD', note },
          '',
        ),
      code('IDEMPOTENCY_REQUIRED'),
    );
  }));
test('expired enrollment offers void without blocking the existing Standard plan', () =>
  fixture(async (e, clock) => {
    await change(e, 'REQUEST_ANNUAL');
    const w = await ws(e);
    clock.now = w.invoices[0].dueAt;
    const next = await ws(e);
    assert.equal(next.invoices[0].status, 'VOID');
    assert.equal(next.standing.plan, 'STANDARD');
    assert(!next.standing.newBookingsBlocked);
    await change(e, 'REQUEST_ANNUAL');
  }));
test('automatic reminders are queued once and manual reminders are rate limited locally', () =>
  fixture(async (e, clock) => {
    const w = await trial(e);
    clock.now = w.subscription.trialEndsAt! - day;
    await ws(e);
    await ws(e);
    const reminders = await e.repo.transaction((tx) =>
      tx.list<{ action: string; storeId: string }>('subscriptionEvents'),
    );
    assert.equal(
      reminders.filter((e) => e.action === 'TRIAL_ENDING' && e.storeId === 'store-nagi').length,
      1,
    );
    await change(e, 'REQUEST_ANNUAL');
    await pay(e, 'REMIND', admin);
    await assert.rejects(() => pay(e, 'REMIND', admin), code('REMINDER_RECENT'));
  }));
test('legacy Annual import never invents paid invoice or historical receipt', () =>
  fixture(async (e) => {
    const w = await e.subscriptions.workspace({ ...shop, storeId: 'store-mori' });
    assert.equal(w.standing.plan, 'ANNUAL');
    assert(w.subscription.legacy);
    assert.equal(w.invoices.length, 0);
    assert(w.subscription.annualEndsAt);
  }));
test('qualification suspension remains after annual payment; billing does not rewrite approval', () =>
  fixture(async (e) => {
    await change(e, 'REQUEST_ANNUAL');
    await e.repo.transaction(async (tx) => {
      const st = (await tx.get<Store>('stores', 'store-nagi'))!;
      await tx.put('stores', { ...st, approved: false });
    });
    await pay(e);
    assert.equal((await ws(e)).standing.plan, 'ANNUAL');
    assert(!(await e.publicCatalog()).stores.some((s) => s.id === 'store-nagi'));
  }));
test('platform fee discrepancy blocks new exposure and remains after annual payment until corrected', () =>
  fixture(async (e, clock) => {
    await complete(e, clock);
    let f = await e.finance.workspace(admin, { storeId: 'store-nagi' });
    const row = f.rows[0],
      body = {
        version: 0,
        reference: 'provider_fee_difference',
        captured: row.captured,
        refunded: row.refunded,
        platformFee: row.platformFee - 1,
        processorFee: 0,
        net: row.captured - row.platformFee + 1,
        note,
      };
    const r = await e.finance.report(admin, 'store-nagi', row.id, body, randomUUID());
    assert((await ws(e)).standing.feeDiscrepancy);
    await purchaseAnnual(e, shop);
    assert((await ws(e)).standing.newBookingsBlocked);
    await e.finance.report(
      admin,
      'store-nagi',
      row.id,
      {
        ...body,
        version: r.version,
        platformFee: row.platformFee,
        net: row.captured - row.platformFee,
      },
      randomUUID(),
    );
    assert(!(await ws(e)).standing.newBookingsBlocked);
  }));
test('arrears preserve completed-order refunds, complaints and statement exports', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock);
    const fee = b.platformFee,
      w = await due(e, clock);
    clock.now = w.subscription.annualEndsAt! + 8 * day;
    assert((await ws(e)).standing.newBookingsBlocked);
    const r = await e.refund(shop, b.id, b.version, 1000);
    assert.equal(r.refundedAmount, 1000);
    assert.equal(r.platformFee, fee);
    const finance = await e.finance.workspace(shop);
    assert(finance.rows.some((e) => e.kind === 'REFUND'));
    assert.equal((await e.booking(customer, b.id)).id, b.id);
    const statement = await e.finance.statement(
      shop,
      'store-nagi',
      { month: finance.month, token: finance.token },
      randomUUID(),
    );
    assert.equal(statement.refunded, 1000);
    const ticket = await e.care.create(
      customer,
      {
        category: 'SERVICE_QUALITY',
        bookingId: b.id,
        subject: 'Review completed visit',
        description: note,
      },
      randomUUID(),
    );
    assert(ticket.id);
  }));
test('billing readers remain read-only and revoked finance employee sessions are rejected', () =>
  fixture(async (e) => {
    const members: AdminMember[] = ['FINANCE', 'AUDITOR'].map((r, i) => ({
      id: `plan_member_${i}`,
      name: r,
      email: `p${i}@example.test`,
      adminRole: r as 'FINANCE' | 'AUDITOR',
      teams: [],
      status: 'ACTIVE',
      version: 1,
      sessionVersion: 1,
      createdAt: e.now(),
      updatedAt: e.now(),
    }));
    await e.repo.transaction(async (tx) => {
      for (const m of members) await tx.put('adminMembers', m);
    });
    const actors = members.map(
      (m) =>
        ({
          id: m.id,
          role: 'ADMIN',
          verificationLevel: 3,
          adminRole: m.adminRole,
          adminSessionVersion: 1,
        }) as Actor,
    );
    await change(e, 'REQUEST_ANNUAL');
    await ws(e, actors[1]);
    await assert.rejects(() => pay(e, 'REMIND', actors[1]), code('FORBIDDEN'));
    await pay(e, 'REMIND', actors[0]);
    await e.repo.transaction((tx) => tx.put('adminMembers', { ...members[0], status: 'DISABLED' }));
    await assert.rejects(() => ws(e, actors[0]), code('UNAUTHENTICATED'));
  }));
test('existing confirmed visits remain fulfillable after annual arrears and capture at current Standard rate', () =>
  fixture(async (e, clock) => {
    const w = await purchaseAnnual(e, shop);
    await change(e, 'SET_OVERDUE_ACTION', { overdueAction: 'SUSPEND' });
    clock.now = w.subscription.annualEndsAt! - day;
    let b = await booking(e, { startAt: clock.now + 10 * day });
    b = await e.ack(staff, b.id, b.version);
    clock.now = w.subscription.annualEndsAt! + 8 * day;
    assert((await ws(e)).standing.newBookingsBlocked);
    assert.equal((await e.coordination.detail(customer, b.id)).bookingId, b.id);
    clock.now = b.quote.startAt;
    for (const event of ['EN_ROUTE', 'ARRIVED', 'START'] as const)
      b = await e.event(staff, b.id, b.version, event);
    b = await finishVisit(e, b, staff, customer);
    assert.equal(b.status, 'COMPLETED');
    assert.equal(b.captureFeeRateBps, 1000);
    assert((await ws(e)).standing.newBookingsBlocked);
  }));
test('a suspended merchant can still propose, obtain consent for and fulfill an existing visit reassignment', () =>
  fixture(async (e, clock) => {
    const w = await purchaseAnnual(e, shop);
    await change(e, 'SET_OVERDUE_ACTION', { overdueAction: 'SUSPEND' });
    clock.now = w.subscription.annualEndsAt! - day;
    let b = await booking(e, { startAt: clock.now + 10 * day });
    b = await e.ack(staff, b.id, b.version);
    clock.now = w.subscription.annualEndsAt! + 8 * day;
    assert((await ws(e)).standing.newBookingsBlocked);
    b = await e.assign(shop, b.id, b.version, 'listing-mio', true);
    b = await e.consent(customer, b.id, b.version, true);
    const mio: Actor = { ...staff, id: 'mio-existing', staffId: 'staff-mio' };
    b = await e.ack(mio, b.id, b.version);
    clock.now = b.quote.startAt;
    b = await finishVisit(e, b, mio, customer);
    assert.equal(b.status, 'COMPLETED');
    assert.equal(b.assignedStaffId, 'staff-mio');
    assert.equal(b.quote.nominationFee, 0);
  }));
test('recommendation is based on real completed orders, excludes transport and removes fully refunded visits', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock),
      w = await ws(e);
    assert.equal(w.recommendation.orders, 1);
    assert.equal(w.recommendation.feeBase, b.capturedAmount - b.quote.transportFee);
    await e.refund(shop, b.id, b.version, b.capturedAmount);
    const next = await ws(e);
    assert.equal(next.recommendation.orders, 0);
    assert.equal(next.recommendation.feeBase, 0);
    assert.equal(next.recommendation.suggested, null);
  }));
test('arrears do not block independent PSP service-proceeds verification', () =>
  fixture(async (e, clock) => {
    await complete(e, clock);
    const w = await due(e, clock);
    clock.now = w.subscription.annualEndsAt! + 8 * day;
    let f = await e.finance.workspace(admin, { storeId: 'store-nagi' });
    assert(f.billing.newBookingsBlocked);
    for (const row of f.openRows)
      await e.finance.report(
        admin,
        f.storeId,
        row.id,
        {
          version: 0,
          reference: 'demo_' + row.id,
          captured: row.captured,
          refunded: row.refunded,
          platformFee: row.platformFee,
          processorFee: 0,
          net: row.captured - row.refunded - row.platformFee,
          note,
        },
        randomUUID(),
      );
    f = await e.finance.workspace(admin, { storeId: 'store-nagi' });
    let batch = await e.finance.prepare(admin, f.storeId, { token: f.token, note }, randomUUID());
    batch = await e.finance.batchAction(
      shop,
      batch.id,
      { version: batch.version, action: 'CONFIRM', note },
      randomUUID(),
    );
    batch = await e.finance.batchAction(
      admin,
      batch.id,
      {
        version: batch.version,
        action: 'RECORD',
        reference: 'demo_annual_independent_payout',
        note,
      },
      randomUUID(),
    );
    assert.equal(batch.state, 'RECORDED');
    assert.equal((await ws(e)).standing.openAnnualAmount, 100000);
  }));
