import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  Actor,
  Audit,
  Listing,
  Offering,
  SafetyEvent,
  Store,
  TimeOffRequest,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import type { TimeBlock } from './merchant.js';
import { ensure } from './errors.js';

export function timeOffHistory(requests: TimeOffRequest[]) {
  const sorted = [...requests].sort((a, b) => b.createdAt - a.createdAt);
  return [
    ...sorted.filter((r) => r.status === 'PENDING'),
    ...sorted.filter((r) => r.status !== 'PENDING').slice(0, 100),
  ];
}

export class StaffService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
  ) {}
  private async member(tx: Records, actor: Actor) {
    ensure(
      actor.role === 'STAFF' && actor.staffId && actor.storeId,
      'FORBIDDEN',
      'Staff account required.',
      403,
    );
    const listing = (await tx.list<Listing>('listings')).find(
      (x) => x.staffId === actor.staffId && x.storeId === actor.storeId,
    );
    const store = listing && (await tx.get<Store>('stores', listing.storeId));
    ensure(listing && store, 'NOT_FOUND', 'Staff membership not found.', 404);
    return { listing, store };
  }
  private eligible(listing: Listing, store: Store) {
    return (
      listing.membershipActive &&
      listing.identityVerified &&
      listing.portraitConsent &&
      listing.publicationStatus === 'PUBLISHED_INDEXABLE' &&
      store.active &&
      store.approved &&
      !!store.pspAccount
    );
  }
  private async audit(tx: Records, actor: Actor, action: string, target: string) {
    await tx.put<Audit>('audit', {
      id: randomUUID(),
      actorId: actor.id,
      action,
      detail: target,
      at: this.now(),
    });
    await tx.put('outbox', {
      id: randomUUID(),
      type: action,
      target,
      createdAt: this.now(),
      status: 'PENDING',
      delivery: 'DEMO_LOCAL_ONLY',
    });
  }
  async snapshot(actor: Actor) {
    return this.run(async (tx) => {
      const { listing, store } = await this.member(tx, actor);
      return {
        listing,
        store: {
          id: store.id,
          name: store.name,
          areas: store.areas,
          emergencyContact: store.emergencyContact,
          acceptanceMode: store.acceptanceMode,
          active: store.active,
          approved: store.approved,
        },
        eligible: this.eligible(listing, store),
        dutyExpiresAt: listing.dutyUpdatedAt + 4 * 3600_000,
        offerings: (await tx.list<Offering>('offerings'))
          .filter((o) => o.storeId === store.id && listing.offeringIds.includes(o.id))
          .sort((a, b) => a.durationMinutes - b.durationMinutes),
        blocks: (await tx.list<TimeBlock>('timeBlocks'))
          .filter((b) => b.staffId === actor.staffId && b.active && b.endAt > this.now())
          .sort((a, b) => a.startAt - b.startAt),
        requests: timeOffHistory(
          (await tx.list<TimeOffRequest>('timeOffRequests')).filter(
            (r) => r.staffId === actor.staffId && r.storeId === store.id,
          ),
        ),
        safety: (await tx.list<SafetyEvent>('safety'))
          .filter((s) => s.staffId === actor.staffId && s.storeId === store.id)
          .map((s) => ({
            id: s.id,
            bookingId: s.bookingId,
            type: s.type,
            status: s.status,
            createdAt: s.createdAt,
          })),
      };
    });
  }
  async duty(actor: Actor, onDuty: boolean, expectedAt?: number) {
    return this.run(async (tx) => {
      const { listing, store } = await this.member(tx, actor);
      ensure(
        expectedAt === undefined || listing.dutyUpdatedAt === expectedAt,
        'VERSION_CONFLICT',
        'Availability changed. Refresh first.',
        409,
      );
      if (onDuty)
        ensure(
          this.eligible(listing, store),
          'LISTING_UNAVAILABLE',
          'Membership or shop is not eligible.',
          409,
        );
      listing.onDuty = onDuty;
      listing.dutyUpdatedAt = Math.max(this.now(), listing.dutyUpdatedAt + 1);
      await tx.put('listings', listing);
      await this.audit(tx, actor, 'DUTY_UPDATED', listing.id);
      return listing;
    });
  }
  async request(actor: Actor, input: unknown, key: string) {
    const data = z
      .object({
        startAt: z.number().int(),
        endAt: z.number().int(),
        reason: z.enum(['BREAK', 'TIME_OFF', 'TRAINING']),
      })
      .strict()
      .parse(input);
    ensure(
      key.length >= 8 && key.length <= 160,
      'IDEMPOTENCY_REQUIRED',
      'A retry key is required.',
    );
    return this.run(async (tx) => {
      const { listing, store } = await this.member(tx, actor);
      ensure(
        listing.membershipActive && store.active,
        'LISTING_UNAVAILABLE',
        'Active membership required.',
        409,
      );
      const id = createHash('sha256')
        .update(`staff-leave:${store.id}:${listing.staffId}:${key}`)
        .digest('hex');
      const prior = await tx.get<TimeOffRequest>('timeOffRequests', id);
      if (prior) {
        ensure(
          prior.startAt === data.startAt &&
            prior.endAt === data.endAt &&
            prior.reason === data.reason,
          'IDEMPOTENCY_CONFLICT',
          'Retry input changed.',
          409,
        );
        return prior;
      }
      ensure(
        data.startAt >= this.now() &&
          data.startAt < this.now() + 90 * 86400_000 &&
          data.endAt > data.startAt &&
          data.endAt - data.startAt <= 14 * 86400_000,
        'INVALID_TIME',
        'Choose a future period of up to 14 days within 90 days.',
      );
      ensure(
        !(await tx.conflicts(listing.staffId, data.startAt, data.endAt)),
        'SLOT_CONFLICT',
        'This time overlaps a booking, travel buffer or blocked time.',
        409,
      );
      const pending = (await tx.list<TimeOffRequest>('timeOffRequests')).filter(
        (r) => r.staffId === listing.staffId && r.status === 'PENDING' && r.endAt > this.now(),
      );
      ensure(pending.length < 20, 'REQUEST_LIMIT', 'Too many pending requests.', 429);
      ensure(
        !pending.some((r) => r.startAt < data.endAt && r.endAt > data.startAt),
        'SLOT_CONFLICT',
        'A pending request overlaps this time.',
        409,
      );
      const request: TimeOffRequest = {
        id,
        storeId: store.id,
        listingId: listing.id,
        staffId: listing.staffId,
        ...data,
        status: 'PENDING',
        version: 1,
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      await tx.put('timeOffRequests', request);
      await this.audit(tx, actor, 'STAFF_TIME_OFF_REQUESTED', id);
      return request;
    });
  }
  async review(actor: Actor, id: string, input: unknown) {
    const data = z
      .object({
        version: z.number().int().positive(),
        decision: z.enum(['APPROVED', 'REJECTED', 'WITHDRAWN']),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      ensure(
        actor.role === 'MERCHANT' || actor.role === 'STAFF',
        'FORBIDDEN',
        'Staff or shop account required.',
        403,
      );
      const request = await tx.get<TimeOffRequest>('timeOffRequests', id);
      ensure(
        request &&
          request.storeId === actor.storeId &&
          (actor.role === 'MERCHANT' || request.staffId === actor.staffId),
        'NOT_FOUND',
        'Request not found.',
        404,
      );
      ensure(
        actor.role === 'STAFF' ? data.decision === 'WITHDRAWN' : data.decision !== 'WITHDRAWN',
        'FORBIDDEN',
        'Decision is not available to this account.',
        403,
      );
      ensure(
        request.version === data.version,
        'VERSION_CONFLICT',
        'Request changed. Refresh first.',
        409,
      );
      ensure(
        request.status === 'PENDING',
        'INVALID_STATE',
        'This request was already processed.',
        409,
      );
      if (data.decision === 'APPROVED') {
        const listing = await tx.get<Listing>('listings', request.listingId);
        ensure(
          listing?.membershipActive &&
            listing.storeId === actor.storeId &&
            request.startAt > this.now(),
          'INVALID_STATE',
          'Membership or time is no longer valid.',
          409,
        );
        ensure(
          !(await tx.conflicts(request.staffId, request.startAt, request.endAt)),
          'SLOT_CONFLICT',
          'A booking or blocked time now overlaps this request.',
          409,
        );
        const block: TimeBlock = {
          id: `leave-${request.id}`,
          listingId: request.listingId,
          storeId: request.storeId,
          staffId: request.staffId,
          startAt: request.startAt,
          endAt: request.endAt,
          reason: request.reason,
          active: true,
          version: 1,
          createdAt: this.now(),
        };
        await tx.interval({
          id: `block:${block.id}`,
          staffId: block.staffId,
          startAt: block.startAt,
          endAt: block.endAt,
          expiresAt: block.endAt,
        });
        await tx.put('timeBlocks', block);
        request.blockId = block.id;
      }
      request.status = data.decision;
      request.version++;
      request.updatedAt = this.now();
      await tx.put('timeOffRequests', request);
      await this.audit(tx, actor, `TIME_OFF_${data.decision}`, id);
      return request;
    });
  }
}
