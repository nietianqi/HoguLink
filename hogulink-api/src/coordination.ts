import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  Actor,
  Audit,
  Booking,
  Coordination,
  HandoffView,
  Listing,
  RefundRequest,
  StaffHandoffItem,
  SupportTicket,
  WorkHandoff,
  OrderAlert,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { activeStaffMembership, staffBookingAccess } from './staff-access.js';
import { ensure } from './errors.js';
import { bookingAlertActive } from './governance.js';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const text = z.string().trim().min(10).max(1500);
const createInput = z
  .object({
    bookingVersion: z.number().int().positive(),
    topic: z.enum(['VISIT_NOTE', 'SERVICE_ISSUE', 'AFTERCARE_FACTS']),
    text,
    ticketId: z.string().max(100).optional(),
  })
  .strict();
const actionInput = z
  .object({
    version: z.number().int().positive(),
    action: z.enum(['REPLY', 'RESOLVE', 'REOPEN']),
    text,
  })
  .strict();
const publicActions = new Set([
  'BOOKING_CREATED',
  'MERCHANT_ACCEPTED',
  'STAFF_ASSIGNED',
  'REPLACEMENT_PROPOSED',
  'REPLACEMENT_WITHDRAWN',
  'REPLACEMENT_APPROVED',
  'REPLACEMENT_DECLINED',
  'STAFF_ACKNOWLEDGED',
  'STAFF_UNAVAILABLE',
  'STAFF_EN_ROUTE',
  'STAFF_ARRIVED',
  'STAFF_START',
  'STAFF_COMPLETE',
  'COMPLETION_CONFIRM',
  'COMPLETION_DISPUTE',
  'COMPLETION_EXCEPTION',
  'COMPLETION_REVIEW',
  'COMPLETION_VOID',
  'COMPLETION_REAUTHORIZE',
  'COMPLETION_TIMED_OUT',
  'COMPLETION_PAYMENT_REVIEW',
  'BOOKING_CANCELLED',
  'BOOKING_EXPIRED',
  'DEMO_REFUND_SUCCEEDED',
  'ARRIVAL_DELAY_REPORTED',
]);
const view = ({
  storeId: _s,
  staffId: _u,
  listingId: _l,
  ticketId: _t,
  ...h
}: WorkHandoff): HandoffView => h;
export class CoordinationService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
  ) {}
  private async booking(tx: Records, actor: Actor, id: string) {
    const b = await tx.get<Booking>('bookings', id);
    ensure(
      b &&
        ((actor.role === 'CUSTOMER' && b.customerId === actor.id) ||
          (actor.role === 'MERCHANT' && b.storeId === actor.storeId) ||
          (await staffBookingAccess(tx, actor, b))),
      'NOT_FOUND',
      'Order not found.',
      404,
    );
    return b;
  }
  private async visible(tx: Records, actor: Actor, h: WorkHandoff) {
    return (
      (actor.role === 'MERCHANT' && actor.storeId === h.storeId) ||
      (actor.role === 'STAFF' &&
        actor.staffId === h.staffId &&
        (await activeStaffMembership(tx, actor, h.storeId, h.listingId)))
    );
  }
  async detail(actor: Actor, id: string): Promise<Coordination> {
    return this.run(async (tx) => {
      const b = await this.booking(tx, actor, id),
        handoffs: HandoffView[] = [];
      if (actor.role !== 'CUSTOMER')
        for (const h of await tx.list<WorkHandoff>('workHandoffs'))
          if (h.bookingId === id && (await this.visible(tx, actor, h))) handoffs.push(view(h));
      const cases: Coordination['cases'] = [];
      if (actor.role === 'MERCHANT')
        for (const t of await tx.list<SupportTicket>('supportTickets'))
          if (
            t.bookingId === id &&
            t.storeId === actor.storeId &&
            t.visibility === 'SHOP_AND_CUSTOMER'
          )
            cases.push({
              id: t.id,
              subject: t.subject,
              status: t.status,
              refundPending:
                !!t.refundRequestId &&
                (await tx.get<RefundRequest>('refundRequests', t.refundRequestId))?.status ===
                  'PENDING',
            });
      const listing =
        b.assignedListingId && (await tx.get<Listing>('listings', b.assignedListingId));
      const allowed =
        actor.role === 'CUSTOMER'
          ? ['LATE_ARRIVAL']
          : [
              'RESPONSE_DUE',
              'ASSIGNMENT_BLOCKED',
              'CONSENT_DUE',
              'LATE_ARRIVAL',
              'SERVICE_OVERRUN',
              'NO_SHOW_REVIEW',
            ];
      const platformAttention = (await tx.list<OrderAlert>('orderAlerts'))
        .filter(
          (a) =>
            a.bookingId === id &&
            a.state === 'WATCHING' &&
            !a.ticketId &&
            allowed.includes(a.kind) &&
            bookingAlertActive(a.kind, b, this.now()),
        )
        .map(({ kind, firstSeenAt }) => ({ kind, firstSeenAt }));
      return {
        bookingId: id,
        bookingVersion: b.version,
        now: this.now(),
        platformAttention,
        timeline: (await tx.list<Audit>('audit'))
          .filter(
            (a) =>
              a.bookingId === id &&
              publicActions.has(a.action) &&
              (actor.role !== 'STAFF' || a.action !== 'DEMO_REFUND_SUCCEEDED'),
          )
          .sort(
            (a, b) =>
              a.at - b.at ||
              (a.bookingVersion ?? 0) - (b.bookingVersion ?? 0) ||
              a.id.localeCompare(b.id),
          )
          .slice(-60)
          .map(({ id, action, at }) => ({ id, action, at })),
        handoffs: handoffs.sort((a, b) => b.updatedAt - a.updatedAt),
        cases,
        staffName: listing ? listing.name : undefined,
        proposedName: b.proposedListingId
          ? (await tx.get<Listing>('listings', b.proposedListingId))?.name
          : undefined,
      };
    });
  }
  async inbox(actor: Actor): Promise<StaffHandoffItem[]> {
    ensure(actor.role === 'STAFF', 'FORBIDDEN', 'Staff account required.', 403);
    return this.run(async (tx) => {
      const items: StaffHandoffItem[] = [];
      for (const h of await tx.list<WorkHandoff>('workHandoffs'))
        if (await this.visible(tx, actor, h)) {
          const b = await tx.get<Booking>('bookings', h.bookingId);
          if (b) items.push({ ...view(h), startAt: b.quote.startAt, bookingStatus: b.status });
        }
      return items
        .sort(
          (a, b) =>
            Number(a.status === 'RESOLVED') - Number(b.status === 'RESOLVED') ||
            b.updatedAt - a.updatedAt,
        )
        .slice(0, 100);
    });
  }
  private async log(tx: Records, actor: Actor, h: WorkHandoff, action: string) {
    await tx.put('audit', {
      id: randomUUID(),
      actorId: actor.id,
      bookingId: h.bookingId,
      action,
      detail: h.id,
      at: this.now(),
    });
    await tx.put('outbox', {
      id: randomUUID(),
      type: action,
      target: h.id,
      bookingId: h.bookingId,
      createdAt: this.now(),
      status: 'PENDING',
      delivery: 'DEMO_LOCAL_ONLY',
    });
  }
  async create(actor: Actor, id: string, input: unknown, key: string) {
    ensure(
      ['STAFF', 'MERCHANT'].includes(actor.role),
      'FORBIDDEN',
      'Shop or staff account required.',
      403,
    );
    const d = createInput.parse(input);
    ensure(
      key.length >= 8 && key.length <= 160,
      'IDEMPOTENCY_REQUIRED',
      'A retry key is required.',
    );
    return this.run(async (tx) => {
      const b = await this.booking(tx, actor, id),
        idem = hash([actor.id, 'handoff', key]),
        fingerprint = hash([id, d]);
      const previous = await tx.get<{ id: string; hash: string; handoffId: string }>(
        'handoffRetries',
        idem,
      );
      if (previous) {
        ensure(previous.hash === fingerprint, 'IDEMPOTENCY_CONFLICT', 'Retry input changed.', 409);
        const h = await tx.get<WorkHandoff>('workHandoffs', previous.handoffId);
        ensure(h && (await this.visible(tx, actor, h)), 'NOT_FOUND', 'Handoff not found.', 404);
        return view(h);
      }
      ensure(
        b.version === d.bookingVersion,
        'VERSION_CONFLICT',
        'Refresh the order before requesting cooperation.',
        409,
      );
      ensure(
        b.assignedStaffId && b.assignedListingId && b.staffTaskStatus !== 'NOT_SENT',
        'INVALID_STATE',
        'Assign a therapist first.',
        409,
      );
      ensure(
        await activeStaffMembership(
          tx,
          { ...actor, role: 'STAFF', staffId: b.assignedStaffId, storeId: b.storeId },
          b.storeId,
          b.assignedListingId,
        ),
        'INVALID_STATE',
        'The assigned therapist is no longer a member of this shop.',
        409,
      );
      ensure(
        (actor.role === 'MERCHANT' && d.topic === 'AFTERCARE_FACTS') ||
          (actor.role === 'STAFF' &&
            d.topic !== 'AFTERCARE_FACTS' &&
            !['CANCELLED', 'REJECTED', 'EXPIRED'].includes(b.status)),
        'INVALID_STATE',
        'This topic is not available to this role or order.',
        409,
      );
      if (d.ticketId) {
        const t = await tx.get<SupportTicket>('supportTickets', d.ticketId);
        ensure(
          actor.role === 'MERCHANT' &&
            t?.bookingId === id &&
            t.storeId === actor.storeId &&
            t.visibility === 'SHOP_AND_CUSTOMER',
          'NOT_FOUND',
          'Related case not found.',
          404,
        );
      }
      ensure(
        (await tx.list<WorkHandoff>('workHandoffs')).filter(
          (h) => h.bookingId === id && h.status !== 'RESOLVED',
        ).length < 10,
        'HANDOFF_LIMIT',
        'Resolve an existing handoff first.',
        429,
      );
      ensure(
        (await tx.list<WorkHandoff>('workHandoffs')).filter(
          (h) =>
            h.storeId === b.storeId && h.staffId === b.assignedStaffId && h.status !== 'RESOLVED',
        ).length < 100,
        'HANDOFF_LIMIT',
        'This therapist has too many open cooperation records. Resolve existing records first.',
        429,
      );
      const h: WorkHandoff = {
        id: `handoff_${randomUUID()}`,
        bookingId: id,
        storeId: b.storeId,
        staffId: b.assignedStaffId,
        listingId: b.assignedListingId,
        topic: d.topic,
        status: actor.role === 'MERCHANT' ? 'WAITING_STAFF' : 'WAITING_SHOP',
        version: 1,
        createdAt: this.now(),
        updatedAt: this.now(),
        ticketId: d.ticketId,
        messages: [{ role: actor.role as 'STAFF' | 'MERCHANT', text: d.text, at: this.now() }],
      };
      await tx.put('workHandoffs', h);
      await tx.put('handoffRetries', { id: idem, hash: fingerprint, handoffId: h.id });
      await this.log(tx, actor, h, 'WORK_HANDOFF_CREATED');
      return view(h);
    });
  }
  async action(actor: Actor, id: string, input: unknown, key: string) {
    ensure(
      ['STAFF', 'MERCHANT'].includes(actor.role),
      'FORBIDDEN',
      'Shop or staff account required.',
      403,
    );
    const d = actionInput.parse(input);
    ensure(
      key.length >= 8 && key.length <= 160,
      'IDEMPOTENCY_REQUIRED',
      'A retry key is required.',
    );
    return this.run(async (tx) => {
      const h = await tx.get<WorkHandoff>('workHandoffs', id);
      ensure(h && (await this.visible(tx, actor, h)), 'NOT_FOUND', 'Handoff not found.', 404);
      const idem = hash([actor.id, 'handoff-action', key]),
        fingerprint = hash([id, d]),
        prior = await tx.get<{ id: string; hash: string }>('handoffRetries', idem);
      if (prior) {
        ensure(prior.hash === fingerprint, 'IDEMPOTENCY_CONFLICT', 'Retry input changed.', 409);
        return view(h);
      }
      ensure(
        h.version === d.version,
        'VERSION_CONFLICT',
        'This handoff changed. Refresh first.',
        409,
      );
      ensure(
        d.action === 'REPLY' || actor.role === 'MERCHANT',
        'FORBIDDEN',
        'Only the shop can resolve or reopen.',
        403,
      );
      ensure(
        d.action === 'REOPEN' ? h.status === 'RESOLVED' : h.status !== 'RESOLVED',
        'INVALID_STATE',
        'This handoff is no longer in that state.',
        409,
      );
      ensure(
        d.action === 'RESOLVE' || h.messages.length < 50,
        'HANDOFF_LIMIT',
        'Conversation limit reached. The shop can still resolve this handoff.',
        429,
      );
      if (d.action === 'REOPEN') {
        ensure(
          (await tx.list<WorkHandoff>('workHandoffs')).filter(
            (x) => x.bookingId === h.bookingId && x.status !== 'RESOLVED',
          ).length < 10,
          'HANDOFF_LIMIT',
          'Resolve an existing handoff first.',
          429,
        );
        ensure(
          (await tx.list<WorkHandoff>('workHandoffs')).filter(
            (x) => x.storeId === h.storeId && x.staffId === h.staffId && x.status !== 'RESOLVED',
          ).length < 100,
          'HANDOFF_LIMIT',
          'Resolve existing cooperation records first.',
          429,
        );
      }
      h.status =
        d.action === 'RESOLVE'
          ? 'RESOLVED'
          : d.action === 'REOPEN'
            ? 'WAITING_SHOP'
            : actor.role === 'STAFF'
              ? 'WAITING_SHOP'
              : 'WAITING_STAFF';
      h.version++;
      h.updatedAt = this.now();
      h.messages.push({ role: actor.role as 'STAFF' | 'MERCHANT', text: d.text, at: this.now() });
      await tx.put('workHandoffs', h);
      await tx.put('handoffRetries', { id: idem, hash: fingerprint });
      await this.log(tx, actor, h, `WORK_HANDOFF_${d.action}`);
      return view(h);
    });
  }
}
