import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type {
  Actor,
  AdminMember,
  MoneyEntry,
  ReportQuery,
  ReportWorkspace,
  InvoiceRequest,
  InvoiceSource,
  InvoiceDocument,
  Store,
  SettlementBatch,
  PlanInvoice,
} from '@hogulink/contracts';
import {
  fixture,
  complete,
  booking,
  shop,
  admin,
  customer,
  staff,
} from './helpers/experience-fixture.js';
import { purchaseAnnual } from './helpers/subscription-fixture.js';
import type { Engine } from '../src/engine.js';
import { DomainError } from '../src/errors.js';
import { ReportingService } from '../src/reporting.js';
const note = 'Reviewed the original transactions, fee reversals and report definitions.';
const code = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;
const q: ReportQuery = { from: '2026-10-01', to: '2026-10-18', groupBy: 'day' };
const report = (e: Engine, a = shop, query: ReportQuery = q) => e.reporting.workspace(a, query);
async function match(e: Engine, fee = 0) {
  for (const row of (await e.finance.workspace(shop)).rows)
    await e.finance.report(
      admin,
      'store-nagi',
      row.id,
      {
        version: row.report?.version ?? 0,
        reference: 'demo_' + row.id,
        captured: row.captured,
        refunded: row.refunded,
        platformFee: row.platformFee,
        processorFee: fee,
        net: row.captured - row.refunded - row.platformFee - fee,
        note,
      },
      randomUUID(),
    );
}
async function issued(e: Engine, source?: InvoiceSource) {
  let f = await e.finance.workspace(shop);
  await e.finance.statement(shop, f.storeId, { month: f.month, token: f.token }, randomUUID());
  const w = await e.invoicing.workspace(shop),
    s = source ?? w.sources.find((s) => s.kind === 'PLATFORM_FEE')!;
  let r = (await e.invoicing.create(
    shop,
    'store-nagi',
    {
      sourceKey: s.key,
      sourceToken: s.token,
      ...(s.kind === 'CREDIT_NOTE' ? {} : { profileVersion: w.profile.version }),
      note,
    },
    randomUUID(),
  )) as InvoiceRequest;
  const checks = { source: true, recipient: true, history: true, demo: true };
  for (const [action, actor] of [
    ['REVIEW', admin],
    ['APPROVE', { ...admin, id: 'separate-owner' }],
    ['ISSUE', admin],
  ] as const)
    r = (await e.invoicing.action(
      actor,
      r.id,
      { version: r.version, action, checks, note },
      randomUUID(),
    )) as InvoiceRequest;
  return (await e.invoicing.workspace(shop)).documents.find((d) => d.id === r.documentId)!;
}
async function exportReport(
  e: Engine,
  w: ReportWorkspace,
  type:
    'summary' | 'trend' | 'money' | 'orders' | 'settlements' | 'annual' | 'invoices' = 'summary',
  a = shop,
  key = randomUUID(),
) {
  return e.reporting.export(a, { query: w.query, token: w.token, type }, key);
}
test('reports isolate shops and deny customer, therapist and non-finance roles', () =>
  fixture(async (e) => {
    for (const a of [customer, staff]) await assert.rejects(() => report(e, a), code('FORBIDDEN'));
    await assert.rejects(() => report(e, shop, { ...q, storeId: 'store-mori' }), code('NOT_FOUND'));
    assert.deepEqual((await report(e)).selectedStoreIds, ['store-nagi']);
    assert.equal((await report(e, admin)).selectedStoreIds.length, 3);
    await assert.rejects(() => report(e, admin, { ...q, storeId: 'missing' }), code('NOT_FOUND'));
  }));
