import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type {
  Actor,
  AdminMember,
  InvoiceRequest,
  InvoiceSource,
  Store,
  InvoiceDocument,
  InvoiceProfile,
  MerchantSubscription,
} from '@hogulink/contracts';
import { fixture, complete, customer, shop, staff, admin } from './helpers/experience-fixture.js';
import { purchaseAnnual } from './helpers/subscription-fixture.js';
import type { Engine } from '../src/engine.js';
import { DomainError } from '../src/errors.js';
const note =
  'Reviewed the original fee source, recipient, refund adjustments and demo issuance scope.';
const checks = {
  source: true as const,
  recipient: true as const,
  history: true as const,
  demo: true as const,
};
const code = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;
const actor = (id: string, adminRole: 'FINANCE' | 'OWNER' | 'AUDITOR'): Actor => ({
  id,
  role: 'ADMIN',
  verificationLevel: 3,
  adminRole,
  adminSessionVersion: 1,
  displayName: id,
});
const finance = actor('invoice-finance', 'FINANCE'),
  owner = actor('invoice-owner', 'OWNER'),
  otherOwner = actor('invoice-owner-2', 'OWNER'),
  auditor = actor('invoice-auditor', 'AUDITOR');
const ws = (e: Engine, a = shop) =>
  e.invoicing.workspace(a, a.role === 'ADMIN' ? { storeId: 'store-nagi' } : {});
async function setup(fn: (e: Engine, clock: { now: number }) => Promise<void>) {
  return fixture(async (e, c) => {
    await e.repo.transaction(async (tx) => {
      for (const a of [finance, owner, otherOwner, auditor])
        await tx.put<AdminMember>('adminMembers', {
          id: a.id,
          name: a.id,
          email: a.id + '@example.test',
          adminRole: a.adminRole!,
          teams: [],
          status: 'ACTIVE',
          version: 1,
          sessionVersion: 1,
          createdAt: c.now,
          updatedAt: c.now,
        });
    });
    await fn(e, c);
  });
}
async function reconcile(e: Engine) {
  let f = await e.finance.workspace(shop);
  for (const r of f.rows)
    await e.finance.report(
      admin,
      f.storeId,
      r.id,
      {
        version: r.report?.version ?? 0,
        reference: 'demo_' + r.id,
        captured: r.captured,
        refunded: r.refunded,
        platformFee: r.platformFee,
        processorFee: 0,
        net: r.captured - r.refunded - r.platformFee,
        note,
      },
      randomUUID(),
    );
  f = await e.finance.workspace(shop);
  await e.finance.statement(shop, f.storeId, { month: f.month, token: f.token }, randomUUID());
}
async function source(e: Engine, kind = 'PLATFORM_FEE') {
  const w = await ws(e),
    s = w.sources.find((s) => s.kind === kind && !s.blockedReason);
  assert(s, JSON.stringify(w.sources));
  return s;
}
async function apply(e: Engine, s?: InvoiceSource, a = shop) {
  s = s ?? (await source(e));
  const w = await ws(e, a);
  return (await e.invoicing.create(
    a,
    'store-nagi',
    {
      sourceKey: s.key,
      sourceToken: s.token,
      ...(s.kind === 'CREDIT_NOTE' ? {} : { profileVersion: w.profile.version }),
      note,
    },
    randomUUID(),
  )) as InvoiceRequest;
}
const act = async (
  e: Engine,
  r: InvoiceRequest,
  action: string,
  a = finance,
  extra: Record<string, unknown> = {},
) =>
  (await e.invoicing.action(
    a,
    r.id,
    {
      version: r.version,
      action,
      note,
      ...(['REVIEW', 'APPROVE', 'ISSUE', 'ISSUE_FAILED'].includes(action) ? { checks } : {}),
      ...extra,
    },
    randomUUID(),
  )) as InvoiceRequest;
async function issue(e: Engine, r?: InvoiceRequest) {
  r = r ?? (await apply(e));
  r = await act(e, r, 'REVIEW');
  r = await act(e, r, 'APPROVE', owner);
  r = await act(e, r, 'ISSUE');
  return (await ws(e)).documents.find((d) => d.id === r.documentId)!;
}
async function billed(e: Engine, c: { now: number }) {
  const b = await complete(e, c);
  await reconcile(e);
  return b;
}
test('invoice access is scoped and excludes customers and therapists', () =>
  setup(async (e) => {
    for (const a of [customer, staff]) await assert.rejects(() => ws(e, a), code('FORBIDDEN'));
    await assert.rejects(
      () => e.invoicing.workspace(shop, { storeId: 'store-mori' }),
      code('NOT_FOUND'),
    );
    const w = await ws(e);
    assert.equal(w.stores.length, 1);
    assert.equal(w.documents.length, 0);
  }));
