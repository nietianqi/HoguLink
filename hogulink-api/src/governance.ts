import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  canAdmin,
  type Actor,
  type Booking,
  type CaseDecision,
  type CaseDecisionDetail,
  type DecisionState,
  type OrderAlert,
  type OrderMonitor,
  type RefundRequest,
  type SafetyEvent,
  type SupportTicket,
  type TicketHandling,
  type TicketMessage,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import type { CareService } from './care.js';
import { adminCaseVisible, currentAdmin, requireAdmin } from './admin-access.js';
import { ensure } from './errors.js';
import { lateInstant } from './fulfillment.js';
import { syncTicketHandling } from './ticket-handling.js';
const minute = 60000,
  hour = 60 * minute;
export const monitorRules = {
  responseLeadMinutes: 5,
  scheduledDelayMinutes: 15,
  serviceOverrunMinutes: 30,
  refundHours: 24,
};
const ended = (b: Booking) => ['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(b.status);
const active = (t: SupportTicket) => !['RESOLVED', 'CLOSED'].includes(t.status);
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function bookingAlertActive(kind: OrderAlert['kind'], b: Booking, now: number) {
  const active = !ended(b);
  const rules: Partial<Record<OrderAlert['kind'], boolean>> = {
    RESPONSE_DUE:
      active &&
      (b.status === 'REQUESTED' || b.staffTaskStatus === 'OFFERED') &&
      b.deadline - now <= monitorRules.responseLeadMinutes * minute,
    ASSIGNMENT_BLOCKED:
      active &&
      (['DECLINED', 'WITHDRAWN'].includes(b.staffTaskStatus) ||
        (b.status === 'CONFIRMED' &&
          b.staffTaskStatus === 'NOT_SENT' &&
          b.replacementConsent !== 'PENDING')),
    CONSENT_DUE:
      active &&
      b.replacementConsent === 'PENDING' &&
      (b.replacementDeadline ?? b.deadline) - now <= 5 * minute,
    LATE_ARRIVAL:
      active &&
      (lateInstant(b, now) ||
        (b.quote.bookingMode === 'SCHEDULED' &&
          !b.arrivedAt &&
          ['CONFIRMED', 'EN_ROUTE'].includes(b.status) &&
          now >= b.quote.startAt + monitorRules.scheduledDelayMinutes * minute)),
    SERVICE_OVERRUN:
      active &&
      b.status === 'IN_SERVICE' &&
      now >=
        (b.startedAt ?? b.quote.startAt) +
          (b.quote.endAt - b.quote.startAt) +
          monitorRules.serviceOverrunMinutes * minute,
    NO_SHOW_REVIEW: active && b.noShow?.status === 'REPORTED',
    COMPLETION_REVIEW:
      active &&
      b.status === 'AWAITING_COMPLETION' &&
      !!b.completion &&
      b.completion.status !== 'PENDING',
    PAYMENT_REVIEW: ['FAILED', 'REFUND_PENDING'].includes(b.paymentStatus),
  };
  return rules[kind] === true;
}
export async function decisionDetail(
  tx: Records,
  ticket: SupportTicket,
): Promise<CaseDecisionDetail> {
  const history = (await tx.list<CaseDecision>('caseDecisions'))
    .filter((x) => x.ticketId === ticket.id)
    .sort((a, b) => b.version - a.version);
  const current = history[0] ?? null;
  const b = ticket.bookingId ? await tx.get<Booking>('bookings', ticket.bookingId) : undefined;
  const r = ticket.refundRequestId
    ? await tx.get<RefundRequest>('refundRequests', ticket.refundRequestId)
    : undefined;
  const receipt = current
    ? await tx.get<{ id: string; text: string; at: number }>('decisionReceipts', current.id)
    : undefined;
  const reopens = (await tx.list<TicketMessage>('ticketMessages')).filter(
    (m) => m.ticketId === ticket.id && m.kind === 'REOPEN',
  ).length;
  let state: DecisionState | null = null;
  if (current) {
    if (reopens > (current.reopenCount ?? 0)) state = 'NEEDS_REVIEW';
    else if (current.outcome === 'FOLLOW_UP')
      state = r?.status === 'PENDING' || !receipt ? 'AWAITING_SHOP' : 'READY_TO_CLOSE';
    else if (!r || r.id !== current.refundRequestId) state = 'NEEDS_REVIEW';
    else if (r.status === 'PENDING')
      state =
        current.outcome === 'REFUND' &&
        (!b ||
          b.refundedAmount !== current.refundedBefore ||
          b.capturedAmount - b.refundedAmount < current.amount)
          ? 'NEEDS_REVIEW'
          : 'AWAITING_SHOP';
    else if (current.outcome === 'REFUND')
      state =
        ['APPROVED', 'PARTIALLY_APPROVED'].includes(r.status) &&
        (r.approvedAmount ?? 0) === current.amount
          ? 'READY_TO_CLOSE'
          : 'NEEDS_REVIEW';
    else state = r.status === 'REJECTED' ? 'READY_TO_CLOSE' : 'NEEDS_REVIEW';
  }
  return {
    current,
    history,
    state,
    bookingVersion: b?.version ?? 0,
    refundVersion: r?.version ?? 0,
    remaining: b ? b.capturedAmount - b.refundedAmount : 0,
    receipt: receipt ? { text: receipt.text, at: receipt.at } : null,
  };
}
export async function assertDecisionClosable(tx: Records, ticket: SupportTicket) {
  const d = await decisionDetail(tx, ticket);
  ensure(
    !d.current || d.state === 'READY_TO_CLOSE',
    'DECISION_UNVERIFIED',
    'Verify the shop outcome or revise the platform decision before resolving this case.',
    409,
  );
}
const publishInput = z
  .object({
    ticketVersion: z.number().int().positive(),
    version: z.number().int().nonnegative(),
    bookingVersion: z.number().int().positive(),
    refundVersion: z.number().int().nonnegative(),
    outcome: z.enum(['REFUND', 'NO_REFUND', 'FOLLOW_UP']),
    amount: z.number().int().nonnegative(),
    summary: z.string().trim().min(20).max(2000),
    reason: z.string().trim().min(20).max(2000),
    evidenceIds: z.array(z.string().min(1)).max(30),
    merchantUnreachable: z.boolean(),
  })
  .strict();
const watchInput = z
  .object({
    version: z.number().int().positive(),
    action: z.enum(['WATCH', 'RELEASE']),
    followUpAt: z.number().int().positive(),
    note: z.string().trim().min(10).max(1000),
  })
  .strict();
export class GovernanceService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
    private care: CareService,
  ) {}
  async detail(actor: Actor, id: string) {
    ensure(actor.role !== 'STAFF', 'FORBIDDEN', 'This role cannot read financial decisions.', 403);
    return this.run(async (tx) => decisionDetail(tx, await this.care.refundTicket(tx, actor, id)));
  }
  async publish(actor: Actor, id: string, input: unknown, key: string) {
    const d = publishInput.parse(input);
    ensure(
      key.length >= 8 && key.length <= 160,
      'IDEMPOTENCY_REQUIRED',
      'A retry key is required.',
    );
    return this.run(async (tx) => {
      actor = await currentAdmin(tx, actor);
      requireAdmin(actor, 'cases.write');
      const ticket = await this.care.refundTicket(tx, actor, id);
      if (!canAdmin(actor, 'cases.assign'))
        ensure(
          (await tx.get<TicketHandling>('ticketHandling', id))?.ownerId === actor.id,
          'OWNER_REQUIRED',
          'Claim this case first.',
          409,
        );
      const idem = hash([actor.id, 'case-decision', key]),
        fingerprint = hash([id, d]);
      const prior = await tx.get<{ id: string; hash: string; decisionId: string }>(
        'decisionIdempotency',
        idem,
      );
      if (prior) {
        ensure(
          prior.hash === fingerprint,
          'IDEMPOTENCY_CONFLICT',
          'This key was used for another decision.',
          409,
        );
        return (await tx.get<CaseDecision>('caseDecisions', prior.decisionId))!;
      }
      ensure(
        ticket.status === 'PLATFORM_ESCALATED' &&
          ticket.visibility === 'SHOP_AND_CUSTOMER' &&
          ticket.bookingId,
        'INVALID_STATE',
        'Escalate a shared order case before publishing a decision.',
        409,
      );
      const current = await decisionDetail(tx, ticket),
        b = (await tx.get<Booking>('bookings', ticket.bookingId))!;
      ensure(
        ticket.version === d.ticketVersion &&
          (current.current?.version ?? 0) === d.version &&
          b.version === d.bookingVersion &&
          current.refundVersion === d.refundVersion,
        'VERSION_CONFLICT',
        'Refresh the case and order before publishing.',
        409,
      );
      const messages = (await tx.list<TicketMessage>('ticketMessages')).filter(
        (x) => x.ticketId === id && ['MESSAGE', 'REOPEN'].includes(x.kind),
      );
      ensure(
        new Set(d.evidenceIds).size === d.evidenceIds.length &&
          d.evidenceIds.every((ref) => messages.some((m) => m.id === ref)),
        'INVALID_EVIDENCE',
        'Choose statements from this case.',
        422,
      );
      const merchant = messages.filter((m) => m.role === 'MERCHANT' && m.kind === 'MESSAGE');
      const latestReopen = messages
        .filter((m) => m.kind === 'REOPEN')
        .sort(
          (a, b) =>
            (b.ticketVersion ?? 0) - (a.ticketVersion ?? 0) ||
            b.createdAt - a.createdAt ||
            b.id.localeCompare(a.id),
        )[0];
      ensure(
        !latestReopen || d.evidenceIds.includes(latestReopen.id),
        'APPEAL_EVIDENCE_REQUIRED',
        'Include the latest customer reopening statement in the revised review.',
        409,
      );
      ensure(
        d.merchantUnreachable
          ? merchant.length === 0 && this.now() >= ticket.createdAt + 24 * hour
          : merchant.some((m) => d.evidenceIds.includes(m.id)),
        'EVIDENCE_REQUIRED',
        'Include the shop statement, or document its absence after 24 hours.',
        409,
      );
      const r = ticket.refundRequestId
        ? await tx.get<RefundRequest>('refundRequests', ticket.refundRequestId)
        : undefined;
      if (d.outcome !== 'FOLLOW_UP') {
        ensure(
          r && r.status === 'PENDING',
          'REFUND_UNAVAILABLE',
          'A pending customer refund request is required.',
          409,
        );
        ensure(
          d.outcome === 'REFUND'
            ? d.amount > 0 && d.amount <= r.amount && d.amount <= current.remaining
            : d.amount === 0,
          'REFUND_BALANCE_CHANGED',
          'Review the requested amount and current remaining balance.',
          409,
        );
      } else
        ensure(d.amount === 0, 'INVALID_AMOUNT', 'Follow-up decisions cannot move funds.', 422);
      ensure(
        current.history.length < 50,
        'DECISION_LIMIT',
        'The decision history limit has been reached.',
        429,
      );
      const reopenCount = (await tx.list<TicketMessage>('ticketMessages')).filter(
        (m) => m.ticketId === id && m.kind === 'REOPEN',
      ).length;
      const result: CaseDecision = {
        ...d,
        id: `decision_${randomUUID()}`,
        ticketId: id,
        version: d.version + 1,
        refundRequestId: r?.id,
        createdAt: this.now(),
        reopenCount,
        refundedBefore: b.refundedAmount,
      };
      await tx.put('caseDecisions', result);
      ticket.version++;
      ticket.updatedAt = this.now();
      await tx.put('supportTickets', ticket);
      await syncTicketHandling(tx, ticket, actor, 'MESSAGE', this.now());
      await this.event(tx, actor, 'PLATFORM_DECISION_PUBLISHED', result.id, ticket.bookingId, id);
      await tx.put('decisionIdempotency', { id: idem, hash: fingerprint, decisionId: result.id });
      return result;
    });
  }
  async acknowledge(actor: Actor, id: string, input: unknown, key: string) {
    ensure(
      actor.role === 'MERCHANT',
      'FORBIDDEN',
      'Only the original shop can confirm its follow-up.',
      403,
    );
    const d = z
      .object({
        version: z.number().int().positive(),
        ticketVersion: z.number().int().positive(),
        text: z.string().trim().min(10).max(1000),
      })
      .strict()
      .parse(input);
    ensure(
      key.length >= 8 && key.length <= 160,
      'IDEMPOTENCY_REQUIRED',
      'A retry key is required.',
    );
    return this.run(async (tx) => {
      const ticket = await this.care.refundTicket(tx, actor, id),
        detail = await decisionDetail(tx, ticket),
        c = detail.current;
      const idem = hash([actor.id, 'decision-receipt', key]),
        fingerprint = hash([id, d]),
        prior = await tx.get<{ id: string; hash: string; decisionId: string }>(
          'decisionIdempotency',
          idem,
        );
      if (prior) {
        ensure(
          prior.hash === fingerprint,
          'IDEMPOTENCY_CONFLICT',
          'This key was used for another acknowledgment.',
          409,
        );
        return (await tx.get('decisionReceipts', prior.decisionId))!;
      }
      ensure(
        c && c.version === d.version && ticket.version === d.ticketVersion,
        'VERSION_CONFLICT',
        'Refresh this case.',
        409,
      );
      ensure(
        ticket.status === 'PLATFORM_ESCALATED' && c.outcome === 'FOLLOW_UP' && !detail.receipt,
        'INVALID_STATE',
        'Only an unconfirmed follow-up decision can be acknowledged.',
        409,
      );
      ensure(
        detail.state !== 'NEEDS_REVIEW',
        'DECISION_UNVERIFIED',
        'Review the customer dispute first.',
        409,
      );
      const receipt = { id: c.id, text: d.text, at: this.now() };
      await tx.put('decisionReceipts', receipt);
      await tx.put<TicketMessage>('ticketMessages', {
        id: `case_message_${randomUUID()}`,
        ticketId: id,
        role: 'MERCHANT',
        actorId: actor.id,
        text: d.text,
        kind: 'MESSAGE',
        createdAt: this.now(),
      });
      ticket.version++;
      ticket.updatedAt = this.now();
      await tx.put('supportTickets', ticket);
      await syncTicketHandling(tx, ticket, actor, 'MESSAGE', this.now());
      await tx.put('decisionIdempotency', { id: idem, hash: fingerprint, decisionId: c.id });
      await this.event(tx, actor, 'PLATFORM_DECISION_ACKNOWLEDGED', c.id, ticket.bookingId, id);
      return receipt;
    });
  }
  private async event(
    tx: Records,
    actor: Actor,
    action: string,
    target: string,
    bookingId?: string,
    ticketId?: string,
  ) {
    await tx.put('audit', {
      id: `audit_${randomUUID()}`,
      actorId: actor.id,
      action,
      detail: target,
      bookingId,
      at: this.now(),
    });
    await tx.put('outbox', {
      id: `outbox_${randomUUID()}`,
      type: action,
      target,
      bookingId,
      ticketId,
      createdAt: this.now(),
      status: 'PENDING',
      delivery: 'DEMO_LOCAL_ONLY',
    });
  }
  private async reconcile(tx: Records) {
    const now = this.now(),
      candidates: Omit<
        OrderAlert,
        'version' | 'generation' | 'state' | 'firstSeenAt' | 'lastSeenAt'
      >[] = [];
    const add = (
      kind: OrderAlert['kind'],
      sourceId: string,
      sourceVersion: string,
      dueAt: number,
      severity: OrderAlert['severity'],
      bookingId?: string,
      storeId?: string,
      ticketId?: string,
    ) =>
      candidates.push({
        id: `alert_${hash([kind, sourceId]).slice(0, 32)}`,
        kind,
        sourceId,
        sourceVersion,
        dueAt,
        severity,
        bookingId,
        storeId,
        ticketId,
      });
    const bookings = await tx.list<Booking>('bookings');
    for (const b of bookings) {
      if (!ended(b)) {
        if (bookingAlertActive('RESPONSE_DUE', b, now))
          add('RESPONSE_DUE', b.id, String(b.version), b.deadline, 'NORMAL', b.id, b.storeId);
        if (bookingAlertActive('ASSIGNMENT_BLOCKED', b, now))
          add('ASSIGNMENT_BLOCKED', b.id, String(b.version), b.updatedAt, 'HIGH', b.id, b.storeId);
        if (bookingAlertActive('CONSENT_DUE', b, now))
          add(
            'CONSENT_DUE',
            b.id,
            String(b.version),
            b.replacementDeadline ?? b.deadline,
            'HIGH',
            b.id,
            b.storeId,
          );
        if (bookingAlertActive('LATE_ARRIVAL', b, now))
          add(
            'LATE_ARRIVAL',
            b.id,
            String(b.version),
            b.quote.bookingMode === 'INSTANT'
              ? b.arrival!.promisedAt +
                  (b.quote.cancellationPolicy.instantDelayGraceMinutes ?? 15) * minute
              : b.quote.startAt + 15 * minute,
            'HIGH',
            b.id,
            b.storeId,
          );
        if (bookingAlertActive('SERVICE_OVERRUN', b, now))
          add(
            'SERVICE_OVERRUN',
            b.id,
            String(b.version),
            (b.startedAt ?? b.quote.startAt) + (b.quote.endAt - b.quote.startAt) + 30 * minute,
            'NORMAL',
            b.id,
            b.storeId,
          );
        if (bookingAlertActive('NO_SHOW_REVIEW', b, now))
          add(
            'NO_SHOW_REVIEW',
            b.id,
            String(b.version),
            b.noShow?.reportedAt ?? b.updatedAt,
            'HIGH',
            b.id,
            b.storeId,
          );
      }
      if (bookingAlertActive('PAYMENT_REVIEW', b, now))
        add('PAYMENT_REVIEW', b.id, String(b.version), b.updatedAt, 'HIGH', b.id, b.storeId);
      if (bookingAlertActive('COMPLETION_REVIEW', b, now))
        add(
          'COMPLETION_REVIEW',
          b.id,
          String(b.version),
          b.completion!.confirmBy,
          'HIGH',
          b.id,
          b.storeId,
          b.completion!.ticketId,
        );
    }
    for (const s of await tx.list<SafetyEvent>('safetyEvents'))
      if (s.status === 'OPEN')
        add(
          'SAFETY_OPEN',
          s.id,
          String(s.version ?? 1),
          s.createdAt,
          'HIGH',
          s.bookingId,
          s.storeId,
        );
    for (const t of await tx.list<SupportTicket>('supportTickets')) {
      if (!active(t)) continue;
      const h = await tx.get<TicketHandling>('ticketHandling', t.id),
        ver = `${t.version}:${h?.version ?? 0}`;
      if (now >= t.dueAt)
        add(
          'CASE_OVERDUE',
          t.id,
          ver,
          t.dueAt,
          t.priority === 'HIGH' ? 'HIGH' : 'NORMAL',
          t.bookingId,
          t.storeId,
          t.id,
        );
      if (h && h.state !== 'DONE' && now >= h.followUpAt)
        add('FOLLOW_UP_DUE', t.id, ver, h.followUpAt, 'NORMAL', t.bookingId, t.storeId, t.id);
      const r = t.refundRequestId
        ? await tx.get<RefundRequest>('refundRequests', t.refundRequestId)
        : undefined;
      if (r?.status === 'PENDING' && now >= r.createdAt + monitorRules.refundHours * hour)
        add(
          'REFUND_OVERDUE',
          r.id,
          `${t.version}:${r.version}`,
          r.createdAt + 24 * hour,
          'HIGH',
          t.bookingId,
          t.storeId,
          t.id,
        );
      const d = await decisionDetail(tx, t);
      if (d.state === 'NEEDS_REVIEW')
        add(
          'DECISION_REVIEW',
          t.id,
          `${t.version}:${d.current!.version}:${d.refundVersion}`,
          t.updatedAt,
          'HIGH',
          t.bookingId,
          t.storeId,
          t.id,
        );
    }
    const old = await tx.list<OrderAlert>('orderAlerts'),
      ids = new Set(candidates.map((c) => c.id));
    for (const c of candidates) {
      const previous = old.find((x) => x.id === c.id),
        recurrence = previous?.state === 'RESOLVED';
      const next: OrderAlert =
        !previous || recurrence
          ? {
              ...c,
              version: (previous?.version ?? 0) + 1,
              generation: (previous?.generation ?? 0) + 1,
              state: 'OPEN',
              firstSeenAt: now,
              lastSeenAt: now,
            }
          : {
              ...previous,
              ...c,
              version: previous.version + Number(previous.sourceVersion !== c.sourceVersion),
              lastSeenAt: now,
            };
      await tx.put('orderAlerts', next);
      if (!previous || recurrence)
        await this.event(
          tx,
          { id: 'system', role: 'ADMIN', verificationLevel: 3 },
          'ORDER_ALERT_OPENED',
          next.id,
          next.bookingId,
          next.ticketId,
        );
    }
    for (const a of old)
      if (a.state !== 'RESOLVED' && !ids.has(a.id)) {
        a.state = 'RESOLVED';
        a.version++;
        a.resolvedAt = now;
        await tx.put('orderAlerts', a);
        await this.event(
          tx,
          { id: 'system', role: 'ADMIN', verificationLevel: 3 },
          'ORDER_ALERT_RECOVERED',
          a.id,
          a.bookingId,
          a.ticketId,
        );
      }
  }
  private async visible(tx: Records, actor: Actor, a: OrderAlert) {
    if (a.kind === 'SAFETY_OPEN' && !canAdmin(actor, 'safety.write')) return false;
    if (a.ticketId) {
      const t = await tx.get<SupportTicket>('supportTickets', a.ticketId);
      return !!t && (await adminCaseVisible(tx, actor, t));
    }
    return true;
  }
  async monitor(actor: Actor): Promise<OrderMonitor> {
    return this.run(async (tx) => {
      actor = await currentAdmin(tx, actor);
      requireAdmin(actor, 'orders.read');
      await this.reconcile(tx);
      const alerts: OrderAlert[] = [];
      for (const a of await tx.list<OrderAlert>('orderAlerts'))
        if (await this.visible(tx, actor, a))
          alerts.push(
            canAdmin(actor, 'cases.write') ? a : { ...a, note: undefined, ownerId: undefined },
          );
      alerts.sort(
        (a, b) =>
          Number(a.state === 'RESOLVED') - Number(b.state === 'RESOLVED') ||
          Number(b.severity === 'HIGH') - Number(a.severity === 'HIGH') ||
          a.dueAt - b.dueAt ||
          a.id.localeCompare(b.id),
      );
      return { now: this.now(), alerts, rules: monitorRules };
    });
  }
  async watch(actor: Actor, id: string, input: unknown) {
    const d = watchInput.parse(input);
    return this.run(async (tx) => {
      actor = await currentAdmin(tx, actor);
      requireAdmin(actor, 'orders.read');
      requireAdmin(actor, 'cases.write');
      await this.reconcile(tx);
      const a = await tx.get<OrderAlert>('orderAlerts', id);
      ensure(a && (await this.visible(tx, actor, a)), 'NOT_FOUND', 'Alert not found.', 404);
      if (a.kind === 'SAFETY_OPEN') requireAdmin(actor, 'safety.write');
      ensure(
        a.version === d.version,
        'VERSION_CONFLICT',
        'The underlying order or case changed. Refresh.',
        409,
      );
      ensure(a.state !== 'RESOLVED', 'INVALID_STATE', 'This condition has already recovered.', 409);
      ensure(
        !a.ownerId || a.ownerId === actor.id || canAdmin(actor, 'cases.assign'),
        'FORBIDDEN',
        'This alert is being followed by another employee.',
        403,
      );
      ensure(
        d.action === 'RELEASE' ||
          (d.followUpAt > this.now() && d.followUpAt <= this.now() + 24 * hour),
        'INVALID_FOLLOW_UP',
        'Choose a follow-up within 24 hours.',
        409,
      );
      a.state = d.action === 'WATCH' ? 'WATCHING' : 'OPEN';
      a.ownerId = d.action === 'WATCH' ? actor.id : undefined;
      a.followUpAt = d.action === 'WATCH' ? d.followUpAt : undefined;
      a.note = d.note;
      a.version++;
      await tx.put('orderAlerts', a);
      await tx.put('orderAlertHistory', {
        ...a,
        id: `alert_event_${randomUUID()}`,
        alertId: a.id,
        actorId: actor.id,
        at: this.now(),
      });
      await this.event(tx, actor, 'ORDER_ALERT_FOLLOW_UP', a.id, a.bookingId, a.ticketId);
      return a;
    });
  }
}
