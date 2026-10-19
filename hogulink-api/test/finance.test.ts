import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type {
  Actor,
  Booking,
  FinanceRow,
  SettlementBatch,
  MoneyEntry,
  AdminMember,
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
import type { Engine } from '../src/engine.js';
import { DomainError } from '../src/errors.js';
const code = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;
const reason = 'Reviewed original transactions, provider observations and the aftercare status.';
const ws = (e: Engine, actor = admin) => e.finance.workspace(actor, { storeId: 'store-nagi' });
async function match(e: Engine, row: FinanceRow, extra: Record<string, unknown> = {}) {
  return e.finance.report(
    admin,
    'store-nagi',
    row.id,
    {
      version: row.report?.version ?? 0,
      reference: `demo_${row.id.replaceAll('-', '_')}`,
      captured: row.captured,
      refunded: row.refunded,
      platformFee: row.platformFee,
      processorFee: 0,
      net: row.captured - row.refunded - row.platformFee,
      note: reason,
      ...extra,
    },
    randomUUID(),
  );
}
async function matched(e: Engine) {
  for (const row of (await ws(e)).openRows) await match(e, row);
  return ws(e);
}
async function prepare(e: Engine) {
  const data = await matched(e);
  return e.finance.prepare(admin, 'store-nagi', { token: data.token, note: reason }, randomUUID());
}
const action = (
  e: Engine,
  b: SettlementBatch,
  act: string,
  actor = admin,
  extra: Record<string, unknown> = {},
) =>
  e.finance.batchAction(
    actor,
    b.id,
    { version: b.version, action: act, note: reason, ...extra },
    randomUUID(),
  );
async function recorded(e: Engine) {
  let b = await prepare(e);
  b = await action(e, b, 'CONFIRM', shop);
  return action(e, b, 'RECORD', admin, { reference: `demo_payout_${b.id}` });
}
test('finance rejects customers, therapists and unrelated shops', () =>
  fixture(async (e, clock) => {
    await complete(e, clock);
    for (const actor of [customer, staff])
      await assert.rejects(() => ws(e, actor), code('FORBIDDEN'));
    await assert.rejects(() => ws(e, { ...shop, storeId: 'store-mori' }), code('NOT_FOUND'));
    assert.equal((await e.finance.workspace({ ...shop, storeId: 'store-mori' })).rows.length, 0);
  }));
test('captured order generates one immutable money row with the actual frozen fee', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock),
      data = await ws(e);
    assert.equal(data.rows.length, 1);
    assert.equal(data.rows[0].kind, 'CAPTURE');
    assert.equal(data.totals.captured, b.capturedAmount);
    assert.equal(data.totals.platformFee, b.platformFee);
    await assert.rejects(
      () => e.event(staff, b.id, b.version, 'COMPLETE'),
      code('INVALID_TRANSITION'),
    );
    assert.equal((await ws(e)).rows.length, 1);
    for (const value of ['Private QA address', 'customerId', 'paymentId', 'pspAccount', 'QA Guest'])
      assert(!JSON.stringify(data).includes(value));
  }));
test('authorization and provider cancellations without capture create no income', () =>
  fixture(async (e) => {
    let b = await booking(e);
    assert.equal((await ws(e)).rows.length, 0);
    b = await e.cancel(shop, b.id, b.version);
    assert.equal(b.capturedAmount, 0);
    assert.equal((await ws(e)).rows.length, 0);
  }));
test('late customer cancellation is a separate zero-platform-fee capture', () =>
  fixture(async (e, clock) => {
    let b = await booking(e);
    b = await e.ack(staff, b.id, b.version);
    clock.now = b.quote.startAt - 30 * 60000;
    const preview = await e.cancellationPreview(customer, b.id);
    b = await e.cancel(customer, b.id, b.version, false, preview.fee);
    const row = (await ws(e)).rows[0];
    assert.equal(row.kind, 'CANCELLATION');
    assert.equal(row.captured, b.capturedAmount);
    assert.equal(row.platformFee, 0);
  }));