test('invoice sources require current monthly statement and matched fee facts', () =>
  setup(async (e, c) => {
    await complete(e, c);
    let w = await ws(e);
    assert.equal(w.sources[0].blockedReason, 'INVOICE_STATEMENT_REQUIRED');
    let f = await e.finance.workspace(shop);
    await e.finance.statement(shop, f.storeId, { month: f.month, token: f.token }, randomUUID());
    w = await ws(e);
    assert.equal(w.sources[0].blockedReason, 'INVOICE_RECONCILIATION_REQUIRED');
    await reconcile(e);
    assert.equal((await source(e)).amount, f.totals.platformFee);
  }));
test('only platform fees are invoiced, never service proceeds or payment routing', () =>
  setup(async (e, c) => {
    const b = await billed(e, c),
      s = await source(e);
    assert.equal(s.amount, b.platformFee);
    assert.notEqual(s.amount, b.capturedAmount);
    const r = await apply(e),
      payload = JSON.stringify(r);
    for (const p of ['Private QA address', 'customerId', 'paymentId', 'pspAccount'])
      assert(!payload.includes(p));
  }));
test('only paid annual receipts are eligible and remain separate from platform service fees', () =>
  setup(async (e) => {
    let w = await e.subscriptions.workspace(shop);
    await e.subscriptions.change(
      shop,
      w.storeId,
      { version: w.subscription.version, action: 'REQUEST_ANNUAL', note },
      randomUUID(),
    );
    assert(!(await ws(e)).sources.some((s) => s.kind === 'ANNUAL_FEE'));
    w = await e.subscriptions.workspace(shop);
    const i = w.invoices[0];
    await e.subscriptions.invoiceAction(
      shop,
      i.id,
      {
        version: i.version,
        subscriptionVersion: w.subscription.version,
        action: 'PAY_SUCCEEDED',
        reference: 'plan_invoice_annual_paid',
        note,
      },
      randomUUID(),
    );
    const s = await source(e, 'ANNUAL_FEE');
    assert.equal(s.amount, 100000);
    assert.equal(s.taxBasis, 'EXCLUSIVE_UNASSESSED');
    assert.equal((await e.finance.workspace(shop)).rows.length, 0);
  }));
test('profile changes are versioned, store-scoped and cannot rewrite submitted recipient snapshots', () =>
  setup(async (e, c) => {
    await billed(e, c);
    const r = await apply(e),
      w = await ws(e),
      recipient = {
        name: 'Updated Demo Recipient',
        address: 'Tokyo demo office address',
        email: 'updated@example.test',
        taxId: 'Example only',
      };
    const p = (await e.invoicing.saveProfile(
      shop,
      w.storeId,
      { version: w.profile.version, recipient },
      randomUUID(),
    )) as InvoiceProfile;
    assert.equal(p.version, 1);
    assert.equal((await ws(e)).requests[0].recipient.name, r.recipient.name);
    await assert.rejects(
      () => e.invoicing.saveProfile(shop, w.storeId, { version: 0, recipient }, randomUUID()),
      code('VERSION_CONFLICT'),
    );
    await assert.rejects(
      () => e.invoicing.saveProfile(finance, w.storeId, { version: 1, recipient }, randomUUID()),
      code('FORBIDDEN'),
    );
  }));
test('duplicate requests are prevented across immutable bill revisions and concurrent submissions', () =>
  setup(async (e, c) => {
    await billed(e, c);
    const s = await source(e),
      w = await ws(e),
      body = { sourceKey: s.key, sourceToken: s.token, profileVersion: w.profile.version, note };
    const results = await Promise.allSettled([
      e.invoicing.create(shop, 'store-nagi', body, randomUUID()),
      e.invoicing.create(shop, 'store-nagi', body, randomUUID()),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await ws(e)).requests.length, 1);
  }));