test('date input validates real Japan calendar dates, ordering, range and future dates', () =>
  fixture(async (e) => {
    for (const x of [
      { from: '2026-02-30' },
      { from: '2026-13-01' },
      { to: '2026-10-32' },
      { from: '2026-10-19' },
      { from: '2025-01-01' },
      { groupBy: 'hour' },
      { customerId: 'anything' },
    ])
      await assert.rejects(() => e.reporting.workspace(shop, { ...q, ...x }));
    await assert.rejects(
      () => report(e, shop, { ...q, to: '2026-10-19' }),
      code('REPORT_FUTURE_DATE'),
    );
  }));
test('single day and partial month reports terminate, fill zeros and use equal previous period', () =>
  fixture(async (e) => {
    const r = await report(e, shop, { ...q, from: '2026-10-18', groupBy: 'month' });
    assert.equal(r.trend.length, 1);
    assert.equal(r.trend[0].period, '2026-10');
    assert.deepEqual(r.previousPeriod, { from: '2026-10-17', to: '2026-10-17' });
    assert.equal(r.current.completionBps, null);
    assert.equal(r.current.averageCapture, null);
    assert.equal(r.current.captured, 0);
  }));
test('monthly buckets cross year and leap boundaries without dropping partial periods', () =>
  fixture(async (e, c) => {
    c.now = Date.UTC(2026, 9, 18);
    const r = await report(e, shop, { from: '2025-12-15', to: '2026-02-03', groupBy: 'month' });
    assert.deepEqual(
      r.trend.map((p) => p.period),
      ['2025-12', '2026-01', '2026-02'],
    );
    const leap = await report(e, shop, { from: '2024-02-28', to: '2024-03-01', groupBy: 'day' });
    assert.equal(leap.trend.length, 3);
  }));
test('authorized and cancelled unpaid orders do not fabricate posted sales', () =>
  fixture(async (e) => {
    let b = await booking(e);
    b = await e.cancel(shop, b.id, b.version);
    const r = await report(e);
    assert.equal(r.current.captured, 0);
    assert.equal(r.current.orders, 1);
    assert.equal(r.current.cancelled, 1);
    assert.equal(r.current.completionBps, 0);
  }));
test('posted receipts use actual frozen amounts and incomplete PSP fees remain unknown', () =>
  fixture(async (e, c) => {
    const b = await complete(e, c),
      r = await report(e);
    assert.equal(r.current.captured, b.capturedAmount);
    assert.equal(r.current.platformFee, b.platformFee);
    assert.equal(r.current.merchantNet, b.capturedAmount - b.platformFee);
    assert.equal(r.current.unknownProcessorRows, 1);
    assert.equal(r.current.merchantNetAfterFees, null);
    assert.equal(r.current.averageCapture, b.capturedAmount);
    assert.equal(r.current.completionBps, 10000);
  }));
test('matched processor fees are separate from platform fees and proceeds', () =>
  fixture(async (e, c) => {
    const b = await complete(e, c);
    await match(e, 123);
    const r = await report(e);
    assert.equal(r.current.knownProcessorFee, 123);
    assert.equal(r.current.merchantNetAfterFees, b.capturedAmount - b.platformFee - 123);
    assert.equal(r.quality.matched, 1);
    assert.equal(r.money[0].processorFee, 123);
  }));
test('refunds are counted on refund posting dates, including negative cross-month net', () =>
  fixture(async (e, c) => {
    const b = await complete(e, c);
    c.now = Date.UTC(2026, 10, 1);
    await e.refund(shop, b.id, b.version, 1000);
    const old = await report(e),
      r = await report(e, shop, { from: '2026-11-01', to: '2026-11-01', groupBy: 'day' });
    assert.equal(old.current.refunded, 0);
    assert.equal(r.current.captured, 0);
    assert.equal(r.current.refunded, 1000);
    assert.equal(r.current.salesNet, -1000);
    assert(r.current.platformFee < 0);
    assert.equal(r.current.orders, 0);
    assert.equal(r.trend[0].salesNet, -1000);
  }));