test('multiple partial refunds preserve individual amounts and exact cumulative fee reversals', () =>
  fixture(async (e, clock) => {
    let b = await complete(e, clock);
    const original = b.platformFee;
    for (const n of [1, 111, 2000]) b = await e.refund(shop, b.id, b.version, n);
    const data = await ws(e),
      refunds = data.rows.filter((e) => e.kind === 'REFUND');
    assert.equal(refunds.length, 3);
    assert.equal(
      refunds.reduce((n, e) => n + e.refunded, 0),
      2112,
    );
    assert.equal(
      data.totals.platformFee,
      original - Math.floor((original * 2112) / b.capturedAmount),
    );
    assert(refunds.every((e) => e.reversalOf));
    b = await e.refund(shop, b.id, b.version, b.capturedAmount - b.refundedAmount);
    assert.equal((await ws(e)).totals.platformFee, 0);
    assert.equal((await ws(e)).totals.net, 0);
  }));
test('unchanged statement generation reuses its snapshot and later refunds create a new revision', () =>
  fixture(async (e, clock) => {
    let b = await complete(e, clock),
      data = await ws(e),
      body = { month: data.month, token: data.token },
      key = randomUUID();
    const first = await e.finance.statement(shop, 'store-nagi', body, key);
    assert.deepEqual(await e.finance.statement(shop, 'store-nagi', body, key), first);
    assert.equal((await e.finance.statement(shop, 'store-nagi', body, randomUUID())).id, first.id);
    b = await e.refund(shop, b.id, b.version, 1000);
    data = await ws(e);
    const second = await e.finance.statement(
      admin,
      'store-nagi',
      { month: data.month, token: data.token },
      randomUUID(),
    );
    assert.equal(second.revision, 2);
    assert.equal(first.refunded, 0);
    assert.equal(second.refunded, 1000);
    assert.equal(second.lines.length, 2);
  }));
test('stale statement tokens reject silently updated confirmation amounts', () =>
  fixture(async (e, clock) => {
    let b = await complete(e, clock);
    const data = await ws(e);
    b = await e.refund(shop, b.id, b.version, 100);
    await assert.rejects(
      () =>
        e.finance.statement(
          shop,
          'store-nagi',
          { month: data.month, token: data.token },
          randomUUID(),
        ),
      code('VERSION_CONFLICT'),
    );
  }));
test('provider differences are retained and require an explicit corrected observation', () =>
  fixture(async (e, clock) => {
    await complete(e, clock);
    let row = (await ws(e)).rows[0];
    let r = await match(e, row, { refunded: 100 });
    assert.equal(r.status, 'DIFFERENCE');
    assert.equal((await ws(e)).canPrepare, false);
    row = (await ws(e)).rows[0];
    r = await match(e, row);
    assert.equal(r.status, 'MATCHED');
    assert.equal((await ws(e)).rows[0].history.length, 2);
  }));
test('provider processor fees are independent and net arithmetic must match', () =>
  fixture(async (e, clock) => {
    await complete(e, clock);
    let row = (await ws(e)).rows[0];
    assert.equal((await match(e, row, { processorFee: 300 })).status, 'DIFFERENCE');
    row = (await ws(e)).rows[0];
    await match(e, row, { processorFee: 300, net: row.captured - row.platformFee - 300 });
    const batch = await e.finance.prepare(
      admin,
      'store-nagi',
      { token: (await ws(e)).token, note: reason },
      randomUUID(),
    );
    assert.equal(batch.processorFee, 300);
    assert.equal(batch.net, row.captured - row.platformFee - 300);
  }));
test('same provider reference cannot reconcile another transaction', () =>
  fixture(async (e, clock) => {
    let b = await complete(e, clock);
    b = await e.refund(shop, b.id, b.version, 100);
    const data = await ws(e);
    await match(e, data.rows[0], { reference: 'demo_shared_reference' });
    await assert.rejects(
      () => match(e, data.rows[1], { reference: 'demo_shared_reference' }),
      code('REFERENCE_USED'),
    );
  }));

test('provider fee credits on refunds are separate from platform fee reversals', () =>
  fixture(async (e, clock) => {
    let b = await complete(e, clock);
    b = await e.refund(shop, b.id, b.version, 1000);
    const d = await ws(e),
      capture = d.rows.find((r) => r.kind === 'CAPTURE')!,
      refund = d.rows.find((r) => r.kind === 'REFUND')!;
    await match(e, capture, {
      processorFee: 100,
      net: capture.captured - capture.platformFee - 100,
    });
    await match(e, refund, { processorFee: -30, net: -refund.refunded - refund.platformFee + 30 });
    const fresh = await ws(e);
    assert(fresh.canPrepare);
    const batch = await e.finance.prepare(
      admin,
      'store-nagi',
      { token: fresh.token, note: reason },
      randomUUID(),
    );
    assert.equal(batch.processorFee, 70);
    assert.equal(batch.net, fresh.totals.net - 70);
  }));