test('review, independent approval and separate issuance produce an immutable demo document', () =>
  setup(async (e, c) => {
    await billed(e, c);
    const r = await apply(e),
      d = await issue(e, r);
    assert.equal(d.amount, r.source.amount);
    assert.equal(d.mode, 'DEMO');
    assert.equal(d.taxAmount, null);
    assert.equal(d.issuer.registrationNumber, null);
    assert(d.number.startsWith('DEMO-INV-'));
    assert.notEqual(d.reviewer.id, d.approver.id);
    assert.notEqual(d.issuedBy.id, d.approver.id);
    await assert.rejects(
      async () => act(e, (await ws(e)).requests[0], 'RETURN'),
      code('INVOICE_FINAL'),
    );
  }));
test('finance cannot approve and the same owner cannot approve their own review', () =>
  setup(async (e, c) => {
    await billed(e, c);
    let r = await apply(e);
    r = await act(e, r, 'REVIEW', owner);
    await assert.rejects(() => act(e, r, 'APPROVE', finance), code('FORBIDDEN'));
    await assert.rejects(() => act(e, r, 'APPROVE', owner), code('SEPARATE_APPROVER_REQUIRED'));
    r = await act(e, r, 'APPROVE', otherOwner);
    await assert.rejects(() => act(e, r, 'ISSUE', otherOwner), code('SEPARATE_ISSUER_REQUIRED'));
    await act(e, r, 'ISSUE', finance);
  }));
test('approval and issuance cannot skip first review or explicit attestations', () =>
  setup(async (e, c) => {
    await billed(e, c);
    const r = await apply(e);
    await assert.rejects(() => act(e, r, 'APPROVE', owner), code('INVALID_STATE'));
    await assert.rejects(() => act(e, r, 'ISSUE'), code('INVALID_STATE'));
    await assert.rejects(
      () =>
        e.invoicing.action(
          finance,
          r.id,
          { version: r.version, action: 'REVIEW', note },
          randomUUID(),
        ),
      code('INVALID_INPUT'),
    );
  }));
test('return and resubmit refresh the recipient and require all reviews again', () =>
  setup(async (e, c) => {
    await billed(e, c);
    let r = await apply(e);
    r = await act(e, r, 'REVIEW');
    r = await act(e, r, 'RETURN', owner);
    assert.equal(r.state, 'CHANGES_REQUESTED');
    const w = await ws(e),
      s = w.requests[0].currentSource!;
    r = await act(e, r, 'RESUBMIT', shop, {
      sourceToken: s.token,
      profileVersion: w.profile.version,
    });
    assert.equal(r.state, 'SUBMITTED');
    assert.equal(r.approver, undefined);
    assert.equal(r.reviewer, undefined);
  }));
test('withdrawal and rejection release source reservation while preserving history', () =>
  setup(async (e, c) => {
    await billed(e, c);
    let r = await apply(e);
    r = await act(e, r, 'WITHDRAW', shop);
    assert.equal(r.state, 'WITHDRAWN');
    r = await apply(e);
    r = await act(e, r, 'REJECT');
    assert.equal(r.state, 'REJECTED');
    await apply(e);
    assert.equal((await ws(e)).requests.length, 3);
    assert((await ws(e)).history.some((e) => e.action === 'WITHDRAW'));
  }));
test('refund before issue makes prior approval stale without stopping refund execution', () =>
  setup(async (e, c) => {
    const b = await billed(e, c);
    let r = await apply(e);
    r = await act(e, r, 'REVIEW');
    r = await act(e, r, 'APPROVE', owner);
    await e.refund(shop, b.id, b.version, 1000);
    assert((await ws(e)).requests[0].stale);
    await assert.rejects(() => act(e, r, 'ISSUE'), code('INVOICE_SOURCE_CHANGED'));
    await reconcile(e);
    const w = await ws(e),
      s = w.requests[0].currentSource!;
    r = await act(e, r, 'RESUBMIT', shop, {
      sourceToken: s.token,
      profileVersion: w.profile.version,
    });
    assert(r.source.amount < b.platformFee);
    assert.equal(r.state, 'SUBMITTED');
  }));
test('active private aftercare is an opaque invoice blocker', () =>
  setup(async (e, c) => {
    const b = await billed(e, c);
    await e.care.create(
      customer,
      { bookingId: b.id, category: 'PRIVACY', subject: 'PRIVATE_INVOICE_QA', description: note },
      randomUUID(),
    );
    const w = await ws(e);
    assert.equal(w.sources[0].blockedReason, 'INVOICE_BUSINESS_PENDING');
    assert(!JSON.stringify(w.sources).includes('PRIVATE_INVOICE_QA'));
  }));