test('period is inclusive in Japan and excludes next-day midnight', () =>
  fixture(async (e, c) => {
    c.now = Date.UTC(2026, 9, 17, 15);
    await e.repo.transaction(async (tx) => {
      for (const [id, at] of [
        ['before', c.now - 1],
        ['start', c.now],
        ['end', c.now + 86400000 - 1],
        ['after', c.now + 86400000],
      ] as const)
        await tx.put<MoneyEntry>('moneyEntries', {
          id,
          bookingId: 'orphan-' + id,
          storeId: 'store-nagi',
          at,
          kind: 'CAPTURE',
          captured: 10,
          refunded: 0,
          platformFee: 1,
          source: 'DEMO',
        });
    });
    const r = await report(e, shop, { from: '2026-10-18', to: '2026-10-18', groupBy: 'day' });
    assert.deepEqual(r.money.map((r) => r.id).sort(), ['end', 'start']);
    assert.equal(r.current.captured, 20);
  }));
test('new-order cohorts differ from event flows and exclude pending orders from completion denominator', () =>
  fixture(async (e, c) => {
    await complete(e, c);
    await booking(e, { startAt: c.now + 86400000 });
    const r = await report(e);
    assert.equal(r.current.orders, 2);
    assert.equal(r.current.closed, 1);
    assert.equal(r.current.pending, 1);
    assert.equal(r.current.completionBps, 10000);
    assert.equal(r.services[0].orders, 2);
    assert.equal(r.modes[0].completed, 1);
  }));
test('annual fees count only once on paid date, independently from service receipts', () =>
  fixture(async (e, c) => {
    const b = await complete(e, c);
    const plan = await purchaseAnnual(e, shop),
      r = await report(e);
    assert.equal(r.current.annualPaid, plan.invoices[0].amount);
    assert.equal(r.current.captured, b.capturedAmount);
    assert.equal(r.current.merchantNet, b.capturedAmount - b.platformFee);
    assert.equal(r.annual[0].status, 'PAID');
  }));
test('open annual balance is current snapshot even when its creation is outside report period', () =>
  fixture(async (e, c) => {
    let p = await e.subscriptions.workspace(shop);
    await e.subscriptions.change(
      shop,
      'store-nagi',
      { version: p.subscription.version, action: 'REQUEST_ANNUAL', note },
      randomUUID(),
    );
    p = await e.subscriptions.workspace(shop);
    c.now += 8 * 86400000;
    const paid = await purchaseAnnual(e, shop);
    c.now = paid.subscription.annualEndsAt! + 86400000;
    const r = await report(e, shop, { from: '2026-10-01', to: '2026-10-02', groupBy: 'day' });
    assert.equal(r.current.annualPaid, 0);
    assert.equal(r.annual.length, 0);
    assert.equal(r.balances.openAnnual, p.invoices[0].amount);
    assert.equal(r.balances.overdueAnnual, p.invoices[0].amount);
  }));
test('settlement recorded amount is independent of receipt date and never added to sales', () =>
  fixture(async (e, c) => {
    const b = await complete(e, c);
    await match(e, 100);
    let f = await e.finance.workspace(shop),
      batch = await e.finance.prepare(admin, 'store-nagi', { token: f.token, note }, randomUUID());
    batch = await e.finance.batchAction(
      shop,
      batch.id,
      { version: batch.version, action: 'CONFIRM', note },
      randomUUID(),
    );
    c.now = Date.UTC(2026, 10, 1);
    await e.finance.batchAction(
      admin,
      batch.id,
      { version: batch.version, action: 'RECORD', reference: 'demo_qa_report_settlement', note },
      randomUUID(),
    );
    const r = await report(e, shop, { from: '2026-11-01', to: '2026-11-01', groupBy: 'day' });
    assert.equal(r.current.captured, 0);
    assert.equal(r.current.settlementRecorded, b.capturedAmount - b.platformFee - 100);
    assert.equal(r.settlements[0].state, 'RECORDED');
  }));
