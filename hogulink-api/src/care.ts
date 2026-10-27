import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  customerBlockInput,
  customerRestrictionInput,
  supportTicketInput,
  ticketActionInput,
  type Actor,
  type Audit,
  type Booking,
  type CustomerBlock,
  type CustomerRestriction,
  type PublicRestriction,
  type SafetyEvent,
  type SupportTicket,
  type TicketMessage,
  type RefundRequest,
  safetyLocationInput,
  type EmergencyLocation,
  type Store,
  type TicketAttachment,
} from '@hogulink/contracts';
import sharp from 'sharp';
import { ensure } from './errors.js';
import { loadEvidence, saveEvidence } from './evidence-storage.js';
import { Repository, type Records } from './repository.js';
import { syncTicketHandling } from './ticket-handling.js';
import { adminCaseVisible, currentAdmin, requireAdmin } from './admin-access.js';
import { staffBookingAccess } from './staff-access.js';
import { canAdmin, type TicketHandling } from '@hogulink/contracts';
import { assertDecisionClosable, decisionDetail } from './governance.js';

const hour = 60 * 60_000;
const open = (ticket: SupportTicket) => !['RESOLVED', 'CLOSED'].includes(ticket.status);
const privateCategories = new Set([
  'MERCHANT_UNREACHABLE',
  'QUALIFICATION',
  'SAFETY',
  'PRIVACY',
  'FINANCIAL',
  'APPEAL',
]);
type StoredAttachment = {
  id: string;
  ticketId: string;
  uploaderId: string;
  role: Actor['role'];
  storageKey: string;
  size: number;
  createdAt: number;
};
export function safetyEventView(
  actor: Actor,
  event: SafetyEvent,
  emergencyContact?: string,
): SafetyEvent {
  if (actor.role === 'ADMIN') return { ...event, version: event.version ?? 1 };
  return {
    // The shared location helps only while help is on the way.
    ...(event.status === 'OPEN' && event.location ? { location: event.location } : {}),
    ...(actor.role === 'STAFF' && emergencyContact ? { emergencyContact } : {}),
    id: event.id,
    bookingId: event.bookingId,
    staffId: event.staffId,
    storeId: event.storeId,
    type: event.type,
    status: event.status,
    createdAt: event.createdAt,
    version: event.version ?? 1,
    resolvedAt: event.resolvedAt,
  };
}
export const careConfig = {
  merchantReplyHours: 24,
  platformReplyHours: 24,
  urgentReplyHours: 4,
  maxActiveTickets: 10,
  maxRestrictionDays: 30,
};

export function restrictionActive(restriction: CustomerRestriction | undefined, now: number) {
  return !!restriction && restriction.active !== false && restriction.expiresAt > now;
}
export async function assertCanBook(tx: Records, actor: Actor, storeId: string, now: number) {
  const restriction = await tx.get<CustomerRestriction>('restrictions', actor.id);
  const block = await tx.get<CustomerBlock>('blocks', `${storeId}:${actor.id}`);
  ensure(
    !restrictionActive(restriction, now) && !(block && block.active !== false),
    'CUSTOMER_RESTRICTED',
    'Booking is currently unavailable for this account.',
    403,
  );
}