test('refund after issued invoice creates a linked credit note and preserves original document', () =>
  setup(async (e, c) => {
    const b = await billed(e, c),
      original = await issue(e),
      saved = JSON.stringify(original);
    await e.refund(shop, b.id, b.version, 1000);
    await reconcile(e);
    const s = await source(e, 'CREDIT_NOTE');
    assert.equal(s.amount, 88);
    assert.equal(s.originalDocumentId, original.id);
    const r = await apply(e, s),
      credit = await issue(e, r);
    assert.equal(credit.kind, 'CREDIT_NOTE');
    assert.equal(credit.originalInvoiceRootId, original.rootId);
    assert.equal(JSON.stringify((await ws(e)).documents.find((d) => d.id === original.id)), saved);
  }));
test('platform finance can create a required refund adjustment but not choose ordinary recipient invoices', () =>
  setup(async (e, c) => {
    const b = await billed(e, c);
    const s = await source(e);
    await assert.rejects(() => apply(e, s, finance), code('FORBIDDEN'));
    await issue(e);
    await e.refund(shop, b.id, b.version, 1000);
    await reconcile(e);
    const credit = await source(e, 'CREDIT_NOTE');
    const r = await apply(e, credit, finance);
    assert.equal(r.kind, 'CREDIT_NOTE');
    await issue(e, r);
  }));
test('multiple partial refund credits reconcile exactly through the final full reversal', () =>
  setup(async (e, c) => {
    let b = await billed(e, c);
    const d = await issue(e);
    for (const amount of [1000, 1001, b.capturedAmount - 2001]) {
      b = await e.refund(shop, b.id, b.version, amount);
      await reconcile(e);
      await issue(e, await apply(e, await source(e, 'CREDIT_NOTE')));
    }
    const w = await ws(e);
    assert.equal(
      w.documents
        .filter((d) => d.kind === 'CREDIT_NOTE' && d.revision === 1)
        .reduce((n, d) => n + d.amount, 0),
      d.amount,
    );
    assert(!w.sources.some((s) => s.kind === 'CREDIT_NOTE'));
  }));
test('pre-invoice refund is netted once, later credits never double-reverse it', () =>
  setup(async (e, c) => {
    let b = await billed(e, c);
    b = await e.refund(shop, b.id, b.version, 1000);
    await reconcile(e);
    const d = await issue(e);
    assert.equal(d.amount, 682);
    b = await e.refund(shop, b.id, b.version, b.capturedAmount - 1000);
    await reconcile(e);
    const credit = await issue(e, await apply(e, await source(e, 'CREDIT_NOTE')));
    assert.equal(credit.amount, 682);
  }));
test('full refund before invoice does not produce a positive invoice', () =>
  setup(async (e, c) => {
    const b = await billed(e, c);
    await e.refund(shop, b.id, b.version, b.capturedAmount);
    await reconcile(e);
    assert(!(await ws(e)).sources.some((s) => s.kind === 'PLATFORM_FEE' && !s.blockedReason));
  }));

test('trial bookings with zero fees never create an invoice source', () =>
  setup(async (e, c) => {
    await e.subscriptions.workspace(shop);
    await e.repo.transaction(async (tx) => {
      const p = (await tx.get<MerchantSubscription>('merchantSubscriptions', 'store-nagi'))!;
      await tx.put('merchantSubscriptions', {
        ...p,
        status: 'TRIALING',
        trialStartedAt: c.now,
        trialEndsAt: c.now + 90 * 86400000,
      });
    });
    const b = await complete(e, c);
    assert.equal(b.platformFee, 0);
    await reconcile(e);
    assert(!(await ws(e)).sources.some((s) => s.kind === 'PLATFORM_FEE'));
  }));

test('cross-month refunds stale pending approvals and become credits after original issuance', () =>
  setup(async (e, c) => {
    const b = await billed(e, c),
      originalMonth = (await e.finance.workspace(shop)).month;
    let r = await apply(e);
    r = await act(e, r, 'REVIEW');
    r = await act(e, r, 'APPROVE', owner);
    c.now = Date.UTC(2026, 10, 1);
    await e.refund(shop, b.id, b.version, 1000);
    await reconcile(e);
    assert((await ws(e)).requests.find((x) => x.id === r.id)!.stale);
    await assert.rejects(() => act(e, r, 'ISSUE'), code('INVOICE_SOURCE_CHANGED'));
    const w = await ws(e),
      v = w.requests.find((x) => x.id === r.id)!;
    assert.equal(v.currentSource!.month, originalMonth);
    r = await act(e, r, 'RESUBMIT', shop, {
      sourceToken: v.currentSource!.token,
      profileVersion: w.profile.version,
    });
    const d = await issue(e, r);
    assert.equal(d.amount, b.platformFee);
    const credit = await issue(e, await apply(e, await source(e, 'CREDIT_NOTE')));
    assert.equal(credit.originalInvoiceRootId, d.rootId);
    assert.equal(credit.amount, Math.floor((b.platformFee * 1000) / b.capturedAmount));
  }));
