import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  Actor,
  Booking,
  OrderCare,
  RefundCase,
  RefundRequest,
  RefundRequestView,
  SupportTicket,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { ensure } from './errors.js';
import type { CareService } from './care.js';
const terminal = new Set(['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED']);
const requestInput = z
  .object({
    bookingVersion: z.number().int().positive(),
    amount: z.number().int().positive(),
    reason: z.string().trim().min(10).max(1000),
    locale: z.enum(['ja', 'en', 'zh-cn']),
  })
  .strict();
const decisionInput = z
  .object({
    version: z.number().int().positive(),
    bookingVersion: z.number().int().positive(),
    action: z.enum(['APPROVE', 'REJECT', 'WITHDRAW']),
    amount: z.number().int().nonnegative(),
    text: z.string().trim().min(10).max(1000),
  })
  .strict();
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const view = ({ customerId: _c, storeId: _s, ...r }: RefundRequest): RefundRequestView => r;
export class RefundService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
    private care: CareService,
    private refund: (tx: Records, actor: Actor, b: Booking, amount: number) => Promise<Booking>,
  ) {}
  private async own(tx: Records, actor: Actor, id: string) {
    const b = await tx.get<Booking>('bookings', id);
    ensure(
      b &&
        ((actor.role === 'CUSTOMER' && actor.id === b.customerId) ||
          (actor.role === 'MERCHANT' && actor.storeId === b.storeId) ||
          actor.role === 'ADMIN'),
      'NOT_FOUND',
      'Booking not found.',
      404,
    );
    return b;
  }
  async overview(actor: Actor, id: string): Promise<OrderCare> {
    ensure(actor.role === 'CUSTOMER', 'FORBIDDEN', 'Customer account required.', 403);
    return this.run(async (tx) => {
      const b = await this.own(tx, actor, id),
        requests = (await tx.list<RefundRequest>('refundRequests'))
          .filter((r) => r.bookingId === b.id)
          .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
      return {
        bookingVersion: b.version,
        captured: b.capturedAmount,
        refunded: b.refundedAmount,
        remaining: b.capturedAmount - b.refundedAmount,
        canRequest:
          terminal.has(b.status) &&
          b.capturedAmount > b.refundedAmount &&
          !requests.some((r) => r.status === 'PENDING'),
        requests: requests.map(view),
        cases: (await tx.list<SupportTicket>('supportTickets'))
          .filter(
            (t) =>
              t.bookingId === b.id && t.reporterRole === 'CUSTOMER' && t.reporterId === actor.id,
          )
          .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
          .map(({ id, subject, status, updatedAt }) => ({ id, subject, status, updatedAt })),
      };
    });
  }
  async request(actor: Actor, id: string, input: unknown, key: string) {
    ensure(
      actor.role === 'CUSTOMER' && actor.verificationLevel >= 1,
      'FORBIDDEN',
      'Customer account required.',
      403,
    );
    const d = requestInput.parse(input);
    ensure(
      key.length >= 8 && key.length <= 160,
      'IDEMPOTENCY_REQUIRED',
      'A retry key is required.',
    );
    return this.run(async (tx) => {
      const b = await this.own(tx, actor, id),
        idem = hash([actor.id, 'refund-create', key]),
        fingerprint = hash([id, d]);
      const prior = await tx.get<{ id: string; hash: string; requestId: string }>(
        'refundIdempotency',
        idem,
      );
      if (prior) {
        ensure(
          prior.hash === fingerprint,
          'IDEMPOTENCY_CONFLICT',
          'This key was used for a different request.',
          409,
        );
        return view((await tx.get<RefundRequest>('refundRequests', prior.requestId))!);
      }
      ensure(b.version === d.bookingVersion, 'VERSION_CONFLICT', 'Refresh this booking.', 409);
      ensure(
        terminal.has(b.status) && d.amount <= b.capturedAmount - b.refundedAmount,
        'REFUND_UNAVAILABLE',
        'Only captured, unrefunded funds of an ended booking can be requested.',
        409,
      );
      ensure(
        !(await tx.list<RefundRequest>('refundRequests')).some(
          (r) => r.bookingId === id && r.status === 'PENDING',
        ),
        'REFUND_REQUEST_EXISTS',
        'Continue the existing refund case.',
        409,
      );
      const ticket = await this.care.createInTransaction(
        tx,
        actor,
        {
          bookingId: id,
          category: 'PRICE_OR_REFUND',
          subject: { ja: '返金のご相談', en: 'Refund request', 'zh-cn': '退款申请' }[d.locale],
          description: d.reason,
        },
        `refund:${hash([id, key])}`,
      );
      const r: RefundRequest = {
        id: `refund_${randomUUID()}`,
        ticketId: ticket.id,
        bookingId: id,
        customerId: actor.id,
        storeId: b.storeId,
        amount: d.amount,
        reason: d.reason,
        status: 'PENDING',
        version: 1,
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      ticket.refundRequestId = r.id;
      await tx.put('supportTickets', ticket);
      await tx.put('refundRequests', r);
      await tx.put('refundIdempotency', { id: idem, hash: fingerprint, requestId: r.id });
      return view(r);
    });
  }
  async forTicket(actor: Actor, id: string): Promise<RefundCase | null> {
    ensure(
      ['CUSTOMER', 'MERCHANT', 'ADMIN'].includes(actor.role),
      'FORBIDDEN',
      'This role cannot read refund requests.',
      403,
    );
    return this.run(async (tx) => {
      const ticket = await this.care.refundTicket(tx, actor, id);
      if (!ticket.refundRequestId) return null;
      const r = await tx.get<RefundRequest>('refundRequests', ticket.refundRequestId);
      ensure(r, 'NOT_FOUND', 'Refund request not found.', 404);
      const b = await this.own(tx, actor, r.bookingId);
      return {
        request: view(r),
        remaining: b.capturedAmount - b.refundedAmount,
        bookingVersion: b.version,
      };
    });
  }
  async decide(actor: Actor, id: string, input: unknown, key: string) {
    const d = decisionInput.parse(input);
    ensure(
      (d.action === 'WITHDRAW' && actor.role === 'CUSTOMER') ||
        (d.action !== 'WITHDRAW' && actor.role === 'MERCHANT'),
      'FORBIDDEN',
      'Only the shop can decide refunds; only the customer can withdraw.',
      403,
    );
    ensure(
      key.length >= 8 && key.length <= 160,
      'IDEMPOTENCY_REQUIRED',
      'A retry key is required.',
    );
    return this.run(async (tx) => {
      const r = await tx.get<RefundRequest>('refundRequests', id);
      ensure(r, 'NOT_FOUND', 'Request not found.', 404);
      const b = await this.own(tx, actor, r.bookingId),
        ticket = await this.care.refundTicket(tx, actor, r.ticketId),
        idem = hash([actor.id, 'refund-decision', key]),
        fingerprint = hash([id, d]);
      const prior = await tx.get<{ id: string; hash: string }>('refundDecisions', idem);
      if (prior) {
        ensure(
          prior.hash === fingerprint,
          'IDEMPOTENCY_CONFLICT',
          'This key was used for a different decision.',
          409,
        );
        return view(r);
      }
      ensure(
        r.status === 'PENDING' && !['RESOLVED', 'CLOSED'].includes(ticket.status),
        'INVALID_STATE',
        'This request is no longer pending.',
        409,
      );
      ensure(
        r.version === d.version && b.version === d.bookingVersion,
        'VERSION_CONFLICT',
        'Refresh the request and payment balance.',
        409,
      );
      if (d.action === 'APPROVE') {
        ensure(
          d.amount > 0 && d.amount <= r.amount && d.amount <= b.capturedAmount - b.refundedAmount,
          'REFUND_BALANCE_CHANGED',
          'The refund exceeds the request or remaining balance.',
          409,
        );
        await this.refund(tx, actor, b, d.amount);
        r.approvedAmount = d.amount;
        r.status = d.amount === r.amount ? 'APPROVED' : 'PARTIALLY_APPROVED';
      } else {
        ensure(d.amount === 0, 'INVALID_AMOUNT', 'Only approval has a refund amount.');
        r.status = d.action === 'WITHDRAW' ? 'WITHDRAWN' : 'REJECTED';
      }
      r.version++;
      r.updatedAt = this.now();
      r.decision = d.text;
      await tx.put('refundRequests', r);
      await this.care.refundOutcome(tx, actor, r.ticketId, d.text, d.action !== 'REJECT');
      await tx.put('refundDecisions', { id: idem, hash: fingerprint });
      return view(r);
    });
  }
}