test('provider observations use immutable retry responses and reject key reuse with other values', () =>
  fixture(async (e, clock) => {
    await complete(e, clock);
    const row = (await ws(e)).rows[0],
      body = {
        version: 0,
        reference: 'demo_original_report',
        captured: row.captured,
        refunded: 0,
        platformFee: row.platformFee,
        processorFee: 0,
        net: row.captured - row.platformFee,
        note: reason,
      },
      key = randomUUID();
    const first = await e.finance.report(admin, 'store-nagi', row.id, body, key);
    await match(e, (await ws(e)).rows[0]);
    assert.deepEqual(await e.finance.report(admin, 'store-nagi', row.id, body, key), first);
    await assert.rejects(
      () => e.finance.report(admin, 'store-nagi', row.id, { ...body, refunded: 1 }, key),
      code('IDEMPOTENCY_CONFLICT'),
    );
  }));
test('unmatched rows and active aftercare prevent settlement verification', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock);
    let data = await ws(e);
    await assert.rejects(
      () =>
        e.finance.prepare(admin, 'store-nagi', { token: data.token, note: reason }, randomUUID()),
      code('RECONCILIATION_REQUIRED'),
    );
    await matched(e);
    await e.refunds.request(
      customer,
      b.id,
      { bookingVersion: b.version, amount: 1000, reason, locale: 'en' },
      randomUUID(),
    );
    data = await ws(e);
    assert.equal(data.canPrepare, false);
    assert(data.openRows.every((r) => r.holdReason === 'AFTERCARE'));
    await assert.rejects(
      () =>
        e.finance.prepare(admin, 'store-nagi', { token: data.token, note: reason }, randomUUID()),
      code('RECONCILIATION_REQUIRED'),
    );
  }));
test('settlement follows platform preparation, original shop confirmation and result recording', () =>
  fixture(async (e, clock) => {
    await complete(e, clock);
    let b = await prepare(e);
    assert.equal(b.state, 'DRAFT');
    await assert.rejects(
      () => action(e, b, 'RECORD', admin, { reference: 'demo_early' }),
      code('INVALID_STATE'),
    );
    await assert.rejects(() => action(e, b, 'CONFIRM', admin), code('FORBIDDEN'));
    await assert.rejects(
      () => action(e, b, 'CONFIRM', { ...shop, storeId: 'store-mori' }),
      code('NOT_FOUND'),
    );
    b = await action(e, b, 'CONFIRM', shop);
    b = await action(e, b, 'RECORD', admin, { reference: 'demo_paid_reference' });
    assert.equal(b.state, 'RECORDED');
    assert.equal((await ws(e)).openRows.length, 0);
    await assert.rejects(() => action(e, b, 'VOID'), code('IMMUTABLE_SETTLEMENT'));
  }));
test('shop disputes require a platform response and renewed shop confirmation', () =>
  fixture(async (e, clock) => {
    await complete(e, clock);
    let b = await prepare(e);
    b = await action(e, b, 'DISPUTE', shop);
    assert.equal(b.state, 'DISPUTED');
    await assert.rejects(
      () => action(e, b, 'RECORD', admin, { reference: 'demo_wrong' }),
      code('INVALID_STATE'),
    );
    b = await action(e, b, 'RESPOND');
    assert.equal(b.state, 'DRAFT');
    b = await action(e, b, 'CONFIRM', shop);
    assert.equal(b.state, 'SHOP_CONFIRMED');
    assert.equal(b.notes.length, 4);
  }));
test('provider failure keeps entries open and retry requires shop confirmation again', () =>
  fixture(async (e, clock) => {
    await complete(e, clock);
    let b = await prepare(e);
    b = await action(e, b, 'CONFIRM', shop);
    b = await action(e, b, 'FAIL');
    assert.equal(b.state, 'FAILED');
    assert.equal((await ws(e)).openRows.length, 1);
    b = await action(e, b, 'RETRY');
    assert.equal(b.state, 'DRAFT');
    await assert.rejects(
      () => action(e, b, 'RECORD', admin, { reference: 'demo_failed' }),
      code('INVALID_STATE'),
    );
  }));