test('source report corrections invalidate stale reviews even if figures remain equal', () =>
  setup(async (e, c) => {
    await billed(e, c);
    const r = await apply(e);
    await reconcile(e);
    assert((await ws(e)).requests[0].stale);
    await assert.rejects(() => act(e, r, 'REVIEW'), code('INVOICE_SOURCE_CHANGED'));
  }));
test('failed issuance retains approval, is retryable and never creates duplicate documents', () =>
  setup(async (e, c) => {
    await billed(e, c);
    let r = await apply(e);
    r = await act(e, r, 'REVIEW');
    r = await act(e, r, 'APPROVE', owner);
    r = await act(e, r, 'ISSUE_FAILED');
    assert.equal(r.state, 'APPROVED');
    assert.equal((await ws(e)).documents.length, 0);
    r = await act(e, r, 'ISSUE');
    assert.equal(r.attempts.length, 2);
    assert.equal((await ws(e)).documents.length, 1);
  }));
test('stale versions and idempotent issuance protect concurrent operators', () =>
  setup(async (e, c) => {
    await billed(e, c);
    let r = await apply(e);
    r = await act(e, r, 'REVIEW');
    r = await act(e, r, 'APPROVE', owner);
    const body = { version: r.version, action: 'ISSUE', note, checks },
      key = randomUUID(),
      first = await e.invoicing.action(finance, r.id, body, key);
    assert.deepEqual(await e.invoicing.action(finance, r.id, body, key), first);
    await assert.rejects(
      () => e.invoicing.action(finance, r.id, { ...body, note: note + ' edited' }, key),
      code('IDEMPOTENCY_CONFLICT'),
    );
    assert.equal((await ws(e)).documents.length, 1);
  }));
test('recipient corrections append a new revision without consuming fees or erasing prior documents', () =>
  setup(async (e, c) => {
    await billed(e, c);
    const d = await issue(e),
      w = await ws(e);
    await e.invoicing.saveProfile(
      shop,
      w.storeId,
      {
        version: w.profile.version,
        recipient: {
          name: 'Corrected Demo Company',
          address: 'Corrected demo office 2-3-4',
          email: 'corrected@example.test',
          taxId: '',
        },
      },
      randomUUID(),
    );
    const correction = await apply(e, await source(e, 'CORRECTION')),
      next = await issue(e, correction);
    assert.equal(next.correctsId, d.id);
    assert.equal(next.rootId, d.rootId);
    assert.equal(next.revision, 2);
    assert.equal(next.amount, d.amount);
    assert.notEqual(next.recipient.name, d.recipient.name);
    assert.equal((await ws(e)).documents.length, 2);
    assert(!(await ws(e)).sources.some((s) => s.kind === 'PLATFORM_FEE'));
  }));
test('refund adjustment uses the original latest recipient rather than an unrelated current profile', () =>
  setup(async (e, c) => {
    const b = await billed(e, c),
      d = await issue(e),
      w = await ws(e);
    await e.invoicing.saveProfile(
      shop,
      w.storeId,
      {
        version: w.profile.version,
        recipient: {
          name: 'Other Example Company',
          address: 'Other example office 2-3-4',
          email: 'other@example.test',
          taxId: '',
        },
      },
      randomUUID(),
    );
    await e.refund(shop, b.id, b.version, 1000);
    await reconcile(e);
    const r = await apply(e, await source(e, 'CREDIT_NOTE'));
    assert.deepEqual(r.recipient, d.recipient);
  }));
test('invoice documents do not modify annual entitlement, monthly bills or settlement balances', () =>
  setup(async (e, c) => {
    await purchaseAnnual(e, shop);
    await billed(e, c);
    const before = await e.finance.workspace(shop),
      annual = await e.subscriptions.workspace(shop);
    await issue(e, await apply(e, await source(e, 'ANNUAL_FEE')));
    await issue(e, await apply(e, await source(e)));
    const after = await e.finance.workspace(shop);
    assert.deepEqual(after.rows, before.rows);
    assert.deepEqual(after.statements, before.statements);
    assert.deepEqual(after.totals, before.totals);
    assert.deepEqual((await e.subscriptions.workspace(shop)).subscription, annual.subscription);
  }));