export class CareService {
  constructor(
    private repo: Repository,
    private now = () => Date.now(),
  ) {}
  private role(actor: Actor, ...roles: Actor['role'][]) {
    ensure(
      roles.includes(actor.role),
      'FORBIDDEN',
      'This account cannot perform this action.',
      403,
    );
  }
  private version(actual: number, expected: number) {
    ensure(
      actual === expected,
      'VERSION_CONFLICT',
      'This record changed. Refresh before continuing.',
      409,
    );
  }
  private async event(
    tx: Records,
    actor: Actor,
    action: string,
    ticket?: SupportTicket,
    detail = '',
  ) {
    await tx.put<Audit>('audit', {
      id: `audit_${randomUUID()}`,
      actorId: actor.id,
      action,
      bookingId: ticket?.bookingId,
      detail: ticket ? `${ticket.id}${detail ? `:${detail}` : ''}` : detail,
      at: this.now(),
    });
    // Notification payloads carry references only. No private report text goes into a shared queue.
    await tx.put('outbox', {
      id: `outbox_${randomUUID()}`,
      type: action,
      ticketId: ticket?.id,
      bookingId: ticket?.bookingId,
      createdAt: this.now(),
      status: 'PENDING',
      delivery: 'DEMO_LOCAL_ONLY',
    });
  }
  private async booking(tx: Records, actor: Actor, bookingId: string) {
    const b = await tx.get<Booking>('bookings', bookingId);
    ensure(
      b &&
        (actor.role === 'ADMIN' ||
          (actor.role === 'CUSTOMER' && b.customerId === actor.id) ||
          (actor.role === 'MERCHANT' && b.storeId === actor.storeId) ||
          (actor.role === 'STAFF' && (await staffBookingAccess(tx, actor, b)))),
      'NOT_FOUND',
      'Booking not found.',
      404,
    );
    return b;
  }
  private async visible(tx: Records, actor: Actor, ticket: SupportTicket) {
    if (actor.role === 'ADMIN') return adminCaseVisible(tx, await currentAdmin(tx, actor), ticket);
    return (
      (actor.role === ticket.reporterRole && actor.id === ticket.reporterId) ||
      (actor.role === 'MERCHANT' &&
        actor.storeId === ticket.storeId &&
        ticket.visibility === 'SHOP_AND_CUSTOMER')
    );
  }
  private async ticket(tx: Records, actor: Actor, ticketId: string) {
    const ticket = await tx.get<SupportTicket>('supportTickets', ticketId);
    ensure(
      ticket && (await this.visible(tx, actor, ticket)),
      'NOT_FOUND',
      'Support case not found.',
      404,
    );
    return ticket;
  }
  private async operator(tx: Records, actor: Actor, ticket: SupportTicket) {
    if (actor.role !== 'ADMIN') return;
    requireAdmin(await currentAdmin(tx, actor), 'cases.write');
    if (actor.adminRole && !canAdmin(actor, 'cases.assign'))
      ensure(
        (await tx.get<TicketHandling>('ticketHandling', ticket.id))?.ownerId === actor.id,
        'OWNER_REQUIRED',
        'Claim this case before replying or resolving it.',
        409,
      );
  }
  private async recordMessage(
    tx: Records,
    actor: Actor,
    ticket: SupportTicket,
    text: string,
    kind: TicketMessage['kind'],
  ) {
    await tx.put<TicketMessage>('ticketMessages', {
      id: `case_message_${randomUUID()}`,
      ticketId: ticket.id,
      ticketVersion: ticket.version + 1,
      actorId: actor.id,
      role: actor.role,
      text,
      kind,
      createdAt: this.now(),
    });
  }
  private async save(tx: Records, actor: Actor, ticket: SupportTicket, action: string) {
    ticket.version++;
    ticket.updatedAt = this.now();
    await tx.put('supportTickets', ticket);
    await this.event(tx, actor, action, ticket);
    return ticket;
  }
  private async quota(tx: Records, actor: Actor) {
    ensure(
      (await tx.list<SupportTicket>('supportTickets')).filter(
        (x) => x.reporterId === actor.id && open(x),
      ).length < careConfig.maxActiveTickets,
      'SUPPORT_LIMIT',
      'Resolve an existing case before opening another.',
      429,
    );
  }
  async sweep(tx: Records) {
    const actor: Actor = { id: 'system', role: 'ADMIN', verificationLevel: 3 };
    for (const ticket of await tx.find<SupportTicket>('supportTickets', {
      status: 'NEEDS_MERCHANT',
      dueAt: { lte: this.now() },
    })) {
      if (ticket.status !== 'NEEDS_MERCHANT' || ticket.dueAt > this.now()) continue;
      ticket.status = 'PLATFORM_ESCALATED';
      ticket.dueAt = this.now() + careConfig.platformReplyHours * hour;
      await syncTicketHandling(tx, ticket, actor, 'ESCALATE', this.now());
      await this.save(tx, actor, ticket, 'SUPPORT_REPLY_OVERDUE');
    }
  }
  private run<T>(fn: (tx: Records) => Promise<T>) {
    return this.repo.transaction(async (tx) => {
      await this.sweep(tx);
      return fn(tx);
    });
  }