test('invoicing does not add income and corrections never count fee amount a second time', () =>
  fixture(async (e, c) => {
    await complete(e, c);
    await match(e);
    const doc = await issued(e),
      w = await e.invoicing.workspace(shop);
    await issued(
      e,
      w.sources.find((s) => s.kind === 'CORRECTION'),
    );
    const r = await report(e);
    assert.equal(r.current.invoiceIssued, doc.amount);
    assert.equal(r.current.invoiceCount, 2);
    assert.equal(r.current.correctionCount, 1);
    assert.equal(r.money[0].invoiceNumbers.length, 1);
    assert(r.money[0].invoiceNumbers[0] !== doc.number);
  }));
test('credit notes reduce invoice totals and retain original document linkage', () =>
  fixture(async (e, c) => {
    let b = await complete(e, c);
    await match(e);
    const doc = await issued(e);
    b = await e.refund(shop, b.id, b.version, 1000);
    await match(e);
    await issued(
      e,
      (await e.invoicing.workspace(shop)).sources.find((s) => s.kind === 'CREDIT_NOTE'),
    );
    const r = await report(e);
    assert.equal(r.current.invoiceCredits, 88);
    assert.equal(r.current.invoiceNet, doc.amount - 88);
    assert.equal(r.invoices.find((d) => d.kind === 'CREDIT_NOTE')!.originalNumber, doc.number);
    assert.equal(r.current.refunded, 1000);
  }));
test('legacy balances are disclosed separately and excluded from posted trends', () =>
  fixture(async (e, c) => {
    const b = await complete(e, c);
    await e.repo.transaction(async (tx) => {
      await tx.put<MoneyEntry>('moneyEntries', {
        id: 'legacy-qa',
        storeId: 'store-nagi',
        bookingId: 'legacy-qa',
        at: c.now,
        kind: 'OPENING',
        captured: 99999,
        refunded: 0,
        platformFee: 0,
        source: 'LEGACY',
      });
    });
    const r = await report(e);
    assert.equal(r.current.captured, b.capturedAmount);
    assert.equal(r.balances.legacyRows, 1);
    assert.equal(r.balances.legacyNet, 99999);
  }));
test('reports redact customers, payment routing, profiles and private case descriptions', () =>
  fixture(async (e, c) => {
    const b = await complete(e, c);
    await e.care.create(
      customer,
      {
        bookingId: b.id,
        category: 'PRIVACY',
        subject: 'PRIVATE_QA_SUBJECT',
        description: 'PRIVATE_QA_CASE_BODY secret personal information.',
      },
      randomUUID(),
    );
    const text = JSON.stringify(await report(e));
    for (const privateValue of [
      'PRIVATE_QA',
      'Private QA address',
      'QA Guest',
      'customerId',
      'paymentId',
      'pspAccount',
      'recipient',
      'taxId',
      'room',
    ])
      assert(!text.includes(privateValue), privateValue);
  }));
test('exports preserve exact snapshot, amount, row scope, dates and history', () =>
  fixture(async (e, c) => {
    await complete(e, c);
    const w = await report(e),
      x = await exportReport(e, w, 'money');
    assert.equal(x.rowCount, w.money.length);
    assert.equal(x.rows[0][5], w.current.captured);
    assert.deepEqual(x.storeIds, ['store-nagi']);
    assert.equal(x.timeZone, 'Asia/Tokyo');
    assert.deepEqual(
      (await report(e)).exports.map((r) => r.id),
      [x.id],
    );
    assert.deepEqual(await e.reporting.download(shop, x.id), x);
  }));
test('new refunds invalidate export token while downloaded snapshots remain unchanged', () =>
  fixture(async (e, c) => {
    const b = await complete(e, c),
      w = await report(e),
      x = await exportReport(e, w, 'summary');
    await e.refund(shop, b.id, b.version, 1000);
    await assert.rejects(() => exportReport(e, w, 'summary'), code('REPORT_CHANGED'));
    assert.deepEqual(await e.reporting.download(shop, x.id), x);
    assert.notEqual((await report(e)).token, w.token);
  }));
