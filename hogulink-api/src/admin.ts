import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  Actor,
  AdminBooking,
  AdminReview,
  Audit,
  Booking,
  Listing,
  Offering,
  SafetyEvent,
  Store,
  SupportTicket,
  TicketHandling,
} from '@hogulink/contracts';
import { initialHandling } from './ticket-handling.js';
import { canAdmin } from '@hogulink/contracts';
import { adminCaseVisible, adminDirectory, currentAdmin, requireAdmin } from './admin-access.js';
import type { Records } from './repository.js';
import { ensure } from './errors.js';
import { config } from './config.js';

type FeeEntry = {
  id: string;
  storeId: string;
  bookingId: string;
  type: string;
  amount: number;
  createdAt?: number;
};
export class AdminService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
  ) {}
  private role(actor: Actor) {
    ensure(actor.role === 'ADMIN', 'FORBIDDEN', 'Administrator account required.', 403);
  }
  async snapshot(actor: Actor) {
    this.role(actor);
    return this.run(async (tx) => {
      actor = await currentAdmin(tx, actor);
      const stores = await tx.list<Store>('stores'),
        listings = await tx.list<Listing>('listings'),
        offerings = await tx.list<Offering>('offerings');
      const bookings = (await tx.list<Booking>('bookings')).sort(
        (a, b) => b.createdAt - a.createdAt,
      );
      const fees = (await tx.list<FeeEntry>('feeEntries')).sort(
        (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
      );
      const queue = await tx.list<{
        id: string;
        type: string;
        status: string;
        createdAt: number;
        delivery?: string;
      }>('outbox');
      const tickets: SupportTicket[] = [];
      for (const ticket of await tx.list<SupportTicket>('supportTickets'))
        if (await adminCaseVisible(tx, actor, ticket)) tickets.push(ticket);
      const handling = new Map(
        (await tx.list<TicketHandling>('ticketHandling')).map((h) => [h.id, h]),
      );
      return {
        generatedAt: this.now(),
        actor,
        assignees: canAdmin(actor, 'cases.read')
          ? (await adminDirectory(tx, this.now())).filter((m) =>
              m.teams.some(
                (team) =>
                  (actor.adminRole ?? 'OWNER') === 'OWNER' || actor.adminTeams?.includes(team),
              ),
            )
          : [],
        stores: stores.map(({ pspAccount, ...s }) => ({
          ...s,
          pspReady: !!pspAccount,
          moderationVersion: s.moderationVersion ?? 1,
        })),
        listings: listings.map((x) => ({ ...x, moderationVersion: x.moderationVersion ?? 1 })),
        offerings,
        bookings: bookings.map(
          ({
            address: _address,
            contact: _contact,
            checkInCode: _checkInCode,
            customerId: _customer,
            paymentId: _payment,
            holdId: _hold,
            quote,
            ...b
          }): AdminBooking => {
            const { customerId: _quoteCustomer, ...safeQuote } = quote;
            return {
              ...b,
              completion: b.completion
                ? {
                    ...b.completion,
                    history: b.completion.history.map(({ note: _note, ...h }) => h),
                  }
                : undefined,
              noShow: b.noShow ? { ...b.noShow, reviewNote: undefined } : undefined,
              quote: safeQuote,
            };
          },
        ),
        feeEntries: canAdmin(actor, 'finance.read') ? fees : [],
        safety: (canAdmin(actor, 'safety.write') ? await tx.list<SafetyEvent>('safety') : [])
          .map((s) => ({ ...s, version: s.version ?? 1 }))
          .sort((a, b) => b.createdAt - a.createdAt),
        caseHandling: tickets.map((t) => handling.get(t.id) ?? initialHandling(t)),
        cases: tickets
          .map((c) => ({
            id: c.id,
            bookingId: c.bookingId,
            storeId: c.storeId,
            category: c.category,
            subject: c.subject,
            visibility: c.visibility,
            priority: c.priority,
            status: c.status,
            dueAt: c.dueAt,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
          }))
          .sort((a, b) => b.createdAt - a.createdAt),
        reviews: (canAdmin(actor, 'supply.read') ? await tx.list<AdminReview>('adminReviews') : [])
          .sort((a, b) => b.at - a.at)
          .slice(0, 100),
        audit: (canAdmin(actor, 'audit.read') ? await tx.list<Audit>('audit') : [])
          .sort((a, b) => b.at - a.at)
          .slice(0, 500),
        system: {
          mode: 'demo',
          payments: 'demo',
          notifications:
            (process.env.EMAIL_PROVIDER || 'disabled') === 'disabled'
              ? 'DEMO_LOCAL_ONLY'
              : 'PROVIDER_CONFIGURED',
          queue: (canAdmin(actor, 'system.read') ? queue : [])
            .slice()
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 30)
            .map((x) => ({
              id: x.id,
              type: x.type,
              status: x.status,
              createdAt: x.createdAt,
              delivery: x.delivery ?? 'DEMO_LOCAL_ONLY',
            })),
          pending: canAdmin(actor, 'system.read')
            ? queue.filter((x) => x.status === 'PENDING').length
            : 0,
          oldestPendingAt: !canAdmin(actor, 'system.read')
            ? null
            : (queue
                .filter((x) => x.status === 'PENDING')
                .sort((a, b) => a.createdAt - b.createdAt)[0]?.createdAt ?? null),
          bufferMinutes: config.bufferMinutes,
          holdTtlSeconds: config.holdTtlSeconds,
          standardFeeBps: config.standardFeeBps,
          annualFeeBps: config.annualFeeBps,
        },
      };
    });
  }
  async review(actor: Actor, input: unknown) {
    this.role(actor);
    requireAdmin(actor, 'supply.write');
    const data = z
      .object({
        targetType: z.enum(['STORE', 'LISTING', 'OFFERING']),
        targetId: z.string().min(1),
        decision: z.enum(['APPROVE', 'SUSPEND', 'REJECT']),
        version: z.number().int().positive(),
        reason: z.string().trim().min(10).max(500),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      actor = await currentAdmin(tx, actor);
      requireAdmin(actor, 'supply.write');
      const kind =
        data.targetType === 'STORE'
          ? 'stores'
          : data.targetType === 'LISTING'
            ? 'listings'
            : 'offerings';
      const target = await tx.get<Store | Listing | Offering>(kind, data.targetId);
      ensure(target, 'NOT_FOUND', 'Review target not found.', 404);
      const version =
        'regulatoryCategory' in target ? target.version : (target.moderationVersion ?? 1);
      ensure(
        version === data.version,
        'VERSION_CONFLICT',
        'This record changed. Refresh first.',
        409,
      );
      const storeId = 'storeId' in target ? target.storeId : target.id;
      const store = await tx.get<Store>('stores', storeId);
      ensure(store, 'NOT_FOUND', 'Shop not found.', 404);
      const approve = data.decision === 'APPROVE';
      if (approve && data.targetType !== 'OFFERING') {
        const application = await tx.get<import('@hogulink/contracts').PartnerApplication>(
          'partnerApplications',
          data.targetId,
        );
        ensure(
          !application ||
            (application.status === 'APPROVED' &&
              !!application.validUntil &&
              application.validUntil > this.now()),
          'QUALIFICATION_REVIEW_REQUIRED',
          'Complete the current qualification application before publication.',
          409,
        );
      }
      if (data.targetType === 'STORE') {
        const s = target as Store;
        if (approve)
          ensure(
            !!s.legalName.trim() &&
              !!s.legalAddress.trim() &&
              !!s.contact.trim() &&
              !!s.emergencyContact.trim() &&
              !!s.pspAccount,
            'REVIEW_INCOMPLETE',
            'Shop identity, address, contacts and payment routing must be present.',
            409,
          );
        s.active = approve;
        if (data.decision !== 'SUSPEND') s.approved = approve;
        s.moderationVersion = version + 1;
        s.ruleVersion++;
      } else if (data.targetType === 'LISTING') {
        const s = target as Listing;
        if (approve)
          ensure(
            s.membershipActive &&
              s.identityVerified &&
              s.portraitConsent &&
              store.approved &&
              store.active &&
              !!store.pspAccount,
            'REVIEW_INCOMPLETE',
            'Active membership, identity, portrait consent and approved shop are required.',
            409,
          );
        s.publicationStatus = approve ? 'PUBLISHED_INDEXABLE' : 'SUSPENDED';
        s.moderationVersion = version + 1;
      } else {
        const s = target as Offering;
        if (approve) {
          ensure(
            s.regulatoryCategory === 'RELAXATION',
            'REGULATORY_REVIEW_REQUIRED',
            'Licensed categories need a separate evidence review workflow.',
            409,
          );
          ensure(store.approved, 'REVIEW_INCOMPLETE', 'Shop review must be approved first.', 409);
        }
        s.approved = approve;
        s.version++;
      }
      await tx.put(kind, target);
      const record: AdminReview = {
        id: `review_${randomUUID()}`,
        targetType: data.targetType,
        targetId: data.targetId,
        storeId,
        decision: data.decision,
        reason: data.reason,
        actorId: actor.id,
        at: this.now(),
        previousVersion: version,
        nextVersion: version + 1,
      };
      await tx.put('adminReviews', record);
      // Review notes stay in the administrator-only record, not in shared notifications.
      await tx.put<Audit>('audit', {
        id: `audit_${randomUUID()}`,
        actorId: actor.id,
        action: `ADMIN_${data.targetType}_${data.decision}`,
        at: this.now(),
        detail: record.id,
      });
      await tx.put('outbox', {
        id: `outbox_${randomUUID()}`,
        type: 'ADMIN_REVIEW_RECORDED',
        reviewId: record.id,
        createdAt: this.now(),
        status: 'PENDING',
        delivery: 'DEMO_LOCAL_ONLY',
      });
      return record;
    });
  }
}