  async create(actor: Actor, input: unknown, key: string) {
    return this.run((tx) => this.createInTransaction(tx, actor, input, key));
  }
  async createInTransaction(tx: Records, actor: Actor, input: unknown, key: string) {
    this.role(actor, 'CUSTOMER');
    const data = supportTicketInput.parse(input);
    ensure(
      key.length >= 8 && key.length <= 160,
      'IDEMPOTENCY_REQUIRED',
      'An Idempotency-Key is required.',
    );
    const idem = createHash('sha256').update(`${actor.id}:support:${key}`).digest('hex');
    const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const previous = await tx.get<{ id: string; hash: string; ticketId: string }>(
      'careIdempotency',
      idem,
    );
    if (previous) {
      ensure(
        previous.hash === hash,
        'IDEMPOTENCY_CONFLICT',
        'This retry key was used for different input.',
        409,
      );
      return this.ticket(tx, actor, previous.ticketId);
    }
    const b = data.bookingId ? await this.booking(tx, actor, data.bookingId) : undefined;
    ensure(
      b || privateCategories.has(data.category),
      'BOOKING_REQUIRED',
      'Select the booking related to this service issue.',
    );
    await this.quota(tx, actor);
    const platformOnly = privateCategories.has(data.category);
    const ticket: SupportTicket = {
      ...data,
      id: `case_${randomUUID()}`,
      customerId: actor.id,
      reporterId: actor.id,
      reporterRole: 'CUSTOMER',
      storeId: b?.storeId,
      status: platformOnly ? 'PLATFORM_ESCALATED' : 'NEEDS_MERCHANT',
      priority: platformOnly ? 'HIGH' : 'NORMAL',
      visibility: platformOnly ? 'PLATFORM_ONLY' : 'SHOP_AND_CUSTOMER',
      version: 1,
      createdAt: this.now(),
      updatedAt: this.now(),
      dueAt:
        this.now() +
        (platformOnly ? careConfig.urgentReplyHours : careConfig.merchantReplyHours) * hour,
    };
    await tx.put('supportTickets', ticket);
    await tx.put('careIdempotency', { id: idem, hash, ticketId: ticket.id });
    await this.event(tx, actor, 'SUPPORT_CREATED', ticket);
    return ticket;
  }
  async refundTicket(tx: Records, actor: Actor, id: string) {
    return this.ticket(tx, actor, id);
  }
  async refundOutcome(tx: Records, actor: Actor, id: string, text: string, finish: boolean) {
    const ticket = await this.ticket(tx, actor, id);
    ensure(open(ticket), 'INVALID_STATE', 'Reopen this case before processing the refund.', 409);
    if (finish && ticket.status !== 'PLATFORM_ESCALATED') {
      ticket.status = 'RESOLVED';
      ticket.resolution = text;
      ticket.resolvedAt = this.now();
      ticket.resolvedBy = actor.id;
    } else if (ticket.status !== 'PLATFORM_ESCALATED') ticket.status = 'OPEN';
    await this.recordMessage(tx, actor, ticket, text, finish ? 'RESOLUTION' : 'MESSAGE');
    await syncTicketHandling(
      tx,
      ticket,
      actor,
      finish && ticket.status === 'RESOLVED' ? 'RESOLVE' : 'MESSAGE',
      this.now(),
    );
    return this.save(tx, actor, ticket, 'REFUND_CASE_UPDATED');
  }
  async list(actor: Actor) {
    return this.run(async (tx) => {
      const values: SupportTicket[] = [];
      for (const ticket of await tx.list<SupportTicket>('supportTickets'))
        if (await this.visible(tx, actor, ticket)) values.push(ticket);
      return values.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }
  async detail(actor: Actor, ticketId: string) {
    return this.run(async (tx) => {
      const ticket = await this.ticket(tx, actor, ticketId);
      return {
        ticket,
        ...(actor.role === 'STAFF' ? {} : { decision: await decisionDetail(tx, ticket) }),
        refundPending:
          (await tx.get<RefundRequest>('refundRequests', ticket.refundRequestId ?? ''))?.status ===
          'PENDING',
        messages: (await tx.list<TicketMessage>('ticketMessages'))
          .filter((x) => x.ticketId === ticketId)
          .sort((a, b) => a.createdAt - b.createdAt),
        attachments: (await tx.find<StoredAttachment>('ticketAttachments', { ticketId }))
          .sort((a, b) => a.createdAt - b.createdAt)
          .map(({ id, role, createdAt }): TicketAttachment => ({ id, role, createdAt })),
      };
    });
  }
  /** Adds a photo to an open case; anyone who can see the case may add evidence. */
  async attach(actor: Actor, ticketId: string, input: unknown): Promise<TicketAttachment> {
    const d = z
      .object({
        mime: z.enum(['image/jpeg', 'image/png']),
        data: z
          .string()
          .min(8)
          .max(470000)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .strict()
      .parse(input);
    let bytes: Buffer = Buffer.from(d.data, 'base64');
    ensure(
      bytes.length <= 350000 && bytes.toString('base64') === d.data,
      'INVALID_PHOTO',
      'Select a photo no larger than 350 KB.',
    );
    ensure(
      d.mime === 'image/png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
      'INVALID_PHOTO',
      'The photo format does not match the file.',
    );
    try {
      // Re-encoding drops embedded metadata such as the camera location.
      bytes = await sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'warning' })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch {
      ensure(false, 'INVALID_PHOTO', 'Select a valid JPEG or PNG photo.');
    }
    return this.run(async (tx) => {
      const ticket = await this.ticket(tx, actor, ticketId);
      ensure(open(ticket), 'INVALID_STATE', 'Reopen this case before adding evidence.', 409);
      ensure(
        (await tx.count('ticketAttachments', { ticketId })) < 10,
        'PHOTO_LIMIT',
        'This case already has the maximum number of photos.',
        409,
      );
      const id = `evidence_${randomUUID()}`;
      const record: StoredAttachment = {
        id,
        ticketId,
        uploaderId: actor.id,
        role: actor.role,
        storageKey: await saveEvidence(id, bytes),
        size: bytes.length,
        createdAt: this.now(),
      };
      await tx.put('ticketAttachments', record);
      await this.event(tx, actor, 'SUPPORT_ATTACHMENT_ADDED', ticket);
      return { id, role: record.role, createdAt: record.createdAt };
    });
  }
  async attachment(actor: Actor, ticketId: string, attachmentId: string) {
    return this.run(async (tx) => {
      await this.ticket(tx, actor, ticketId);
      const record = await tx.get<StoredAttachment>('ticketAttachments', attachmentId);
      ensure(record?.ticketId === ticketId, 'NOT_FOUND', 'Attachment not found.', 404);
      return { mime: 'image/jpeg', bytes: await loadEvidence(record) };
    });
  }
  async reply(actor: Actor, ticketId: string, version: number, text: string) {
    const clean = z.string().trim().min(3).max(3000).parse(text);
    return this.run(async (tx) => {
      const ticket = await this.ticket(tx, actor, ticketId);
      await this.operator(tx, actor, ticket);
      this.version(ticket.version, version);
      ensure(open(ticket), 'INVALID_STATE', 'Reopen this case before replying.', 409);
      await this.recordMessage(tx, actor, ticket, clean, 'MESSAGE');
      if (actor.role === 'MERCHANT' && ticket.status === 'NEEDS_MERCHANT') ticket.status = 'OPEN';
      else if (
        actor.role === 'CUSTOMER' &&
        ticket.status === 'OPEN' &&
        ticket.visibility === 'SHOP_AND_CUSTOMER'
      ) {
        ticket.status = 'NEEDS_MERCHANT';
        ticket.dueAt = this.now() + careConfig.merchantReplyHours * hour;
      }
      await syncTicketHandling(tx, ticket, actor, 'MESSAGE', this.now());
      return this.save(tx, actor, ticket, 'SUPPORT_REPLIED');
    });
  }
  async action(actor: Actor, ticketId: string, input: unknown) {
    const data = ticketActionInput.parse(input);
    return this.run(async (tx) => {
      const ticket = await this.ticket(tx, actor, ticketId);
      await this.operator(tx, actor, ticket);
      this.version(ticket.version, data.version);
      if (['RESOLVE', 'CLOSE'].includes(data.action)) await assertDecisionClosable(tx, ticket);
      if (['RESOLVE', 'CLOSE'].includes(data.action) && ticket.refundRequestId)
        ensure(
          (await tx.get<RefundRequest>('refundRequests', ticket.refundRequestId))?.status !==
            'PENDING',
          'REFUND_PENDING',
          'Decide or withdraw the refund request before closing this case.',
          409,
        );
      if (data.releaseRestriction || data.releaseShopBlock) requireAdmin(actor, 'safety.write');
      ensure(
        (!data.releaseRestriction && !data.releaseShopBlock) ||
          (data.action === 'RESOLVE' && actor.role === 'ADMIN'),
        'FORBIDDEN',
        'Only platform resolution can release a safety restriction.',
        403,
      );
      if (data.action === 'ESCALATE') {
        ensure(
          open(ticket) && ticket.status !== 'PLATFORM_ESCALATED',
          'INVALID_STATE',
          'This case cannot be escalated.',
          409,
        );
        ticket.status = 'PLATFORM_ESCALATED';
        ticket.dueAt = this.now() + careConfig.platformReplyHours * hour;
      } else if (data.action === 'RESOLVE') {
        this.role(actor, 'MERCHANT', 'ADMIN');
        ensure(open(ticket), 'INVALID_STATE', 'This case has already ended.', 409);
        if (actor.role === 'MERCHANT')
          ensure(
            ticket.status !== 'PLATFORM_ESCALATED' && ticket.visibility === 'SHOP_AND_CUSTOMER',
            'PLATFORM_REVIEW_REQUIRED',
            'This case is under platform review.',
            403,
          );
        ticket.status = 'RESOLVED';
        ticket.resolution = data.text;
        ticket.resolvedAt = this.now();
        ticket.resolvedBy = actor.id;
        if (data.releaseRestriction) {
          ensure(
            ticket.category === 'APPEAL' && ticket.restrictionVersion !== undefined,
            'INVALID_STATE',
            'Only an account appeal can release a platform restriction.',
            409,
          );
          const restriction = await tx.get<CustomerRestriction>('restrictions', ticket.customerId);
          ensure(
            restriction && restriction.version === ticket.restrictionVersion,
            'RESTRICTION_CHANGED',
            'The restriction changed. Review the current decision before releasing it.',
            409,
          );
          restriction.active = false;
          restriction.version++;
          restriction.updatedAt = this.now();
          await tx.put('restrictions', restriction);
        }
        if (ticket.reporterRole === 'STAFF') {
          const block = await tx.get<CustomerBlock>(
            'blocks',
            `${ticket.storeId}:${ticket.customerId}`,
          );
          if (block) {
            const another = (await tx.list<SupportTicket>('supportTickets')).some(
              (x) =>
                x.id !== ticket.id &&
                x.storeId === ticket.storeId &&
                x.customerId === ticket.customerId &&
                x.reporterRole === 'STAFF' &&
                open(x),
            );
            ensure(
              !data.releaseShopBlock || !another,
              'OTHER_SAFETY_REPORT_OPEN',
              'Another safety report still requires review.',
              409,
            );
            block.reviewRequired = another;
            if (data.releaseShopBlock) block.active = false;
            block.version++;
            block.updatedAt = this.now();
            await tx.put('blocks', block);
          }
        } else
          ensure(
            !data.releaseShopBlock,
            'INVALID_STATE',
            'Only a staff safety report can release its related shop block.',
            409,
          );
      } else if (data.action === 'CLOSE') {
        this.role(actor, ticket.reporterRole);
        ensure(
          actor.id === ticket.reporterId && ticket.status === 'RESOLVED',
          'INVALID_STATE',
          'Only the reporter can close a resolved case.',
          409,
        );
        ticket.status = 'CLOSED';
      } else {
        ensure(
          actor.id === ticket.reporterId && ['RESOLVED', 'CLOSED'].includes(ticket.status),
          'INVALID_STATE',
          'Only the reporter can reopen a finished case.',
          409,
        );
        ticket.status = 'PLATFORM_ESCALATED';
        ticket.resolution = undefined;
        ticket.resolvedAt = undefined;
        ticket.resolvedBy = undefined;
        ticket.dueAt = this.now() + careConfig.platformReplyHours * hour;
        if (ticket.reporterRole === 'STAFF') await this.safetyBlock(tx, ticket);
      }
      await this.recordMessage(
        tx,
        actor,
        ticket,
        data.text,
        data.action === 'RESOLVE'
          ? 'RESOLUTION'
          : data.action === 'REOPEN'
            ? 'REOPEN'
            : 'ESCALATION',
      );
      await syncTicketHandling(tx, ticket, actor, data.action, this.now());
      return this.save(tx, actor, ticket, `SUPPORT_${data.action}`);
    });
  }
  private async safetyBlock(tx: Records, ticket: SupportTicket) {
    const key = `${ticket.storeId}:${ticket.customerId}`;
    const existing = await tx.get<CustomerBlock>('blocks', key);
    await tx.put<CustomerBlock>('blocks', {
      id: key,
      storeId: ticket.storeId!,
      customerId: ticket.customerId,
      active: true,
      reviewRequired: true,
      reason: existing?.reason || 'Staff safety report pending platform review.',
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? this.now(),
      updatedAt: this.now(),
    });
  }
  async feedback(actor: Actor, bookingId: string, text: string) {
    this.role(actor, 'STAFF');
    const clean = z.string().trim().min(10).max(3000).parse(text);
    return this.run(async (tx) => {
      const b = await this.booking(tx, actor, bookingId);
      const previous = (await tx.list<SupportTicket>('supportTickets')).find(
        (x) =>
          x.bookingId === b.id && x.reporterId === actor.id && x.category === 'SAFETY' && open(x),
      );
      if (previous) return previous;
      await this.quota(tx, actor);
      const ticket: SupportTicket = {
        id: `case_${randomUUID()}`,
        bookingId: b.id,
        storeId: b.storeId,
        customerId: b.customerId,
        reporterId: actor.id,
        reporterRole: 'STAFF',
        category: 'SAFETY',
        subject: 'Staff safety feedback',
        description: clean,
        visibility: 'PLATFORM_ONLY',
        priority: 'HIGH',
        status: 'PLATFORM_ESCALATED',
        version: 1,
        createdAt: this.now(),
        updatedAt: this.now(),
        dueAt: this.now() + careConfig.urgentReplyHours * hour,
      };
      await tx.put('supportTickets', ticket);
      await this.safetyBlock(tx, ticket);
      await this.event(tx, actor, 'STAFF_SAFETY_FEEDBACK', ticket);
      return ticket;
    });
  }
  async blocks(actor: Actor) {
    this.role(actor, 'MERCHANT');
    return this.run(async (tx) =>
      (await tx.list<CustomerBlock>('blocks'))
        .filter((x) => x.storeId === actor.storeId)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    );
  }
  async setBlock(actor: Actor, customerId: string, input: unknown) {
    this.role(actor, 'MERCHANT');
    const data = customerBlockInput.parse(input);
    return this.run(async (tx) => {
      ensure(
        (await tx.count('bookings', { storeId: actor.storeId!, customerId })) > 0,
        'NOT_FOUND',
        'This customer has no booking with your shop.',
        404,
      );
      const key = `${actor.storeId}:${customerId}`;
      const old = await tx.get<CustomerBlock>('blocks', key);
      this.version(old?.version ?? 0, data.version);
      ensure(
        !old?.reviewRequired,
        'PLATFORM_REVIEW_REQUIRED',
        'A staff safety report must be reviewed by the platform first.',
        403,
      );
      const block: CustomerBlock = {
        id: key,
        storeId: actor.storeId!,
        customerId,
        active: data.active,
        reason: data.reason,
        reviewRequired: false,
        version: (old?.version ?? 0) + 1,
        createdAt: old?.createdAt ?? this.now(),
        updatedAt: this.now(),
      };
      await tx.put('blocks', block);
      await this.event(
        tx,
        actor,
        data.active ? 'SHOP_CUSTOMER_BLOCKED' : 'SHOP_CUSTOMER_UNBLOCKED',
        undefined,
        key,
      );
      return block;
    });
  }
  async restrictions(actor: Actor): Promise<CustomerRestriction[] | PublicRestriction[]> {
    this.role(actor, 'ADMIN', 'CUSTOMER');
    if (actor.role === 'ADMIN') requireAdmin(actor, 'safety.write');
    return this.run(async (tx) => {
      const values = (await tx.list<CustomerRestriction>('restrictions')).filter(
        (x) => actor.role === 'ADMIN' || (x.id === actor.id && restrictionActive(x, this.now())),
      );
      return actor.role === 'ADMIN'
        ? values
        : values.map((x) => ({ id: x.id, expiresAt: x.expiresAt, version: x.version }));
    });
  }
  async setRestriction(actor: Actor, input: unknown) {
    this.role(actor, 'ADMIN');
    requireAdmin(actor, 'safety.write');
    const data = customerRestrictionInput.parse(input);
    return this.run(async (tx) => {
      ensure(
        (await tx.count('bookings', { customerId: data.customerId })) > 0 ||
          (await tx.list<{ actor: Actor }>('sessions')).some(
            (x) => x.actor.role === 'CUSTOMER' && x.actor.id === data.customerId,
          ),
        'NOT_FOUND',
        'Customer not found.',
        404,
      );
      const old = await tx.get<CustomerRestriction>('restrictions', data.customerId);
      this.version(old?.version ?? 0, data.version);
      if (data.active)
        ensure(
          data.expiresAt > this.now() &&
            data.expiresAt <= this.now() + careConfig.maxRestrictionDays * 24 * hour,
          'INVALID_EXPIRY',
          'Choose an expiry within 30 days.',
        );
      const value: CustomerRestriction = {
        id: data.customerId,
        active: data.active,
        reason: data.reason,
        expiresAt: data.expiresAt,
        version: (old?.version ?? 0) + 1,
        createdAt: old?.createdAt ?? this.now(),
        updatedAt: this.now(),
      };
      await tx.put('restrictions', value);
      await this.event(
        tx,
        actor,
        value.active ? 'CUSTOMER_RESTRICTED' : 'CUSTOMER_RESTRICTION_RELEASED',
        undefined,
        value.id,
      );
      return value;
    });
  }
  async appeal(actor: Actor, version: number, text: string) {
    this.role(actor, 'CUSTOMER');
    const clean = z.string().trim().min(10).max(3000).parse(text);
    return this.run(async (tx) => {
      const restriction = await tx.get<CustomerRestriction>('restrictions', actor.id);
      ensure(
        restrictionActive(restriction, this.now()),
        'INVALID_STATE',
        'There is no active restriction to appeal.',
        409,
      );
      this.version(restriction!.version, version);
      const existing = (await tx.list<SupportTicket>('supportTickets')).find(
        (x) =>
          x.reporterId === actor.id &&
          x.category === 'APPEAL' &&
          x.restrictionVersion === version &&
          open(x),
      );
      if (existing) return existing;
      await this.quota(tx, actor);
      const ticket: SupportTicket = {
        id: `case_${randomUUID()}`,
        customerId: actor.id,
        reporterId: actor.id,
        reporterRole: 'CUSTOMER',
        category: 'APPEAL',
        subject: 'Account restriction appeal',
        description: clean,
        visibility: 'PLATFORM_ONLY',
        priority: 'HIGH',
        status: 'PLATFORM_ESCALATED',
        restrictionVersion: version,
        version: 1,
        createdAt: this.now(),
        updatedAt: this.now(),
        dueAt: this.now() + careConfig.platformReplyHours * hour,
      };
      await tx.put('supportTickets', ticket);
      await this.event(tx, actor, 'RESTRICTION_APPEALED', ticket);
      return ticket;
    });
  }
  async safetyEvents(actor: Actor) {
    this.role(actor, 'MERCHANT', 'STAFF', 'ADMIN');
    if (actor.role === 'ADMIN') requireAdmin(actor, 'safety.write');
    return this.run(async (tx) => {
      const events = (await tx.list<SafetyEvent>('safety')).filter(
        (x) =>
          actor.role === 'ADMIN' ||
          (actor.role === 'MERCHANT' && x.storeId === actor.storeId) ||
          (actor.role === 'STAFF' && x.staffId === actor.staffId),
      );
      const contacts = new Map<string, string>();
      if (actor.role === 'STAFF')
        for (const storeId of new Set(events.map((x) => x.storeId)))
          contacts.set(storeId, (await tx.get<Store>('stores', storeId))?.emergencyContact ?? '');
      return events
        .map((x) => safetyEventView(actor, x, contacts.get(x.storeId)))
        .sort((a, b) => b.createdAt - a.createdAt);
    });
  }
  /** The therapist shares their current position once, by explicit choice, for an open event. */
  async shareLocation(actor: Actor, eventId: string, input: unknown) {
    this.role(actor, 'STAFF');
    const data = safetyLocationInput.parse(input);
    return this.run(async (tx) => {
      const event = await tx.get<SafetyEvent>('safety', eventId);
      ensure(event && event.staffId === actor.staffId, 'NOT_FOUND', 'Safety event not found.', 404);
      ensure(event.status === 'OPEN', 'INVALID_STATE', 'This event is already resolved.', 409);
      event.location = { ...data, sharedAt: this.now() };
      event.version = (event.version ?? 1) + 1;
      await tx.put('safety', event);
      await tx.put<Audit>('audit', {
        id: `audit_${randomUUID()}`,
        actorId: actor.id,
        action: 'SAFETY_LOCATION_SHARED',
        bookingId: event.bookingId,
        detail: event.id,
        at: this.now(),
      });
      // The shop and the safety team are told; the customer is not.
      await tx.put('outbox', {
        id: `outbox_${randomUUID()}`,
        type: 'SAFETY_LOCATION_SHARED',
        bookingId: event.bookingId,
        createdAt: this.now(),
        status: 'PENDING',
        delivery: 'DEMO_LOCAL_ONLY',
      });
      const store = await tx.get<Store>('stores', event.storeId);
      return safetyEventView(actor, event, store?.emergencyContact);
    });
  }
  /**
   * Break-glass access for the safety team: during an open event the visit place may be read
   * after recording why. Every read is audited; addresses stay hidden from the platform otherwise.
   */
  async emergencyLocation(
    actor: Actor,
    eventId: string,
    input: unknown,
  ): Promise<EmergencyLocation> {
    this.role(actor, 'ADMIN');
    const data = z
      .object({ reason: z.string().trim().min(10).max(500) })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      actor = await currentAdmin(tx, actor);
      requireAdmin(actor, 'safety.write');
      const event = await tx.get<SafetyEvent>('safety', eventId);
      ensure(event, 'NOT_FOUND', 'Safety event not found.', 404);
      ensure(
        event.status === 'OPEN',
        'INVALID_STATE',
        'The visit place is only available while the event is open.',
        409,
      );
      const b = await tx.get<Booking>('bookings', event.bookingId);
      const store = await tx.get<Store>('stores', event.storeId);
      ensure(b && store, 'NOT_FOUND', 'Booking not found.', 404);
      await tx.put<Audit>('audit', {
        id: `audit_${randomUUID()}`,
        actorId: actor.id,
        action: 'SAFETY_ADDRESS_ACCESSED',
        bookingId: b.id,
        detail: `${event.id}:${data.reason}`,
        at: this.now(),
      });
      const inStore = b.quote.fulfillmentMode === 'IN_STORE';
      const a = b.address;
      return {
        eventId: event.id,
        bookingId: b.id,
        mode: inStore ? 'IN_STORE' : 'HOME_VISIT',
        address: inStore
          ? b.quote.venue?.address
          : a && [a.detail, a.hotelName, a.room].filter(Boolean).join(' / '),
        place: inStore ? b.resourceName : a?.type,
        storeEmergencyContact: store.emergencyContact,
        ...(event.location ? { location: event.location } : {}),
      };
    });
  }
  async resolveSafety(actor: Actor, eventId: string, version: number, text: string) {
    this.role(actor, 'ADMIN');
    requireAdmin(actor, 'safety.write');
    const clean = z.string().trim().min(10).max(3000).parse(text);
    return this.run(async (tx) => {
      const event = await tx.get<SafetyEvent>('safety', eventId);
      ensure(event, 'NOT_FOUND', 'Safety event not found.', 404);
      this.version(event.version ?? 1, version);
      ensure(event.status === 'OPEN', 'INVALID_STATE', 'This event is already resolved.', 409);
      event.status = 'RESOLVED';
      event.version = (event.version ?? 1) + 1;
      event.resolvedAt = this.now();
      event.resolvedBy = actor.id;
      event.resolution = clean;
      await tx.put('safety', event);
      await this.event(tx, actor, 'SAFETY_EVENT_RESOLVED', undefined, event.id);
      return event;
    });
  }
}