test('a new refund invalidates a prepared batch and requires new immutable verification', () =>
  fixture(async (e, clock) => {
    let order = await complete(e, clock),
      batch = await prepare(e);
    order = await e.refund(shop, order.id, order.version, 1000);
    await assert.rejects(() => action(e, batch, 'CONFIRM', shop), code('BATCH_STALE'));
    batch = await action(e, batch, 'VOID');
    const next = await prepare(e);
    assert.equal(next.entryIds.length, 2);
    assert(next.net < batch.net);
  }));
test('provider correction after shop confirmation invalidates settlement recording', () =>
  fixture(async (e, clock) => {
    await complete(e, clock);
    let batch = await prepare(e);
    batch = await action(e, batch, 'CONFIRM', shop);
    await match(e, (await ws(e)).rows[0]);
    await assert.rejects(
      () => action(e, batch, 'RECORD', admin, { reference: 'demo_stale' }),
      code('BATCH_STALE'),
    );
  }));
test('aftercare opening after shop confirmation prevents recording old verification', () =>
  fixture(async (e, clock) => {
    const order = await complete(e, clock);
    let batch = await prepare(e);
    batch = await action(e, batch, 'CONFIRM', shop);
    await e.care.create(
      customer,
      {
        bookingId: order.id,
        category: 'SERVICE_QUALITY',
        subject: 'Service review still open',
        description: reason,
      },
      randomUUID(),
    );
    await assert.rejects(
      () => action(e, batch, 'RECORD', admin, { reference: 'demo_stale_care' }),
      code('BATCH_STALE'),
    );
  }));
test('refund after a recorded settlement becomes carry-forward without changing the old record', () =>
  fixture(async (e, clock) => {
    let order = await complete(e, clock);
    const prior = await recorded(e);
    order = await e.refund(shop, order.id, order.version, 1000);
    const data = await matched(e);
    assert(data.totals.unsettled < 0);
    assert.equal(data.batches[0].net, prior.net);
    assert.equal(data.openRows.length, 1);
    await assert.rejects(
      () =>
        e.finance.prepare(admin, 'store-nagi', { token: data.token, note: reason }, randomUUID()),
      code('NEGATIVE_CARRY'),
    );
    await complete(e, clock);
    const next = await prepare(e);
    assert(next.net >= 0);
    assert.equal(next.entryIds.length, 2);
  }));
test('a recorded report is immutable, while repeat settlement cannot consume entries twice', () =>
  fixture(async (e, clock) => {
    await complete(e, clock);
    await recorded(e);
    await assert.rejects(async () => match(e, (await ws(e)).rows[0]), code('IMMUTABLE_SETTLEMENT'));
    const data = await ws(e);
    await assert.rejects(
      () =>
        e.finance.prepare(admin, 'store-nagi', { token: data.token, note: reason }, randomUUID()),
      code('RECONCILIATION_REQUIRED'),
    );
  }));
test('only one active settlement can reserve the same shop open entries', () =>
  fixture(async (e, clock) => {
    await complete(e, clock);
    await prepare(e);
    const data = await ws(e);
    await assert.rejects(
      () =>
        e.finance.prepare(admin, 'store-nagi', { token: data.token, note: reason }, randomUUID()),
      code('ACTIVE_BATCH'),
    );
  }));
test('settlement actions are idempotent with frozen original responses', () =>
  fixture(async (e, clock) => {
    await complete(e, clock);
    let b = await prepare(e);
    const d = { version: b.version, action: 'CONFIRM', note: reason },
      key = randomUUID(),
      first = await e.finance.batchAction(shop, b.id, d, key);
    b = await action(e, first, 'RECORD', admin, { reference: 'demo_idempotent_payout' });
    assert.deepEqual(await e.finance.batchAction(shop, b.id, d, key), first);
    await assert.rejects(
      () => e.finance.batchAction(shop, b.id, { ...d, note: reason + ' Changed' }, key),
      code('IDEMPOTENCY_CONFLICT'),
    );
  }));