test('export retries return original snapshot and reject conflicting key reuse', () =>
  fixture(async (e, c) => {
    const b = await complete(e, c),
      w = await report(e),
      key = randomUUID(),
      x = await exportReport(e, w, 'money', shop, key);
    await e.refund(shop, b.id, b.version, 1000);
    assert.deepEqual(await exportReport(e, w, 'money', shop, key), x);
    await assert.rejects(
      () => exportReport(e, w, 'summary', shop, key),
      code('IDEMPOTENCY_CONFLICT'),
    );
    assert.equal((await report(e)).exports.length, 1);
  }));
test('read-only finance auditors cannot export or download, and previous role access is revalidated', () =>
  fixture(async (e, c) => {
    await complete(e, c);
    const a: Actor = {
      ...admin,
      id: 'qa-report-auditor',
      adminRole: 'AUDITOR',
      adminSessionVersion: 1,
    };
    await e.repo.transaction(async (tx) => {
      await tx.put<AdminMember>('adminMembers', {
        id: a.id,
        name: 'QA auditor',
        email: 'qa@example.test',
        adminRole: 'AUDITOR',
        status: 'ACTIVE',
        version: 1,
        sessionVersion: 1,
        teams: [],
        createdAt: c.now,
        updatedAt: c.now,
      });
    });
    const w = await report(e, a);
    assert.equal(w.canExport, false);
    await assert.rejects(() => exportReport(e, w, 'summary', a), code('FORBIDDEN'));
    const x = await exportReport(e, await report(e));
    await assert.rejects(() => e.reporting.download(a, x.id), code('NOT_FOUND'));
    await e.repo.transaction(async (tx) => {
      const m = (await tx.get<AdminMember>('adminMembers', a.id))!;
      await tx.put('adminMembers', { ...m, status: 'DISABLED' });
    });
    await assert.rejects(() => report(e, a), code('UNAUTHENTICATED'));
  }));
test('foreign merchants cannot retrieve another merchant export', () =>
  fixture(async (e, c) => {
    await complete(e, c);
    const x = await exportReport(e, await report(e));
    await assert.rejects(
      () => e.reporting.download({ ...shop, id: 'foreign-shop', storeId: 'store-mori' }, x.id),
      code('NOT_FOUND'),
    );
  }));
test('all export sections are explicit; empty detail exports cannot silently create files', () =>
  fixture(async (e, c) => {
    await complete(e, c);
    const w = await report(e);
    for (const type of ['summary', 'trend', 'money', 'orders'] as const)
      assert((await exportReport(e, w, type)).rows.length > 0);
    for (const type of ['annual', 'invoices', 'settlements'] as const)
      await assert.rejects(() => exportReport(e, w, type), code('REPORT_EMPTY'));
    await assert.rejects(() =>
      e.reporting.export(
        shop,
        { query: q, token: w.token, type: 'summary', customerId: 'bad' },
        randomUUID(),
      ),
    );
    await assert.rejects(
      () => e.reporting.export(shop, { query: q, token: w.token, type: 'summary' }, ''),
      code('IDEMPOTENCY_REQUIRED'),
    );
  }));
test('stopped shops retain reports and export access without changing financial or subscription records', () =>
  fixture(async (e, c) => {
    await complete(e, c);
    await e.repo.transaction(async (tx) => {
      const s = (await tx.get<Store>('stores', 'store-nagi'))!;
      await tx.put('stores', { ...s, active: false });
    });
    const before = await e.subscriptions.workspace(shop),
      w = await report(e);
    await exportReport(e, w);
    assert.deepEqual((await e.subscriptions.workspace(shop)).subscription, before.subscription);
    assert.equal((await e.finance.workspace(shop)).rows.length, 1);
  }));