test('inactive shops retain invoice history access and annual applications', () =>
  setup(async (e) => {
    await purchaseAnnual(e, shop);
    await e.repo.transaction(async (tx) => {
      const s = (await tx.get<Store>('stores', 'store-nagi'))!;
      await tx.put('stores', { ...s, active: false });
    });
    const r = await apply(e, await source(e, 'ANNUAL_FEE'));
    await issue(e, r);
    assert.equal((await ws(e)).documents.length, 1);
  }));
test('read-only auditors and merchants cannot review, approve or issue financial documents', () =>
  setup(async (e, c) => {
    await billed(e, c);
    const r = await apply(e);
    await ws(e, auditor);
    await assert.rejects(() => act(e, r, 'REVIEW', auditor), code('FORBIDDEN'));
    await assert.rejects(() => act(e, r, 'REVIEW', shop), code('FORBIDDEN'));
    await assert.rejects(
      () => e.invoicing.workspace({ ...shop, storeId: 'store-mori' }, { storeId: 'store-nagi' }),
      code('NOT_FOUND'),
    );
  }));
test('revoked sessions and removed approval rights stop issuance and require resubmission', () =>
  setup(async (e, c) => {
    await billed(e, c);
    let r = await apply(e);
    r = await act(e, r, 'REVIEW');
    r = await act(e, r, 'APPROVE', owner);
    await e.repo.transaction(async (tx) => {
      const m = (await tx.get<AdminMember>('adminMembers', owner.id))!;
      await tx.put('adminMembers', { ...m, adminRole: 'FINANCE' });
    });
    await assert.rejects(() => act(e, r, 'ISSUE'), code('INVOICE_APPROVAL_EXPIRED'));
    const expired = (await ws(e, finance)).requests.find((x) => x.id === r.id)!;
    assert.equal(expired.blockedReason, 'INVOICE_APPROVAL_EXPIRED');
    assert.equal(expired.canIssue, false);
    await e.repo.transaction(async (tx) => {
      const m = (await tx.get<AdminMember>('adminMembers', finance.id))!;
      await tx.put('adminMembers', { ...m, status: 'DISABLED' });
    });
    await assert.rejects(() => ws(e, finance), code('UNAUTHENTICATED'));
  }));
test('request retries, profile retries, required keys and strict payloads are enforced', () =>
  setup(async (e, c) => {
    await billed(e, c);
    const s = await source(e),
      w = await ws(e),
      body = { sourceKey: s.key, sourceToken: s.token, profileVersion: w.profile.version, note },
      key = randomUUID();
    const first = await e.invoicing.create(shop, 'store-nagi', body, key);
    assert.deepEqual(await e.invoicing.create(shop, 'store-nagi', body, key), first);
    await assert.rejects(() =>
      e.invoicing.create(shop, 'store-nagi', { ...body, amount: 1 }, randomUUID()),
    );
    await assert.rejects(
      () => e.invoicing.create(shop, 'store-nagi', body, ''),
      code('IDEMPOTENCY_REQUIRED'),
    );
  }));
test('audit and local outbox omit recipient details and free-text review notes', () =>
  setup(async (e, c) => {
    await billed(e, c);
    const w = await ws(e);
    await e.invoicing.saveProfile(
      shop,
      w.storeId,
      {
        version: w.profile.version,
        recipient: {
          name: 'PRIVATE_RECIPIENT_QA',
          address: 'PRIVATE_INVOICE_ADDRESS_QA',
          email: 'private-receipt@example.test',
          taxId: 'PRIVATE_TAX_ID_QA',
        },
      },
      randomUUID(),
    );
    const r = await apply(e);
    await act(e, r, 'REVIEW', finance, {
      note: 'PRIVATE_REVIEW_QA reviewed source and recipient.',
    });
    const payload = await e.repo.transaction(async (tx) =>
      JSON.stringify({ audit: await tx.list('audit'), outbox: await tx.list('outbox') }),
    );
    for (const x of [
      'PRIVATE_RECIPIENT_QA',
      'PRIVATE_INVOICE_ADDRESS_QA',
      'PRIVATE_TAX_ID_QA',
      'PRIVATE_REVIEW_QA',
    ])
      assert(!payload.includes(x));
  }));