test('legacy opening snapshots preserve known totals without fabricating historical dates', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock);
    await e.repo.transaction(async (tx) => {
      for (const entry of await tx.list<MoneyEntry>('moneyEntries'))
        await tx.put('moneyEntries', {
          ...entry,
          storeId: 'archived-fixture',
          bookingId: 'archived-fixture',
        });
    });
    clock.now += 86400000;
    const d = await ws(e);
    assert.equal(d.rows.length, 1);
    assert.equal(d.rows[0].kind, 'OPENING');
    assert.equal(d.rows[0].source, 'LEGACY');
    assert.equal(d.rows[0].at, clock.now);
    assert.equal(d.totals.captured, b.capturedAmount);
    assert.equal((await ws(e)).rows.length, 1);
  }));
test('legacy refund first records its original opening and then the new refund', () =>
  fixture(async (e, clock) => {
    let b = await complete(e, clock);
    await e.repo.transaction(async (tx) => {
      for (const entry of await tx.list<MoneyEntry>('moneyEntries'))
        await tx.put('moneyEntries', {
          ...entry,
          storeId: 'archived-fixture',
          bookingId: 'archived-fixture',
        });
    });
    b = await e.refund(shop, b.id, b.version, 1000);
    const rows = (await ws(e)).rows;
    assert.equal(rows.length, 2);
    assert.equal(
      rows.reduce((n, e) => n + e.refunded, 0),
      1000,
    );
    assert.equal(
      rows.reduce((n, e) => n + e.captured, 0),
      b.capturedAmount,
    );
  }));
test('ledger drift blocks verification rather than concealing the difference', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock);
    await e.repo.transaction((tx) => tx.put('bookings', { ...b, refundedAmount: 100 }));
    const d = await matched(e);
    assert(d.openRows.every((e) => e.holdReason === 'LEDGER'));
    assert.equal(d.canPrepare, false);
  }));
test('finance role writes, auditor only reads, revoked finance sessions stop immediately', () =>
  fixture(async (e, clock) => {
    await complete(e, clock);
    const member = (id: string, role: AdminMember['adminRole']): AdminMember => ({
      id,
      name: id,
      email: id + '@example.test',
      adminRole: role,
      teams: [],
      status: 'ACTIVE',
      version: 1,
      sessionVersion: 1,
      createdAt: clock.now,
      updatedAt: clock.now,
    });
    await e.repo.transaction(async (tx) => {
      await tx.put('adminMembers', member('member_fin', 'FINANCE'));
      await tx.put('adminMembers', member('member_aud', 'AUDITOR'));
    });
    const fin: Actor = {
        id: 'member_fin',
        role: 'ADMIN',
        verificationLevel: 3,
        adminRole: 'FINANCE',
        adminSessionVersion: 1,
      },
      aud: Actor = { ...fin, id: 'member_aud', adminRole: 'AUDITOR' };
    const row = (await ws(e, fin)).rows[0];
    await assert.rejects(
      () =>
        e.finance.report(
          aud,
          'store-nagi',
          row.id,
          {
            version: 0,
            reference: 'demo_auditor',
            captured: row.captured,
            refunded: 0,
            platformFee: row.platformFee,
            processorFee: 0,
            net: row.captured - row.platformFee,
            note: reason,
          },
          randomUUID(),
        ),
      code('FORBIDDEN'),
    );
    assert.equal(
      (
        await e.finance.report(
          fin,
          'store-nagi',
          row.id,
          {
            version: 0,
            reference: 'demo_finance_role',
            captured: row.captured,
            refunded: 0,
            platformFee: row.platformFee,
            processorFee: 0,
            net: row.captured - row.platformFee,
            note: reason,
          },
          randomUUID(),
        )
      ).status,
      'MATCHED',
    );
    await e.repo.transaction((tx) =>
      tx.put('adminMembers', {
        ...member('member_fin', 'FINANCE'),
        status: 'DISABLED',
        sessionVersion: 2,
      }),
    );
    await assert.rejects(() => ws(e, fin), code('UNAUTHENTICATED'));
  }));
test('month attribution uses JST and preserves cross-month refund adjustments', () =>
  fixture(async (e, clock) => {
    clock.now = Date.UTC(2026, 9, 31, 10);
    let b = await complete(e, clock);
    const month = (await ws(e)).month;
    clock.now = Date.UTC(2026, 10, 1, 1);
    b = await e.refund(shop, b.id, b.version, 1000);
    const old = await e.finance.workspace(shop, { month }),
      fresh = await ws(e);
    assert.equal(old.totals.refunded, 0);
    assert.equal(fresh.totals.refunded, 1000);
    assert.equal(fresh.openRows.length, 2);
  }));
