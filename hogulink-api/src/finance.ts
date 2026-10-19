import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  Actor,
  Booking,
  MoneyEntry,
  MoneyReport,
  FinanceRow,
  FinanceWorkspace,
  BillStatement,
  SettlementBatch,
  Store,
  SupportTicket,
  RefundRequest,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { currentAdmin, requireAdmin } from './admin-access.js';
import { ensure } from './errors.js';
import { billingStanding } from './subscription.js';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const uid = (p: string) => `${p}_${randomUUID()}`;
const amount = z.number().int().min(0).max(1_000_000_000),
  signed = z.number().int().min(-1_000_000_000).max(1_000_000_000);
const reference = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,99}$/);
const note = z.string().trim().min(10).max(1500);
export const financeMonth = (at: number) => new Date(at + 9 * 3600000).toISOString().slice(0, 7);
const net = (e: Pick<MoneyEntry, 'captured' | 'refunded' | 'platformFee'>) =>
  e.captured - e.refunded - e.platformFee;
export async function ensureMoneyOpening(tx: Records, b: Booking, now: number) {
  if (
    (await tx.list<MoneyEntry>('moneyEntries')).some((e) => e.bookingId === b.id) ||
    (!b.capturedAmount && !b.refundedAmount && !b.platformFee)
  )
    return;
  const fee = (await tx.list<{ id: string; bookingId: string; amount: number }>('feeEntries'))
    .filter((f) => f.bookingId === b.id)
    .reduce((s, f) => s + f.amount, 0);
  await tx.put<MoneyEntry>('moneyEntries', {
    id: `opening_${b.id}`,
    storeId: b.storeId,
    bookingId: b.id,
    kind: 'OPENING',
    at: now,
    captured: b.capturedAmount,
    refunded: b.refundedAmount,
    platformFee: fee,
    source: 'LEGACY',
  });
}
export async function recordMoney(
  tx: Records,
  b: Booking,
  sourceId: string,
  kind: MoneyEntry['kind'],
  captured: number,
  refunded: number,
  platformFee: number,
  now: number,
) {
  const original = (await tx.list<MoneyEntry>('moneyEntries')).find(
    (e) => e.bookingId === b.id && e.kind !== 'REFUND',
  );
  await tx.put<MoneyEntry>('moneyEntries', {
    id: `money_${sourceId}`,
    storeId: b.storeId,
    bookingId: b.id,
    kind,
    at: now,
    captured,
    refunded,
    platformFee,
    source: 'DEMO',
    ...(kind === 'REFUND' && original ? { reversalOf: original.id } : {}),
  });
}
export class FinanceService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
  ) {}
  private async scope(tx: Records, actor: Actor, storeId: string | undefined, write = false) {
    if (actor.role === 'ADMIN') {
      actor = await currentAdmin(tx, actor);
      requireAdmin(actor, write ? 'finance.write' : 'finance.read');
    } else
      ensure(
        actor.role === 'MERCHANT' && actor.storeId,
        'FORBIDDEN',
        'Shop finance or platform finance required.',
        403,
      );
    const stores = await tx.list<Store>('stores');
    const orders = await tx.list<Booking>('bookings');
    const id =
      actor.role === 'MERCHANT'
        ? actor.storeId!
        : (storeId ??
          stores.find((s) => orders.some((b) => b.storeId === s.id && b.capturedAmount > 0))?.id ??
          stores[0]?.id);
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
  async rows(tx: Records, storeId: string): Promise<FinanceRow[]> {
    const bookings = await tx.find<Booking>('bookings', { storeId });
    for (const b of bookings) await ensureMoneyOpening(tx, b, this.now());
    const tickets = await tx.list<SupportTicket>('supportTickets'),
      refunds = await tx.list<RefundRequest>('refundRequests'),
      batches = await tx.list<SettlementBatch>('settlementBatches');
    const rows: FinanceRow[] = [];
    const ledger = await tx.list<MoneyEntry>('moneyEntries'),
      fees = await tx.list<{ bookingId: string; amount: number }>('feeEntries'),
      history = await tx.list<MoneyReport & { entryId: string }>('moneyReportHistory');
    for (const e of (await tx.list<MoneyEntry>('moneyEntries'))
      .filter((e) => e.storeId === storeId)
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))) {
      const b = bookings.find((b) => b.id === e.bookingId);
      const held =
        !b ||
        !['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(b.status) ||
        refunds.some((r) => r.bookingId === e.bookingId && r.status === 'PENDING') ||
        tickets.some(
          (t) => t.bookingId === e.bookingId && !['RESOLVED', 'CLOSED'].includes(t.status),
        );
      const entries = ledger.filter((x) => x.bookingId === e.bookingId),
        integrity =
          !!b &&
          entries.reduce((n, x) => n + x.captured, 0) === b.capturedAmount &&
          entries.reduce((n, x) => n + x.refunded, 0) === b.refundedAmount &&
          entries.reduce((n, x) => n + x.platformFee, 0) ===
            fees.filter((f) => f.bookingId === e.bookingId).reduce((n, f) => n + f.amount, 0);
      rows.push({
        ...e,
        report: (await tx.get<MoneyReport>('moneyReports', e.id)) ?? null,
        recordedBatchId: batches.find((b) => b.state === 'RECORDED' && b.entryIds.includes(e.id))
          ?.id,
        hold: held || !integrity,
        holdReason: !integrity ? 'LEDGER' : held ? 'AFTERCARE' : null,
        history: history
          .filter((h) => h.entryId === e.id)
          .sort((a, b) => b.version - a.version)
          .map(({ entryId: _e, ...h }) => ({ ...h, id: e.id })),
      });
    }
    return rows;
  }
  private token(rows: FinanceRow[]) {
    return hash(
      rows.map((e) => [
        e.id,
        e.captured,
        e.refunded,
        e.platformFee,
        e.report?.version ?? 0,
        e.hold,
        e.recordedBatchId ?? '',
      ]),
    );
  }
  private async event(tx: Records, actor: Actor, action: string, target: string, storeId: string) {
    await tx.put('audit', {
      id: uid('audit'),
      actorId: actor.id,
      action,
      detail: target,
      at: this.now(),
    });
    await tx.put('outbox', {
      id: uid('outbox'),
      type: action,
      target,
      storeId,
      createdAt: this.now(),
      status: 'PENDING',
      delivery: 'DEMO_LOCAL_ONLY',
    });
  }
  private async replay(tx: Records, actor: Actor, action: string, key: string, input: unknown) {
    ensure(
      key.length >= 8 && key.length <= 160,
      'IDEMPOTENCY_REQUIRED',
      'A retry key is required.',
    );
    const id = hash([actor.id, action, key]),
      fingerprint = hash(input),
      old = await tx.get<{ id: string; hash: string; kind: string; target: string }>(
        'financeIdempotency',
        id,
      );
    if (old) {
      ensure(
        old.hash === fingerprint,
        'IDEMPOTENCY_CONFLICT',
        'This retry key has different input.',
        409,
      );
      const saved = await tx.get<any>(old.kind, old.target);
      return { id, fingerprint, result: saved?.response ?? saved };
    }
    return { id, fingerprint, result: undefined };
  }
  private async remember(
    tx: Records,
    retry: { id: string; fingerprint: string },
    kind: string,
    target: string,
  ) {
    await tx.put('financeIdempotency', { id: retry.id, hash: retry.fingerprint, kind, target });
  }
  async workspace(actor: Actor, input: unknown = {}): Promise<FinanceWorkspace> {
    const d = z
      .object({
        storeId: z.string().optional(),
        month: z
          .string()
          .regex(/^20\d{2}-(0[1-9]|1[0-2])$/)
          .optional(),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const { store, stores } = await this.scope(tx, actor, d.storeId),
        all = await this.rows(tx, store.id),
        month = d.month ?? financeMonth(this.now()),
        rows = all.filter((e) => financeMonth(e.at) === month),
        openRows = all.filter((e) => !e.recordedBatchId);
      const batches = (await tx.list<SettlementBatch>('settlementBatches'))
        .filter((b) => b.storeId === store.id)
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
      const totals = {
        captured: rows.reduce((n, e) => n + e.captured, 0),
        refunded: rows.reduce((n, e) => n + e.refunded, 0),
        platformFee: rows.reduce((n, e) => n + e.platformFee, 0),
        net: rows.reduce((n, e) => n + net(e), 0),
        unmatched: openRows.filter((e) => e.report?.status !== 'MATCHED').length,
        held: openRows.filter((e) => e.hold).length,
        unsettled: openRows.reduce((n, e) => n + net(e) - (e.report?.processorFee ?? 0), 0),
      };
      return {
        now: this.now(),
        mode: 'DEMO',
        billing: await billingStanding(tx, store),
        storeId: store.id,
        stores: stores.map((s) => ({ id: s.id, name: s.name })),
        month,
        token: this.token(all),
        rows,
        openRows,
        statements: (await tx.list<BillStatement>('billStatements'))
          .filter((s) => s.storeId === store.id && s.month === month)
          .sort((a, b) => b.revision - a.revision),
        batches,
        totals,
        canPrepare:
          openRows.length > 0 &&
          !totals.unmatched &&
          !totals.held &&
          totals.unsettled >= 0 &&
          !batches.some((b) => !['VOID', 'RECORDED'].includes(b.state)),
      };
    });
  }
  async report(actor: Actor, storeId: string, id: string, input: unknown, key: string) {
    const d = z
      .object({
        version: z.number().int().nonnegative(),
        reference,
        captured: amount,
        refunded: amount,
        platformFee: signed,
        processorFee: signed,
        net: signed,
        note,
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const scope = await this.scope(tx, actor, storeId, true);
      actor = scope.actor;
      ensure(
        actor.role === 'ADMIN',
        'FORBIDDEN',
        'Only platform finance records provider observations.',
        403,
      );
      const rows = await this.rows(tx, scope.store.id),
        e = rows.find((e) => e.id === id);
      ensure(e, 'NOT_FOUND', 'Ledger entry not found.', 404);
      const retry = await this.replay(tx, actor, 'report', key, [storeId, id, d]);
      if (retry.result) return retry.result;
      ensure(
        !e.recordedBatchId,
        'IMMUTABLE_SETTLEMENT',
        'A recorded settlement cannot be changed.',
        409,
      );
      ensure(
        (e.report?.version ?? 0) === d.version,
        'VERSION_CONFLICT',
        'Refresh this reconciliation row.',
        409,
      );
      ensure(
        d.version < 50,
        'HISTORY_LIMIT',
        'Review the provider history before recording further corrections.',
        429,
      );
      const refKey = hash([storeId, d.reference]),
        used = await tx.get<{ id: string; entryId: string }>('providerReferences', refKey);
      ensure(
        !used || used.entryId === id,
        'REFERENCE_USED',
        'This provider reference is already assigned to another entry.',
        409,
      );
      const status =
        d.captured === e.captured &&
        d.refunded === e.refunded &&
        d.platformFee === e.platformFee &&
        d.net === net(e) - d.processorFee
          ? 'MATCHED'
          : 'DIFFERENCE';
      const result: MoneyReport = { ...d, id, version: d.version + 1, status, at: this.now() };
      await tx.put('moneyReports', result);
      await tx.put('moneyReportHistory', { ...result, id: uid('report_history'), entryId: id });
      await tx.put('providerReferences', { id: refKey, entryId: id });
      // Store the immutable response, rather than returning a newer report on retry.
      const snapshotId = uid('report_result');
      await tx.put('financeResults', { id: snapshotId, response: result });
      await this.remember(tx, retry, 'financeResults', snapshotId);
      await this.event(tx, actor, 'FINANCE_REPORT_RECORDED', id, storeId);
      return result;
    });
  }
  async statement(actor: Actor, storeId: string, input: unknown, key: string) {
    const d = z
      .object({
        month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
        token: z.string().length(64),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const scope = await this.scope(tx, actor, storeId, actor.role === 'ADMIN');
      actor = scope.actor;
      const retry = await this.replay(tx, actor, 'statement', key, [storeId, d]);
      if (retry.result) return retry.result;
      const all = await this.rows(tx, storeId);
      ensure(
        d.token === this.token(all),
        'VERSION_CONFLICT',
        'The ledger changed. Review the latest totals.',
        409,
      );
      const lines = all
        .filter((e) => financeMonth(e.at) === d.month)
        .map(
          ({
            report: _r,
            recordedBatchId: _s,
            hold: _h,
            holdReason: _reason,
            history: _history,
            ...e
          }) => e,
        );
      ensure(lines.length, 'EMPTY_STATEMENT', 'No transactions in this month.', 409);
      const token = hash(lines),
        previous = (await tx.list<BillStatement>('billStatements')).filter(
          (s) => s.storeId === storeId && s.month === d.month,
        ),
        same = previous.find((s) => s.token === token);
      if (same) {
        await this.remember(tx, retry, 'billStatements', same.id);
        return same;
      }
      const s: BillStatement = {
        id: uid('statement'),
        storeId,
        month: d.month,
        revision: Math.max(0, ...previous.map((s) => s.revision)) + 1,
        at: this.now(),
        token,
        lines,
        captured: lines.reduce((n, e) => n + e.captured, 0),
        refunded: lines.reduce((n, e) => n + e.refunded, 0),
        platformFee: lines.reduce((n, e) => n + e.platformFee, 0),
        net: lines.reduce((n, e) => n + net(e), 0),
      };
      await tx.put('billStatements', s);
      await this.remember(tx, retry, 'billStatements', s.id);
      await this.event(tx, actor, 'FINANCE_STATEMENT_CREATED', s.id, storeId);
      return s;
    });
  }
  async prepare(actor: Actor, storeId: string, input: unknown, key: string) {
    const d = z
      .object({ token: z.string().length(64), note })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const scope = await this.scope(tx, actor, storeId, true);
      actor = scope.actor;
      ensure(
        actor.role === 'ADMIN',
        'FORBIDDEN',
        'Platform finance prepares settlement verification.',
        403,
      );
      const retry = await this.replay(tx, actor, 'prepare', key, [storeId, d]);
      if (retry.result) return retry.result;
      const all = await this.rows(tx, storeId),
        open = all.filter((e) => !e.recordedBatchId);
      ensure(d.token === this.token(all), 'VERSION_CONFLICT', 'The ledger changed.', 409);
      ensure(
        !(await tx.list<SettlementBatch>('settlementBatches')).some(
          (b) => b.storeId === storeId && !['VOID', 'RECORDED'].includes(b.state),
        ),
        'ACTIVE_BATCH',
        'Finish or void the current batch first.',
        409,
      );
      ensure(
        open.length > 0 && open.every((e) => e.report?.status === 'MATCHED' && !e.hold),
        'RECONCILIATION_REQUIRED',
        'Match every open row and finish aftercare review first.',
        409,
      );
      const value = open.reduce((n, e) => n + net(e) - e.report!.processorFee, 0);
      ensure(
        value >= 0,
        'NEGATIVE_CARRY',
        'Refund adjustments carry forward until offset by new receipts.',
        409,
      );
      const batch: SettlementBatch = {
        id: uid('settlement'),
        storeId,
        version: 1,
        state: 'DRAFT',
        entryIds: open.map((e) => e.id),
        token: this.token(open),
        net: value,
        processorFee: open.reduce((n, e) => n + e.report!.processorFee, 0),
        createdAt: this.now(),
        updatedAt: this.now(),
        notes: [{ role: 'ADMIN', text: d.note, at: this.now() }],
      };
      await tx.put('settlementBatches', batch);
      await this.logBatch(tx, actor, batch, 'PREPARE');
      await this.remember(tx, retry, 'settlementHistory', `${batch.id}:1`);
      return batch;
    });
  }
  private async logBatch(tx: Records, actor: Actor, b: SettlementBatch, action: string) {
    await tx.put('settlementHistory', {
      ...b,
      id: `${b.id}:${b.version}`,
      batchId: b.id,
      response: { ...b },
    });
    await this.event(tx, actor, `FINANCE_SETTLEMENT_${action}`, b.id, b.storeId);
  }
  async batchAction(actor: Actor, id: string, input: unknown, key: string) {
    const d = z
      .object({
        version: z.number().int().positive(),
        action: z.enum(['CONFIRM', 'DISPUTE', 'RESPOND', 'RETRY', 'FAIL', 'RECORD', 'VOID']),
        note,
        reference: reference.optional(),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const b = await tx.get<SettlementBatch>('settlementBatches', id);
      ensure(b, 'NOT_FOUND', 'Settlement batch not found.', 404);
      const scope = await this.scope(tx, actor, b.storeId, actor.role === 'ADMIN');
      actor = scope.actor;
      const merchant = ['CONFIRM', 'DISPUTE'].includes(d.action);
      ensure(
        merchant ? actor.role === 'MERCHANT' : actor.role === 'ADMIN',
        'FORBIDDEN',
        'This action belongs to the other finance party.',
        403,
      );
      const retry = await this.replay(tx, actor, 'batch', key, [id, d]);
      if (retry.result) return retry.result;
      ensure(b.version === d.version, 'VERSION_CONFLICT', 'This settlement changed.', 409);
      ensure(
        !['VOID', 'RECORDED'].includes(b.state),
        'IMMUTABLE_SETTLEMENT',
        'This batch is final.',
        409,
      );
      const transitions: Record<string, string[]> = {
        CONFIRM: ['DRAFT'],
        DISPUTE: ['DRAFT', 'SHOP_CONFIRMED'],
        RESPOND: ['DISPUTED'],
        RETRY: ['FAILED'],
        FAIL: ['SHOP_CONFIRMED'],
        RECORD: ['SHOP_CONFIRMED'],
        VOID: ['DRAFT', 'DISPUTED', 'FAILED', 'SHOP_CONFIRMED'],
      };
      ensure(
        transitions[d.action].includes(b.state),
        'INVALID_STATE',
        'Complete the previous settlement step.',
        409,
      );
      if (['CONFIRM', 'RECORD', 'FAIL'].includes(d.action)) {
        const all = await this.rows(tx, b.storeId),
          rows = all.filter((e) => b.entryIds.includes(e.id));
        ensure(
          rows.length === b.entryIds.length &&
            rows.every((e) => !e.recordedBatchId && !e.hold && e.report?.status === 'MATCHED') &&
            this.token(rows) === b.token &&
            !all.some(
              (e) =>
                !b.entryIds.includes(e.id) &&
                !e.recordedBatchId &&
                (b.entryIds.some((id) => all.find((x) => x.id === id)?.bookingId === e.bookingId) ||
                  net(e) < 0),
            ),
          'BATCH_STALE',
          'New refunds, aftercare, or provider corrections require a new verification batch.',
          409,
        );
      }
      if (d.action === 'RECORD') {
        ensure(
          d.reference,
          'REFERENCE_REQUIRED',
          'Record the simulated provider settlement reference.',
          422,
        );
        ensure(
          !(await tx.list<SettlementBatch>('settlementBatches')).some(
            (x) => x.state === 'RECORDED' && x.reference === d.reference,
          ),
          'REFERENCE_USED',
          'This settlement reference was already recorded.',
          409,
        );
        b.reference = d.reference;
      } else
        ensure(
          !d.reference,
          'INVALID_INPUT',
          'A provider reference is only used for a recorded settlement.',
          422,
        );
      b.state = (
        {
          CONFIRM: 'SHOP_CONFIRMED',
          DISPUTE: 'DISPUTED',
          RESPOND: 'DRAFT',
          RETRY: 'DRAFT',
          FAIL: 'FAILED',
          RECORD: 'RECORDED',
          VOID: 'VOID',
        } as const
      )[d.action];
      b.version++;
      b.updatedAt = this.now();
      b.notes.push({ role: actor.role as 'MERCHANT' | 'ADMIN', text: d.note, at: this.now() });
      ensure(
        b.notes.length <= 100,
        'HISTORY_LIMIT',
        'Start a new batch after reviewing this history.',
        429,
      );
      await tx.put('settlementBatches', b);
      await this.logBatch(tx, actor, b, d.action);
      await this.remember(tx, retry, 'settlementHistory', `${b.id}:${b.version}`);
      return b;
    });
  }
}
