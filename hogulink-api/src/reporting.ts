import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  canAdmin,
  type Actor,
  type Store,
  type Booking,
  type FinanceRow,
  type Offering,
  type PlanInvoice,
  type SettlementBatch,
  type InvoiceDocument,
  type ReportQuery,
  type ReportMetrics,
  type ReportWorkspace,
  type ReportMoney,
  type ReportOrder,
  type ReportPoint,
  type ReportGroup,
  type ReportExport,
  type ReportExportType,
  type ReportExportInfo,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { currentAdmin, requireAdmin } from './admin-access.js';
import { ensure } from './errors.js';
const day = 86400000,
  jst = 9 * 3600000,
  hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const reportDate = (at: number) => new Date(at + jst).toISOString().slice(0, 10);
const midnight = (s: string) => Date.parse(s + 'T00:00:00+09:00');
const date = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}$/)
  .refine((s) => Number.isFinite(midnight(s)) && reportDate(midnight(s)) === s);
const querySchema = z
  .object({
    from: date,
    to: date,
    groupBy: z.enum(['day', 'month']).default('day'),
    storeId: z.string().min(1).max(100).optional(),
  })
  .strict();
const exportTypes = z.enum([
  'summary',
  'trend',
  'money',
  'orders',
  'settlements',
  'annual',
  'invoices',
  'shops',
]);
const terminal = new Set(['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED']);
const info = (e: ReportExport): ReportExportInfo => ({
  id: e.id,
  at: e.at,
  from: e.from,
  to: e.to,
  type: e.type,
  rowCount: e.rowCount,
  token: e.token,
});
type Saved = { id: string; actorId: string; storeIds: string[]; document: ReportExport };
type Context = {
  stores: Store[];
  bookings: Booking[];
  rows: FinanceRow[];
  annual: PlanInvoice[];
  batches: SettlementBatch[];
  documents: InvoiceDocument[];
  offerings: Offering[];
};
const sum = <T>(a: T[], f: (x: T) => number) => a.reduce((n, x) => n + f(x), 0);
function metrics(ctx: Context, start: number, end: number): ReportMetrics {
  const rows = ctx.rows.filter((r) => r.source === 'DEMO' && r.at >= start && r.at < end),
    bookings = ctx.bookings.filter((b) => b.createdAt >= start && b.createdAt < end),
    docs = ctx.documents.filter((d) => d.issuedAt >= start && d.issuedAt < end),
    original = docs.filter((d) => d.revision === 1);
  const captured = sum(rows, (r) => r.captured),
    refunded = sum(rows, (r) => r.refunded),
    platformFee = sum(rows, (r) => r.platformFee),
    known = rows.filter((r) => r.report?.status === 'MATCHED'),
    unknownProcessorRows = rows.length - known.length,
    knownProcessorFee = sum(known, (r) => r.report!.processorFee),
    capturedOrders = new Set(rows.filter((r) => r.captured > 0).map((r) => r.bookingId)).size;
  const completed = bookings.filter((b) => b.status === 'COMPLETED').length,
    closed = bookings.filter((b) => terminal.has(b.status)).length;
  const invoiceIssued = sum(
      original.filter((d) => d.kind === 'INVOICE'),
      (d) => d.amount,
    ),
    invoiceCredits = sum(
      original.filter((d) => d.kind === 'CREDIT_NOTE'),
      (d) => d.amount,
    );
  return {
    captured,
    refunded,
    platformFee,
    salesNet: captured - refunded,
    merchantNet: captured - refunded - platformFee,
    knownProcessorFee,
    unknownProcessorRows,
    merchantNetAfterFees: unknownProcessorRows
      ? null
      : captured - refunded - platformFee - knownProcessorFee,
    capturedOrders,
    averageCapture: capturedOrders ? Math.round(captured / capturedOrders) : null,
    annualPaid: sum(
      ctx.annual.filter(
        (a) => a.status === 'PAID' && a.paidAt !== undefined && a.paidAt >= start && a.paidAt < end,
      ),
      (a) => a.amount,
    ),
    settlementRecorded: sum(
      ctx.batches.filter(
        (b) => b.state === 'RECORDED' && b.updatedAt >= start && b.updatedAt < end,
      ),
      (b) => b.net,
    ),
    invoiceIssued,
    invoiceCredits,
    invoiceNet: invoiceIssued - invoiceCredits,
    invoiceCount: docs.length,
    correctionCount: docs.filter((d) => d.revision > 1).length,
    orders: bookings.length,
    completed,
    closed,
    cancelled: bookings.filter((b) => b.status === 'CANCELLED').length,
    pending: bookings.length - closed,
    completionBps: closed ? Math.round((completed * 10000) / closed) : null,
  };
}
export class ReportingService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
    private rows: (tx: Records, storeId: string) => Promise<FinanceRow[]>,
  ) {}
  private parse(input: unknown): ReportQuery {
    const d = querySchema.parse(input),
      days = (midnight(d.to) - midnight(d.from)) / day + 1;
    ensure(
      days >= 1 && days <= 366,
      'REPORT_DATE_RANGE',
      'Use an inclusive range of one to 366 Japan calendar days.',
    );
    ensure(
      d.to <= reportDate(this.now()),
      'REPORT_FUTURE_DATE',
      'Reports cannot include a future Japan calendar date.',
    );
    return d;
  }
  private async scope(tx: Records, actor: Actor, q: ReportQuery, exporting = false) {
    if (actor.role === 'ADMIN') {
      actor = await currentAdmin(tx, actor);
      requireAdmin(actor, exporting ? 'finance.export' : 'finance.read');
    } else
      ensure(
        actor.role === 'MERCHANT' && actor.storeId,
        'FORBIDDEN',
        'Shop or platform finance access required.',
        403,
      );
    const all = (await tx.list<Store>('stores')).sort((a, b) => a.id.localeCompare(b.id));
    ensure(
      actor.role !== 'MERCHANT' || !q.storeId || q.storeId === actor.storeId,
      'NOT_FOUND',
      'Shop not found.',
      404,
    );
    const selected = actor.role === 'MERCHANT' ? actor.storeId : q.storeId;
    const stores = selected ? all.filter((s) => s.id === selected) : all;
    ensure(stores.length > 0, 'NOT_FOUND', 'Shop not found.', 404);
    return { actor, stores, all: actor.role === 'ADMIN' ? all : stores };
  }
  private async build(
    tx: Records,
    actor: Actor,
    q: ReportQuery,
    exporting = false,
  ): Promise<ReportWorkspace> {
    const scope = await this.scope(tx, actor, q, exporting),
      ids = scope.stores.map((s) => s.id),
      allowed = new Set(ids),
      at = this.now(),
      start = midnight(q.from),
      end = midnight(q.to) + day,
      length = end - start;
    const ctx: Context = {
      stores: scope.stores,
      bookings: await tx.find<Booking>('bookings', { storeId: [...allowed] }),
      rows: [],
      annual: (await tx.list<PlanInvoice>('planInvoices')).filter((a) => allowed.has(a.storeId)),
      batches: (await tx.list<SettlementBatch>('settlementBatches')).filter((b) =>
        allowed.has(b.storeId),
      ),
      documents: (await tx.list<InvoiceDocument>('invoiceDocuments')).filter((d) =>
        allowed.has(d.storeId),
      ),
      offerings: await tx.list<Offering>('offerings'),
    };
    for (const s of scope.stores) ctx.rows.push(...(await this.rows(tx, s.id)));
    ensure(
      ctx.bookings.length +
        ctx.rows.length +
        ctx.documents.length +
        ctx.annual.length +
        ctx.batches.length <=
        20000,
      'REPORT_TOO_LARGE',
      'Narrow the shop scope before building this report.',
      413,
    );
    const current = metrics(ctx, start, end),
      previous = metrics(ctx, start - length, start),
      inside = (at: number) => at >= start && at < end;
    const latest = ctx.documents.filter((d) => !ctx.documents.some((n) => n.correctsId === d.id));
    const numbers = (line: string) =>
      latest.filter((d) => d.lines.some((l) => l.id === line)).map((d) => d.number);
    const money: ReportMoney[] = ctx.rows
      .filter((r) => r.source === 'DEMO' && inside(r.at))
      .map((r) => ({
        id: r.id,
        storeId: r.storeId,
        bookingId: r.bookingId,
        at: r.at,
        kind: r.kind,
        captured: r.captured,
        refunded: r.refunded,
        platformFee: r.platformFee,
        merchantNet: r.captured - r.refunded - r.platformFee,
        processorFee: r.report?.status === 'MATCHED' ? r.report.processorFee : null,
        reconciliation: r.report?.status ?? ('UNMATCHED' as const),
        held: r.hold,
        ...(r.recordedBatchId ? { settlementId: r.recordedBatchId } : {}),
        invoiceNumbers: numbers(r.id),
      }))
      .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
    const orders: ReportOrder[] = ctx.bookings
      .filter((b) => inside(b.createdAt))
      .map((b) => ({
        id: b.id,
        storeId: b.storeId,
        createdAt: b.createdAt,
        startAt: b.quote.startAt,
        mode: b.quote.bookingMode,
        serviceId: b.quote.offeringId,
        service: b.quote.serviceName ??
          ctx.offerings.find((o) => o.id === b.quote.offeringId)?.name ?? {
            ja: b.quote.offeringId,
            en: b.quote.offeringId,
            'zh-cn': b.quote.offeringId,
          },
        status: b.status,
        captured: b.capturedAmount,
        refunded: b.refundedAmount,
      }))
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    const settlements = ctx.batches
      .filter((b) => inside(b.state === 'RECORDED' ? b.updatedAt : b.createdAt))
      .map((b) => ({
        id: b.id,
        storeId: b.storeId,
        state: b.state,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        net: b.net,
        processorFee: b.processorFee,
        entryCount: b.entryIds.length,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    const annual = ctx.annual
      .filter((a) => inside(a.status === 'PAID' ? a.paidAt! : a.createdAt))
      .map((a) => ({
        id: a.id,
        storeId: a.storeId,
        status: a.status,
        purpose: a.purpose,
        amount: a.amount,
        createdAt: a.createdAt,
        paidAt: a.paidAt,
        dueAt: a.dueAt,
        invoiceNumbers: numbers('annual:' + a.id),
      }))
      .sort(
        (a, b) => (b.paidAt ?? b.createdAt) - (a.paidAt ?? a.createdAt) || a.id.localeCompare(b.id),
      );
    const invoices = ctx.documents
      .filter((d) => inside(d.issuedAt))
      .map((d) => ({
        id: d.id,
        storeId: d.storeId,
        number: d.number,
        kind: d.kind,
        purpose: d.purpose,
        issuedAt: d.issuedAt,
        rootId: d.rootId,
        revision: d.revision,
        amount: d.amount,
        signedAmount: (d.kind === 'CREDIT_NOTE' ? -1 : 1) * d.amount,
        correctsId: d.correctsId,
        originalNumber: d.originalInvoiceRootId
          ? ctx.documents.find((n) => n.id === d.originalInvoiceRootId)?.number
          : undefined,
      }))
      .sort(
        (a, b) => b.issuedAt - a.issuedAt || b.revision - a.revision || a.id.localeCompare(b.id),
      );
    const trend: ReportPoint[] = [];
    for (let t = start; t < end;) {
      const currentDate = reportDate(t);
      const next =
        q.groupBy === 'day'
          ? t + day
          : Date.UTC(+currentDate.slice(0, 4), +currentDate.slice(5, 7), 1) - jst;
      const stop = Math.min(end, next);
      const m = metrics(ctx, t, stop);
      trend.push({
        period: reportDate(t).slice(0, q.groupBy === 'day' ? 10 : 7),
        captured: m.captured,
        refunded: m.refunded,
        platformFee: m.platformFee,
        salesNet: m.salesNet,
        annualPaid: m.annualPaid,
        settlementRecorded: m.settlementRecorded,
        invoiceNet: m.invoiceNet,
      });
      t = stop;
    }
    const groups = (by: 'serviceId' | 'mode'): ReportGroup[] =>
      [...new Set(orders.map((o) => o[by]))]
        .map((id) => {
          const rows = orders.filter((o) => o[by] === id),
            completed = rows.filter((o) => o.status === 'COMPLETED').length,
            closed = rows.filter((o) => terminal.has(o.status)).length;
          return {
            id,
            label:
              by === 'serviceId'
                ? rows[0].service
                : id === 'INSTANT'
                  ? { ja: '今すぐ', en: 'Instant', 'zh-cn': '即时预约' }
                  : { ja: '日時指定', en: 'Scheduled', 'zh-cn': '预约时段' },
            orders: rows.length,
            completed,
            closed,
            completionBps: closed ? Math.round((completed * 10000) / closed) : null,
          };
        })
        .sort((a, b) => b.orders - a.orders || a.id.localeCompare(b.id));
    const legacy = ctx.rows.filter((r) => r.source === 'LEGACY'),
      open = ctx.rows.filter((r) => r.source === 'DEMO' && !r.recordedBatchId),
      pendingAnnual = ctx.annual.filter((a) => a.status === 'OPEN');
    const balances = {
      openAnnual: sum(pendingAnnual, (a) => a.amount),
      overdueAnnual: sum(
        pendingAnnual.filter((a) => a.dueAt < at),
        (a) => a.amount,
      ),
      unsettledBeforeFees: sum(open, (r) => r.captured - r.refunded - r.platformFee),
      pendingSettlements: sum(
        ctx.batches.filter((b) => !['VOID', 'RECORDED'].includes(b.state)),
        (b) => b.net,
      ),
      heldRows: open.filter((r) => r.hold).length,
      unmatchedRows: open.filter((r) => r.report?.status !== 'MATCHED').length,
      legacyRows: legacy.length,
      legacyNet: sum(legacy, (r) => r.captured - r.refunded - r.platformFee),
    };
    const quality = {
      rows: money.length,
      matched: money.filter((r) => r.reconciliation === 'MATCHED').length,
      difference: money.filter((r) => r.reconciliation === 'DIFFERENCE').length,
      unmatched: money.filter((r) => r.reconciliation === 'UNMATCHED').length,
      held: money.filter((r) => r.held).length,
    };
    const data = {
      definitionVersion: 'reporting-demo-v1' as const,
      mode: 'DEMO' as const,
      currency: 'JPY' as const,
      query: q,
      previousPeriod: { from: reportDate(start - length), to: reportDate(start - day) },
      stores: scope.all.map((s) => ({ id: s.id, name: s.name })),
      selectedStoreIds: ids,
      current,
      previous,
      trend,
      services: groups('serviceId'),
      modes: groups('mode'),
      shops: ctx.stores
        .map((store) => {
          const m = metrics(
            {
              ...ctx,
              bookings: ctx.bookings.filter((b) => b.storeId === store.id),
              rows: ctx.rows.filter((r) => r.storeId === store.id),
              annual: ctx.annual.filter((a) => a.storeId === store.id),
              batches: ctx.batches.filter((b) => b.storeId === store.id),
              documents: ctx.documents.filter((d) => d.storeId === store.id),
            },
            start,
            end,
          );
          return {
            id: store.id,
            label: store.name,
            captured: m.captured,
            refunded: m.refunded,
            salesNet: m.salesNet,
            platformFee: m.platformFee,
            annualPaid: m.annualPaid,
            orders: m.orders,
            completionBps: m.completionBps,
          };
        })
        .sort((a, b) => b.salesNet - a.salesNet || a.id.localeCompare(b.id)),
      money,
      orders,
      settlements,
      annual,
      invoices,
      balances,
      quality,
    };
    const token = hash(data),
      exports = (await tx.list<Saved>('reportExports'))
        .filter(
          (s) => s.actorId === scope.actor.id && JSON.stringify(s.storeIds) === JSON.stringify(ids),
        )
        .sort((a, b) => b.document.at - a.document.at || b.id.localeCompare(a.id))
        .slice(0, 10)
        .map((s) => info(s.document));
    return {
      ...data,
      now: at,
      token,
      canExport: scope.actor.role === 'MERCHANT' || canAdmin(scope.actor, 'finance.export'),
      exports,
    };
  }
  async workspace(actor: Actor, input: unknown) {
    const q = this.parse(input);
    return this.run((tx) => this.build(tx, actor, q));
  }
  private exportRows(
    w: ReportWorkspace,
    type: ReportExportType,
  ): { columns: string[]; rows: (string | number | null)[][] } {
    const at = (n: number) => new Date(n + jst).toISOString().replace('Z', '+09:00');
    if (type === 'summary')
      return {
        columns: ['metric', 'current', 'previous', 'unit', 'basis'],
        rows: [
          ...Object.keys(w.current).map((k) => [
            k,
            w.current[k as keyof ReportMetrics],
            w.previous[k as keyof ReportMetrics],
            k === 'completionBps'
              ? 'BASIS_POINTS'
              : [
                    'captured',
                    'refunded',
                    'platformFee',
                    'salesNet',
                    'merchantNet',
                    'knownProcessorFee',
                    'merchantNetAfterFees',
                    'averageCapture',
                    'annualPaid',
                    'settlementRecorded',
                    'invoiceIssued',
                    'invoiceCredits',
                    'invoiceNet',
                  ].includes(k)
                ? 'JPY'
                : 'COUNT',
            ['orders', 'completed', 'closed', 'cancelled', 'pending', 'completionBps'].includes(k)
              ? 'ORDER_CREATION_COHORT_CURRENT_STATUS'
              : k === 'annualPaid'
                ? 'PAYMENT_DATE'
                : k === 'settlementRecorded'
                  ? 'RESULT_RECORDED_DATE'
                  : [
                        'invoiceIssued',
                        'invoiceCredits',
                        'invoiceNet',
                        'invoiceCount',
                        'correctionCount',
                      ].includes(k)
                    ? 'ISSUANCE_DATE_ORIGINAL_AMOUNTS'
                    : 'POSTED_TRANSACTION_DATE',
          ]),
          ...Object.entries(w.balances).map(([k, value]) => [
            'balance.' + k,
            value,
            null,
            ['heldRows', 'unmatchedRows', 'legacyRows'].includes(k) ? 'COUNT' : 'JPY',
            'CURRENT_SNAPSHOT',
          ]),
          ...Object.entries(w.quality).map(([k, value]) => [
            'quality.' + k,
            value,
            null,
            'COUNT',
            'PERIOD_RECONCILIATION_SNAPSHOT',
          ]),
        ],
      };
    if (type === 'shops')
      return {
        columns: [
          'storeId',
          'captured',
          'refunded',
          'salesNet',
          'platformFee',
          'annualPaid',
          'orders',
          'completionBps',
        ],
        rows: w.shops.map((s) => [
          s.id,
          s.captured,
          s.refunded,
          s.salesNet,
          s.platformFee,
          s.annualPaid,
          s.orders,
          s.completionBps,
        ]),
      };
    if (type === 'trend')
      return {
        columns: [
          'period',
          'captured',
          'refunded',
          'platformFee',
          'salesNet',
          'annualPaid',
          'settlementRecorded',
          'invoiceNet',
        ],
        rows: w.trend.map((p) => [
          p.period,
          p.captured,
          p.refunded,
          p.platformFee,
          p.salesNet,
          p.annualPaid,
          p.settlementRecorded,
          p.invoiceNet,
        ]),
      };
    if (type === 'money')
      return {
        columns: [
          'storeId',
          'entryId',
          'bookingId',
          'atJst',
          'kind',
          'captured',
          'refunded',
          'platformFee',
          'merchantNet',
          'processorFee',
          'reconciliation',
          'held',
          'settlementId',
          'invoiceNumbers',
        ],
        rows: w.money.map((r) => [
          r.storeId,
          r.id,
          r.bookingId,
          at(r.at),
          r.kind,
          r.captured,
          r.refunded,
          r.platformFee,
          r.merchantNet,
          r.processorFee,
          r.reconciliation,
          r.held ? 'YES' : 'NO',
          r.settlementId ?? '',
          r.invoiceNumbers.join(' | '),
        ]),
      };
    if (type === 'orders')
      return {
        columns: [
          'storeId',
          'bookingId',
          'createdJst',
          'startJst',
          'serviceId',
          'mode',
          'status',
          'lifetimeCaptured',
          'lifetimeRefunded',
        ],
        rows: w.orders.map((r) => [
          r.storeId,
          r.id,
          at(r.createdAt),
          at(r.startAt),
          r.serviceId,
          r.mode,
          r.status,
          r.captured,
          r.refunded,
        ]),
      };
    if (type === 'settlements')
      return {
        columns: [
          'storeId',
          'settlementId',
          'state',
          'createdJst',
          'updatedJst',
          'net',
          'processorFee',
          'entryCount',
        ],
        rows: w.settlements.map((r) => [
          r.storeId,
          r.id,
          r.state,
          at(r.createdAt),
          at(r.updatedAt),
          r.net,
          r.processorFee,
          r.entryCount,
        ]),
      };
    if (type === 'annual')
      return {
        columns: [
          'storeId',
          'annualId',
          'status',
          'purpose',
          'amount',
          'createdJst',
          'paidJst',
          'dueJst',
          'invoiceNumbers',
        ],
        rows: w.annual.map((r) => [
          r.storeId,
          r.id,
          r.status,
          r.purpose,
          r.amount,
          at(r.createdAt),
          r.paidAt ? at(r.paidAt) : '',
          at(r.dueAt),
          r.invoiceNumbers.join(' | '),
        ]),
      };
    return {
      columns: [
        'storeId',
        'documentId',
        'number',
        'kind',
        'purpose',
        'issuedJst',
        'rootId',
        'revision',
        'signedAmount',
        'correctsId',
        'originalNumber',
      ],
      rows: w.invoices.map((r) => [
        r.storeId,
        r.id,
        r.number,
        r.kind,
        r.purpose,
        at(r.issuedAt),
        r.rootId,
        r.revision,
        r.signedAmount,
        r.correctsId ?? '',
        r.originalNumber ?? '',
      ]),
    };
  }
  async export(actor: Actor, input: unknown, key: string): Promise<ReportExport> {
    const d = z
        .object({ query: querySchema, token: z.string().length(64), type: exportTypes })
        .strict()
        .parse(input),
      q = this.parse(d.query);
    ensure(
      key.length >= 8 && key.length <= 160,
      'IDEMPOTENCY_REQUIRED',
      'A retry key is required.',
    );
    return this.run(async (tx) => {
      const scope = await this.scope(tx, actor, q, true),
        retryId = hash([scope.actor.id, key]),
        fingerprint = hash(d),
        prior = await tx.get<{ id: string; fingerprint: string; exportId: string }>(
          'reportExportRetries',
          retryId,
        );
      if (prior) {
        ensure(
          prior.fingerprint === fingerprint,
          'IDEMPOTENCY_CONFLICT',
          'Retry key has different input.',
          409,
        );
        return (await this.saved(tx, scope.actor, prior.exportId)).document;
      }
      const w = await this.build(tx, scope.actor, q, true);
      ensure(
        w.token === d.token,
        'REPORT_CHANGED',
        'The report changed. Refresh and review before exporting.',
        409,
      );
      const payload = this.exportRows(w, d.type);
      ensure(
        payload.rows.length > 0,
        'REPORT_EMPTY',
        'There are no rows in this report section.',
        409,
      );
      ensure(
        payload.rows.length <= 5000,
        'REPORT_EXPORT_LIMIT',
        'Narrow the range or shop scope before exporting.',
        413,
      );
      const document: ReportExport = {
        definitionVersion: w.definitionVersion,
        id: 'report_export_' + randomUUID(),
        at: this.now(),
        from: q.from,
        to: q.to,
        type: d.type,
        rowCount: payload.rows.length,
        token: w.token,
        mode: 'DEMO',
        currency: 'JPY',
        timeZone: 'Asia/Tokyo',
        storeIds: w.selectedStoreIds,
        groupBy: w.query.groupBy,
        previousPeriod: w.previousPeriod,
        ...payload,
      };
      await tx.put<Saved>('reportExports', {
        id: document.id,
        actorId: scope.actor.id,
        storeIds: w.selectedStoreIds,
        document,
      });
      await tx.put('reportExportRetries', { id: retryId, fingerprint, exportId: document.id });
      await tx.put('audit', {
        id: 'audit_' + randomUUID(),
        actorId: scope.actor.id,
        action: 'FINANCE_REPORT_EXPORTED',
        detail: document.id,
        at: this.now(),
      });
      return document;
    });
  }
  private async saved(tx: Records, actor: Actor, id: string) {
    const record = await tx.get<Saved>('reportExports', id);
    ensure(record && record.actorId === actor.id, 'NOT_FOUND', 'Export not found.', 404);
    const scope = await this.scope(
      tx,
      actor,
      { from: record.document.from, to: record.document.to, groupBy: 'day' },
      true,
    );
    ensure(
      record.storeIds.every((id) => scope.stores.some((s) => s.id === id)),
      'NOT_FOUND',
      'Export not found.',
      404,
    );
    return record;
  }
  async download(actor: Actor, id: string) {
    return this.run(async (tx) => (await this.saved(tx, actor, id)).document);
  }
}