test('shop comparisons reconcile to selected platform totals and exclude other stores from merchant views', () =>
  fixture(async (e, c) => {
    await complete(e, c);
    const all = await report(e, admin),
      own = await report(e);
    assert.equal(all.shops.length, 3);
    assert.equal(own.shops.length, 1);
    assert.equal(
      all.shops.reduce((n, s) => n + s.captured, 0),
      all.current.captured,
    );
    assert.equal(
      all.shops.reduce((n, s) => n + s.annualPaid, 0),
      all.current.annualPaid,
    );
    const x = await e.reporting.export(
      admin,
      { query: all.query, token: all.token, type: 'shops' },
      randomUUID(),
    );
    assert.equal(x.rowCount, 3);
    assert(x.rows.every((r) => all.selectedStoreIds.includes(String(r[0]))));
  }));

test('exports over 5000 rows are rejected rather than silently truncated', () =>
  fixture(async (e, c) => {
    const rows = Array.from({ length: 5001 }, (_, i) => ({
      id: 'qa-limit-' + i,
      storeId: 'store-nagi',
      bookingId: 'qa-order-' + i,
      kind: 'CAPTURE' as const,
      at: c.now,
      captured: 1,
      refunded: 0,
      platformFee: 0,
      source: 'DEMO' as const,
      report: null,
      history: [],
      hold: false,
      holdReason: null,
    }));
    const service = new ReportingService(
      (fn) => e.run(fn),
      () => c.now,
      async () => rows,
    );
    const w = await service.workspace(shop, q);
    assert.equal(w.money.length, 5001);
    await assert.rejects(
      () => service.export(shop, { query: w.query, token: w.token, type: 'money' }, randomUUID()),
      code('REPORT_EXPORT_LIMIT'),
    );
    assert.equal(
      (
        await service.export(
          shop,
          { query: w.query, token: w.token, type: 'summary' },
          randomUUID(),
        )
      ).type,
      'summary',
    );
  }));

test('concurrent retry keys create one export and one audit event', () =>
  fixture(async (e, c) => {
    await complete(e, c);
    const w = await report(e),
      key = randomUUID(),
      [a, b] = await Promise.all([
        exportReport(e, w, 'money', shop, key),
        exportReport(e, w, 'money', shop, key),
      ]);
    assert.equal(a.id, b.id);
    assert.equal((await report(e)).exports.length, 1);
    const audit = await e.repo.transaction((tx) =>
      tx.list<{ action: string; detail: string }>('audit'),
    );
    assert.equal(
      audit.filter((r) => r.action === 'FINANCE_REPORT_EXPORTED' && r.detail === a.id).length,
      1,
    );
  }));

test('revoking export rights blocks downloading the operators own historical snapshot', () =>
  fixture(async (e, c) => {
    await complete(e, c);
    const a: Actor = {
      ...admin,
      id: 'qa-revoke-export',
      adminRole: 'FINANCE',
      adminSessionVersion: 1,
    };
    await e.repo.transaction((tx) =>
      tx.put<AdminMember>('adminMembers', {
        id: a.id,
        name: 'QA finance',
        email: 'qa@example.test',
        adminRole: 'FINANCE',
        status: 'ACTIVE',
        version: 1,
        sessionVersion: 1,
        teams: [],
        createdAt: c.now,
        updatedAt: c.now,
      }),
    );
    const w = await report(e, a),
      x = await exportReport(e, w, 'money', a);
    await e.repo.transaction(async (tx) => {
      const m = (await tx.get<AdminMember>('adminMembers', a.id))!;
      await tx.put('adminMembers', { ...m, adminRole: 'AUDITOR' });
    });
    await assert.rejects(() => e.reporting.download(a, x.id), code('FORBIDDEN'));
    assert.equal((await report(e, a)).canExport, false);
  }));
