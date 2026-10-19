import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  canAdmin,
  type Actor,
  type AdminMember,
  type BillStatement,
  type FinanceRow,
  type InvoicingWorkspace,
  type InvoiceSource,
  type InvoiceRecipient,
  type InvoiceProfile,
  type InvoiceLine,
  type InvoiceRequest,
  type InvoiceRequestView,
  type InvoiceEvent,
  type InvoiceDocument,
  type InvoiceSignoff,
  type PlanInvoice,
  type Store,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { ensure } from './errors.js';
import { currentAdmin, requireAdmin } from './admin-access.js';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const uid = (p: string) => `${p}_${randomUUID()}`;
const month = (at: number) => new Date(at + 9 * 3600000).toISOString().slice(0, 7);
const note = z.string().trim().min(10).max(1500),
  version = z.number().int().positive(),
  token = z.string().length(64);
const recipient = z
  .object({
    name: z.string().trim().min(2).max(160),
    address: z.string().trim().min(5).max(300),
    email: z.string().trim().email().max(254),
    taxId: z.string().trim().max(50),
  })
  .strict();
const checks = z
  .object({
    source: z.literal(true),
    recipient: z.literal(true),
    history: z.literal(true),
    demo: z.literal(true),
  })
  .strict();
const open = (r: InvoiceRequest) => !['ISSUED', 'REJECTED', 'WITHDRAWN'].includes(r.state);
const reserves = (r: InvoiceRequest) => open(r) || r.state === 'ISSUED';
type Context = {
  store: Store;
  rows: FinanceRow[];
  bills: BillStatement[];
  annual: PlanInvoice[];
  requests: InvoiceRequest[];
  documents: InvoiceDocument[];
};
const line = (e: FinanceRow): InvoiceLine => ({
  id: e.id,
  amount: e.platformFee,
  at: e.at,
  kind: e.platformFee < 0 ? 'FEE_REVERSAL' : 'SERVICE_FEE',
  bookingId: e.bookingId,
});
const raw = (e: { id: string; captured: number; refunded: number; platformFee: number }) => [
  e.id,
  e.captured,
  e.refunded,
  e.platformFee,
];
const sorted = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
function latest(ctx: Context, rootId: string) {
  return ctx.documents
    .filter((d) => d.rootId === rootId)
    .sort((a, b) => b.revision - a.revision)[0];
}
function sources(ctx: Context, ignore = ''): InvoiceSource[] {
  const active = ctx.requests.filter(
      (r) => r.id !== ignore && reserves(r) && r.kind !== 'CORRECTION',
    ),
    claimed = new Set(active.flatMap((r) => r.source.lines.map((e) => e.id)));
  const positiveOwner = new Map<string, InvoiceDocument>();
  for (const d of ctx.documents.filter((d) => d.revision === 1 && d.kind === 'INVOICE'))
    for (const l of d.lines.filter((l) => l.amount > 0)) positiveOwner.set(l.id, d);
  const result: InvoiceSource[] = [];
  const openKey = (key: string) =>
    ctx.requests.some((r) => r.id !== ignore && open(r) && r.source.key === key);
  const quality = (rows: FinanceRow[]) =>
    rows.some((r) => r.hold)
      ? 'INVOICE_BUSINESS_PENDING'
      : rows.some((r) => r.report?.status !== 'MATCHED')
        ? 'INVOICE_RECONCILIATION_REQUIRED'
        : undefined;
  const rowToken = (lines: InvoiceLine[]) => {
    const bookings = new Set(lines.map((l) => l.bookingId).filter(Boolean));
    return ctx.rows
      .filter((r) => bookings.has(r.bookingId))
      .map((r) => [...raw(r), r.report?.version ?? 0, r.report?.status ?? '', r.hold]);
  };
  for (const m of [
    ...new Set(
      ctx.rows.filter((e) => e.platformFee !== 0 && e.source === 'DEMO').map((e) => month(e.at)),
    ),
  ]
    .sort()
    .reverse()) {
    const all = ctx.rows.filter((e) => month(e.at) === m),
      bill = ctx.bills.filter((b) => b.month === m).sort((a, b) => b.revision - a.revision)[0];
    const rows = all.filter(
      (e) =>
        e.source === 'DEMO' &&
        e.platformFee !== 0 &&
        !claimed.has(e.id) &&
        !(e.platformFee < 0 && positiveOwner.has(e.reversalOf ?? '')),
    );
    if (!rows.length) continue;
    const key = `MONTH:${m}`,
      lines = rows.map(line),
      amount = lines.reduce((n, l) => n + l.amount, 0);
    const billCurrent =
      !!bill &&
      hash([...bill.lines].sort(sorted).map(raw)) === hash([...all].sort(sorted).map(raw));
    const blockedReason = openKey(key)
      ? 'INVOICE_ALREADY_PENDING'
      : !billCurrent
        ? 'INVOICE_STATEMENT_REQUIRED'
        : amount <= 0
          ? 'INVOICE_NO_POSITIVE_FEE'
          : quality(rows);
    result.push({
      key,
      kind: 'PLATFORM_FEE',
      sourceId: bill?.id ?? '',
      month: m,
      amount,
      taxBasis: 'UNASSESSED',
      lines,
      token: hash([bill?.id, lines, rowToken(lines)]),
      ...(blockedReason ? { blockedReason } : {}),
    });
  }
  for (const a of ctx.annual.filter((a) => a.status === 'PAID' && !claimed.has(`annual:${a.id}`))) {
    const key = `ANNUAL:${a.id}`,
      lines: InvoiceLine[] = [
        { id: `annual:${a.id}`, amount: a.amount, at: a.paidAt!, kind: 'ANNUAL_PLAN_FEE' },
      ];
    result.push({
      key,
      kind: 'ANNUAL_FEE',
      sourceId: a.id,
      amount: a.amount,
      taxBasis: 'EXCLUSIVE_UNASSESSED',
      lines,
      token: hash([a.id, a.version, a.amount, a.reference, a.coverageStartAt, a.coverageEndAt]),
      ...(openKey(key) ? { blockedReason: 'INVOICE_ALREADY_PENDING' } : {}),
    });
  }
  const roots = new Set(
    ctx.rows
      .filter(
        (e) => e.platformFee < 0 && !claimed.has(e.id) && positiveOwner.has(e.reversalOf ?? ''),
      )
      .map((e) => positiveOwner.get(e.reversalOf!)!.rootId),
  );
  for (const root of roots) {
    const base = latest(ctx, root)!,
      rows = ctx.rows.filter(
        (e) =>
          e.platformFee < 0 &&
          !claimed.has(e.id) &&
          positiveOwner.get(e.reversalOf ?? '')?.rootId === root,
      ),
      lines = rows.map(line),
      amount = -lines.reduce((n, l) => n + l.amount, 0);
    const previous = ctx.documents
        .filter(
          (d) => d.revision === 1 && d.kind === 'CREDIT_NOTE' && d.originalInvoiceRootId === root,
        )
        .reduce((n, d) => n + d.amount, 0),
      key = `CREDIT:${root}`;
    const blockedReason = openKey(key)
      ? 'INVOICE_ALREADY_PENDING'
      : amount > base.amount - previous
        ? 'INVOICE_CREDIT_LIMIT'
        : quality(rows);
    result.push({
      key,
      kind: 'CREDIT_NOTE',
      sourceId: root,
      originalDocumentId: base.id,
      amount,
      taxBasis: base.taxBasis,
      lines,
      token: hash([base.id, previous, lines, rowToken(lines)]),
      ...(blockedReason ? { blockedReason } : {}),
    });
  }
  for (const root of [...new Set(ctx.documents.map((d) => d.rootId))]) {
    const d = latest(ctx, root)!,
      key = `CORRECTION:${root}`;
    if (d.revision >= 50) continue;
    result.push({
      key,
      kind: 'CORRECTION',
      sourceId: d.id,
      originalDocumentId: d.id,
      amount: d.amount,
      taxBasis: d.taxBasis,
      lines: d.lines,
      token: hash([d.id, d.revision, d.recipient]),
      ...(openKey(key) ? { blockedReason: 'INVOICE_ALREADY_PENDING' } : {}),
    });
  }
  return result;
}
export class InvoicingService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
    private rows: (tx: Records, storeId: string) => Promise<FinanceRow[]>,
  ) {}
  private async scope(tx: Records, actor: Actor, storeId?: string, write = false) {
    if (actor.role === 'ADMIN') {
      actor = await currentAdmin(tx, actor);
      requireAdmin(actor, write ? 'finance.write' : 'finance.read');
    } else
      ensure(
        actor.role === 'MERCHANT' && actor.storeId,
        'FORBIDDEN',
        'Shop invoicing access required.',
        403,
      );
    const stores = await tx.list<Store>('stores'),
      id = actor.role === 'MERCHANT' ? actor.storeId! : (storeId ?? stores[0]?.id);
    ensure(
      actor.role !== 'MERCHANT' || !storeId || storeId === actor.storeId,
      'NOT_FOUND',
      'Shop not found.',
      404,
    );
    const store = stores.find((s) => s.id === id);
    ensure(store, 'NOT_FOUND', 'Shop not found.', 404);
    return { actor, store, stores: actor.role === 'ADMIN' ? stores : [store] };
  }
  private profile(tx: Records, s: Store): Promise<InvoiceProfile> {
    return tx.get<InvoiceProfile>('invoiceProfiles', s.id).then(
      (p) =>
        p ?? {
          id: s.id,
          version: 0,
          updatedAt: 0,
          name: s.legalName,
          address: s.legalAddress,
          email: s.contact.includes('@') ? s.contact : '',
          taxId: '',
        },
    );
  }
  private async context(tx: Records, store: Store): Promise<Context> {
    return {
      store,
      rows: await this.rows(tx, store.id),
      bills: (await tx.list<BillStatement>('billStatements')).filter((b) => b.storeId === store.id),
      annual: (await tx.list<PlanInvoice>('planInvoices')).filter((i) => i.storeId === store.id),
      requests: (await tx.list<InvoiceRequest>('invoiceRequests')).filter(
        (r) => r.storeId === store.id,
      ),
      documents: (await tx.list<InvoiceDocument>('invoiceDocuments')).filter(
        (d) => d.storeId === store.id,
      ),
    };
  }
  private sign(actor: Actor): InvoiceSignoff {
    return {
      id: actor.id,
      name: actor.displayName ?? actor.id,
      adminRole: actor.adminRole,
      sessionVersion: actor.adminSessionVersion,
      at: this.now(),
    };
  }
  private async validSign(tx: Records, s: InvoiceSignoff, approve = false) {
    if (!s.adminRole) return true;
    const member = await tx.get<AdminMember>('adminMembers', s.id);
    return (
      !!member &&
      member.status === 'ACTIVE' &&
      member.sessionVersion === s.sessionVersion &&
      canAdmin(
        { id: s.id, role: 'ADMIN', verificationLevel: 3, adminRole: member.adminRole },
        approve ? 'finance.approve' : 'finance.write',
      )
    );
  }
  private async replay(tx: Records, actor: Actor, action: string, key: string, input: unknown) {
    ensure(
      key.length >= 8 && key.length <= 160,
      'IDEMPOTENCY_REQUIRED',
      'A retry key is required.',
    );
    const id = hash([actor.id, action, key]),
      fingerprint = hash(input),
      prior = await tx.get<{ id: string; fingerprint: string; result: unknown }>(
        'invoiceRetries',
        id,
      );
    if (prior)
      ensure(
        prior.fingerprint === fingerprint,
        'IDEMPOTENCY_CONFLICT',
        'Retry key has different input.',
        409,
      );
    return { id, fingerprint, prior };
  }
  private async remember(tx: Records, retry: { id: string; fingerprint: string }, result: unknown) {
    await tx.put('invoiceRetries', { id: retry.id, fingerprint: retry.fingerprint, result });
    return result;
  }
  private async event(tx: Records, actor: Actor, r: InvoiceRequest, action: string, text: string) {
    await tx.put<InvoiceEvent>('invoiceEvents', {
      id: uid('invoice_event'),
      storeId: r.storeId,
      requestId: r.id,
      action,
      role: actor.role as 'MERCHANT' | 'ADMIN',
      operator: actor.displayName ?? actor.id,
      at: this.now(),
      note: text,
    });
    await tx.put('audit', {
      id: uid('audit'),
      actorId: actor.id,
      action: `INVOICE_${action}`,
      detail: r.id,
      at: this.now(),
    });
    await tx.put('outbox', {
      id: uid('outbox'),
      type: `INVOICE_${action}`,
      storeId: r.storeId,
      target: r.id,
      createdAt: this.now(),
      status: 'PENDING',
      delivery: 'DEMO_LOCAL_ONLY',
    });
  }
  async workspace(actor: Actor, input: unknown = {}): Promise<InvoicingWorkspace> {
    const d = z.object({ storeId: z.string().optional() }).strict().parse(input);
    return this.run(async (tx) => {
      const scope = await this.scope(tx, actor, d.storeId);
      actor = scope.actor;
      const ctx = await this.context(tx, scope.store);
      const requests: InvoiceRequestView[] = await Promise.all(
        ctx.requests
          .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
          .map(async (r) => {
            const currentSource = sources(ctx, r.id).find((s) => s.key === r.source.key),
              stale = !currentSource || currentSource.token !== r.source.token,
              eligible = !stale && !currentSource?.blockedReason;
            const writable = canAdmin(actor, 'finance.write'),
              approver = canAdmin(actor, 'finance.approve');
            const reviewerValid = !r.reviewer || (await this.validSign(tx, r.reviewer)),
              approverValid = !r.approver || (await this.validSign(tx, r.approver, true)),
              signoffExpired =
                ['REVIEWED', 'APPROVED'].includes(r.state) && (!reviewerValid || !approverValid);
            return {
              ...r,
              currentSource: open(r) ? currentSource : undefined,
              stale: open(r) && stale,
              blockedReason: open(r)
                ? (currentSource?.blockedReason ??
                  (signoffExpired ? 'INVOICE_APPROVAL_EXPIRED' : undefined))
                : undefined,
              canReview: writable && r.state === 'SUBMITTED' && eligible,
              canApprove:
                approver &&
                r.state === 'REVIEWED' &&
                eligible &&
                reviewerValid &&
                r.reviewer?.id !== actor.id,
              canIssue:
                writable &&
                r.state === 'APPROVED' &&
                eligible &&
                r.approver?.id !== actor.id &&
                !!r.approver &&
                !!r.reviewer &&
                approverValid &&
                reviewerValid,
              canResubmit:
                actor.role === 'MERCHANT' &&
                open(r) &&
                !!currentSource &&
                !currentSource.blockedReason,
              canWithdraw: actor.role === 'MERCHANT' && open(r),
              canReturn: writable && open(r),
            };
          }),
      );
      const available = sources(ctx);
      return {
        now: this.now(),
        mode: 'DEMO',
        storeId: scope.store.id,
        stores: scope.stores.map((s) => ({ id: s.id, name: s.name })),
        profile: await this.profile(tx, scope.store),
        sources: available,
        requests,
        documents: ctx.documents.sort((a, b) => b.issuedAt - a.issuedAt || b.revision - a.revision),
        history: (await tx.list<InvoiceEvent>('invoiceEvents'))
          .filter((e) => e.storeId === scope.store.id)
          .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id)),
        totals: {
          pending: requests.filter((r) => open(r)).length,
          approved: requests.filter((r) => r.state === 'APPROVED').length,
          issued: ctx.documents.length,
          adjustments: available.filter((s) => s.kind === 'CREDIT_NOTE').length,
        },
      };
    });
  }
  async saveProfile(actor: Actor, storeId: string, input: unknown, key: string) {
    const d = z
      .object({ version: z.number().int().nonnegative(), recipient })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const scope = await this.scope(tx, actor, storeId);
      actor = scope.actor;
      ensure(
        actor.role === 'MERCHANT',
        'FORBIDDEN',
        'Only the merchant edits its recipient profile.',
        403,
      );
      const retry = await this.replay(tx, actor, 'profile', key, [storeId, d]);
      if (retry.prior) return retry.prior.result;
      const p = await this.profile(tx, scope.store);
      ensure(p.version === d.version, 'VERSION_CONFLICT', 'Recipient profile changed.', 409);
      const result: InvoiceProfile = {
        ...d.recipient,
        id: storeId,
        version: p.version + 1,
        updatedAt: this.now(),
      };
      await tx.put('invoiceProfiles', result);
      return this.remember(tx, retry, result);
    });
  }
  private async recipientFor(
    tx: Records,
    actor: Actor,
    ctx: Context,
    s: InvoiceSource,
    profileVersion?: number,
  ): Promise<InvoiceRecipient> {
    if (s.kind === 'CREDIT_NOTE') {
      ensure(
        profileVersion === undefined,
        'INVALID_INPUT',
        'Credit notes keep the original recipient.',
      );
      return { ...ctx.documents.find((d) => d.id === s.originalDocumentId)!.recipient };
    }
    ensure(
      actor.role === 'MERCHANT',
      'FORBIDDEN',
      'Only the merchant requests fee invoices or recipient corrections.',
      403,
    );
    const p = await this.profile(tx, ctx.store);
    ensure(
      profileVersion === p.version,
      'VERSION_CONFLICT',
      'Review the latest recipient profile.',
      409,
    );
    return recipient.parse({ name: p.name, address: p.address, email: p.email, taxId: p.taxId });
  }
  async create(actor: Actor, storeId: string, input: unknown, key: string) {
    const d = z
      .object({
        sourceKey: z.string().min(6).max(200),
        sourceToken: token,
        profileVersion: z.number().int().nonnegative().optional(),
        note,
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const scope = await this.scope(tx, actor, storeId, true);
      actor = scope.actor;
      const retry = await this.replay(tx, actor, 'create', key, [storeId, d]);
      if (retry.prior) return retry.prior.result;
      const ctx = await this.context(tx, scope.store),
        source = sources(ctx).find((s) => s.key === d.sourceKey);
      ensure(
        source,
        'INVOICE_SOURCE_UNAVAILABLE',
        'This source has been invoiced or is no longer available.',
        409,
      );
      ensure(
        !source.blockedReason,
        source.blockedReason ?? 'INVOICE_SOURCE_UNAVAILABLE',
        'Complete the source checks first.',
        409,
      );
      ensure(
        source.token === d.sourceToken,
        'INVOICE_SOURCE_CHANGED',
        'The source changed. Review it again.',
        409,
      );
      const r: InvoiceRequest = {
        id: uid('invoice_request'),
        storeId,
        version: 1,
        kind: source.kind,
        state: 'SUBMITTED',
        source,
        recipient: await this.recipientFor(tx, actor, ctx, source, d.profileVersion),
        createdAt: this.now(),
        updatedAt: this.now(),
        attempts: [],
      };
      await tx.put('invoiceRequests', r);
      await this.event(tx, actor, r, 'SUBMIT', d.note);
      return this.remember(tx, retry, r);
    });
  }
  async action(actor: Actor, id: string, input: unknown, key: string) {
    const d = z
      .object({
        version,
        action: z.enum([
          'REVIEW',
          'APPROVE',
          'ISSUE',
          'ISSUE_FAILED',
          'RETURN',
          'REJECT',
          'WITHDRAW',
          'RESUBMIT',
        ]),
        note,
        sourceToken: token.optional(),
        profileVersion: z.number().int().nonnegative().optional(),
        checks: checks.optional(),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      ensure(
        actor.role === 'MERCHANT' || actor.role === 'ADMIN',
        'FORBIDDEN',
        'Invoice access required.',
        403,
      );
      const r = await tx.get<InvoiceRequest>('invoiceRequests', id);
      ensure(r, 'NOT_FOUND', 'Invoice request not found.', 404);
      const scope = await this.scope(tx, actor, r.storeId, actor.role === 'ADMIN');
      actor = scope.actor;
      const merchant = ['WITHDRAW', 'RESUBMIT'].includes(d.action);
      ensure(
        merchant ? actor.role === 'MERCHANT' : actor.role === 'ADMIN',
        'FORBIDDEN',
        'This action belongs to the other party.',
        403,
      );
      if (d.action === 'APPROVE') requireAdmin(actor, 'finance.approve');
      const retry = await this.replay(tx, actor, 'action', key, [id, d]);
      if (retry.prior) return retry.prior.result;
      ensure(r.version === d.version, 'VERSION_CONFLICT', 'This invoice request changed.', 409);
      ensure(open(r), 'INVOICE_FINAL', 'This request is final.', 409);
      const attest = ['REVIEW', 'APPROVE', 'ISSUE', 'ISSUE_FAILED'].includes(d.action);
      ensure(
        attest ? !!d.checks : !d.checks,
        'INVALID_INPUT',
        'Complete the explicit review checklist.',
      );
      ensure(
        d.action === 'RESUBMIT' || (d.sourceToken === undefined && d.profileVersion === undefined),
        'INVALID_INPUT',
        'Source updates require merchant resubmission.',
      );
      const ctx = await this.context(tx, scope.store),
        current = sources(ctx, r.id).find((s) => s.key === r.source.key);
      if (attest) {
        ensure(
          current && current.token === r.source.token,
          'INVOICE_SOURCE_CHANGED',
          'Refunds or source changes require resubmission.',
          409,
        );
        ensure(
          !current.blockedReason,
          current.blockedReason ?? 'INVOICE_SOURCE_UNAVAILABLE',
          'The source is blocked.',
          409,
        );
      }
      if (d.action === 'REVIEW') {
        ensure(
          r.state === 'SUBMITTED',
          'INVALID_STATE',
          'Review the submitted request first.',
          409,
        );
        r.reviewer = this.sign(actor);
        r.state = 'REVIEWED';
      }
      if (d.action === 'APPROVE') {
        ensure(
          r.state === 'REVIEWED' && r.reviewer,
          'INVALID_STATE',
          'A first review is required.',
          409,
        );
        ensure(
          r.reviewer.id !== actor.id,
          'SEPARATE_APPROVER_REQUIRED',
          'A different approver must approve.',
          409,
        );
        ensure(
          await this.validSign(tx, r.reviewer),
          'INVOICE_APPROVAL_EXPIRED',
          'The reviewer access changed. Resubmit for review.',
          409,
        );
        r.approver = this.sign(actor);
        r.state = 'APPROVED';
      }
      if (['ISSUE', 'ISSUE_FAILED'].includes(d.action)) {
        ensure(
          r.state === 'APPROVED' && r.approver && r.reviewer,
          'INVALID_STATE',
          'Approval is required before issuance.',
          409,
        );
        ensure(
          actor.id !== r.approver.id,
          'SEPARATE_ISSUER_REQUIRED',
          'The approver cannot issue the same document.',
          409,
        );
        ensure(
          (await this.validSign(tx, r.approver, true)) && (await this.validSign(tx, r.reviewer)),
          'INVOICE_APPROVAL_EXPIRED',
          'A signoff no longer has current access. Resubmit.',
          409,
        );
        ensure(r.attempts.length < 50, 'HISTORY_LIMIT', 'Review the issuance attempts.', 429);
        r.attempts.push({
          at: this.now(),
          operator: actor.displayName ?? actor.id,
          outcome: d.action === 'ISSUE' ? 'SUCCEEDED' : 'FAILED',
        });
        if (d.action === 'ISSUE') {
          const original = r.source.originalDocumentId
            ? ctx.documents.find((d) => d.id === r.source.originalDocumentId)
            : undefined;
          const kind =
            r.kind === 'CORRECTION'
              ? original!.kind
              : r.kind === 'CREDIT_NOTE'
                ? 'CREDIT_NOTE'
                : 'INVOICE';
          const seqId = `${kind}:${month(this.now())}`,
            seq =
              (await tx.get<{ id: string; value: number }>('invoiceSequences', seqId))?.value ?? 0;
          await tx.put('invoiceSequences', { id: seqId, value: seq + 1 });
          const documentId = uid('invoice_doc');
          const doc: InvoiceDocument = {
            id: documentId,
            requestId: r.id,
            storeId: r.storeId,
            rootId: r.kind === 'CORRECTION' ? original!.rootId : documentId,
            revision: r.kind === 'CORRECTION' ? original!.revision + 1 : 1,
            ...(r.kind === 'CORRECTION' ? { correctsId: original!.id } : {}),
            ...(r.kind === 'CREDIT_NOTE' ||
            (r.kind === 'CORRECTION' && original?.originalInvoiceRootId)
              ? {
                  originalInvoiceRootId:
                    r.kind === 'CREDIT_NOTE' ? original!.rootId : original!.originalInvoiceRootId,
                }
              : {}),
            number: `DEMO-${kind === 'INVOICE' ? 'INV' : 'CRN'}-${month(this.now()).replace('-', '')}-${String(seq + 1).padStart(6, '0')}`,
            kind,
            purpose: r.kind,
            issuedAt: this.now(),
            issuer: original?.issuer ?? {
              name: 'HoguLink Demo',
              registrationNumber: null,
              verified: false,
            },
            recipient: r.recipient,
            amount: r.source.amount,
            currency: 'JPY',
            taxBasis: r.source.taxBasis,
            taxAmount: null,
            mode: 'DEMO',
            lines: r.source.lines,
            sourceKey: r.source.key,
            reviewer: r.reviewer!,
            approver: r.approver!,
            issuedBy: this.sign(actor),
          };
          await tx.put('invoiceDocuments', doc);
          r.documentId = doc.id;
          r.state = 'ISSUED';
        }
      }
      if (d.action === 'RETURN') {
        r.state = 'CHANGES_REQUESTED';
        delete r.reviewer;
        delete r.approver;
      }
      if (d.action === 'REJECT') {
        r.state = 'REJECTED';
        delete r.reviewer;
        delete r.approver;
      }
      if (d.action === 'WITHDRAW') r.state = 'WITHDRAWN';
      if (d.action === 'RESUBMIT') {
        ensure(
          current && !current.blockedReason,
          'INVOICE_SOURCE_UNAVAILABLE',
          'Complete the current source checks first.',
          409,
        );
        ensure(
          d.sourceToken === current.token,
          'INVOICE_SOURCE_CHANGED',
          'Review the refreshed source.',
          409,
        );
        r.recipient = await this.recipientFor(tx, actor, ctx, current, d.profileVersion);
        r.source = current;
        r.state = 'SUBMITTED';
        delete r.reviewer;
        delete r.approver;
      }
      r.version++;
      r.updatedAt = this.now();
      await tx.put('invoiceRequests', r);
      await this.event(tx, actor, r, d.action, d.note);
      return this.remember(tx, retry, r);
    });
  }
}
