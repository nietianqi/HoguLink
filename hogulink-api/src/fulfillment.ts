import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  Actor,
  Booking,
  SafetyCheckIn,
  SafetyCheckInView,
  SafetyDesk,
  SafetyEvent,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { ensure } from './errors.js';
import { currentAdmin, requireAdmin } from './admin-access.js';
import { staffBookingAccess } from './staff-access.js';
const minute = 60000;
const uid = (p: string) => `${p}_${randomUUID()}`;
export function lateInstant(b: Booking, now: number) {
  return (
    b.quote.bookingMode === 'INSTANT' &&
    b.quote.cancellationPolicy.instantDelayGraceMinutes !== undefined &&
    !!b.arrival &&
    !b.arrivedAt &&
    ['CONFIRMED', 'EN_ROUTE'].includes(b.status) &&
    now >= b.arrival.promisedAt + b.quote.cancellationPolicy.instantDelayGraceMinutes * minute
  );
}
async function log(
  tx: Records,
  actorId: string,
  action: string,
  target: string,
  now: number,
  bookingId?: string,
) {
  await tx.put('audit', {
    id: uid('audit'),
    actorId,
    action,
    detail: target,
    at: now,
    bookingId,
    bookingVersion: bookingId ? (await tx.get<Booking>('bookings', bookingId))?.version : undefined,
  });
  await tx.put('outbox', {
    id: uid('outbox'),
    type: action,
    target,
    bookingId,
    createdAt: now,
    status: 'PENDING',
    delivery: 'DEMO_LOCAL_ONLY',
  });
}
async function saveCheck(
  tx: Records,
  c: SafetyCheckIn,
  actorId: string,
  action: string,
  now: number,
) {
  await tx.put('safetyCheckIns', c);
  await tx.put('safetyCheckInHistory', {
    ...c,
    id: uid('checkin_event'),
    checkInId: c.id,
    actorId,
    action,
    at: now,
  });
  await log(tx, actorId, action, c.id, now, c.bookingId);
}
export async function sweepFulfillment(tx: Records, now: number) {
  const relevant = new Map(
    (await tx.find<Booking>('bookings', { status: ['CONFIRMED', 'EN_ROUTE', 'IN_SERVICE'] })).map(
      (b) => [b.id, b],
    ),
  );
  for (const check of await tx.find<SafetyCheckIn>('safetyCheckIns', {
    status: ['WAITING', 'SAFE', 'ESCALATED'],
  })) {
    if (!relevant.has(check.bookingId)) {
      const booking = await tx.get<Booking>('bookings', check.bookingId);
      if (booking) relevant.set(booking.id, booking);
    }
  }
  for (const b of relevant.values()) {
    if (lateInstant(b, now) && !(await tx.get('arrivalBreaches', b.id))) {
      await tx.put('arrivalBreaches', {
        id: b.id,
        bookingId: b.id,
        storeId: b.storeId,
        staffId: b.assignedStaffId,
        promisedAt: b.arrival!.promisedAt,
        createdAt: now,
      });
      await log(tx, 'system', 'INSTANT_ARRIVAL_BREACHED', b.id, now, b.id);
    }
    let c = await tx.get<SafetyCheckIn>('safetyCheckIns', b.id);
    if (b.status !== 'IN_SERVICE') {
      if (c && ['WAITING', 'SAFE'].includes(c.status)) {
        c.status = 'CLOSED';
        c.version++;
        await saveCheck(tx, c, 'system', 'SAFETY_CHECK_IN_CLOSED', now);
      }
      if (
        c?.status === 'ESCALATED' &&
        c.eventId &&
        (await tx.get<SafetyEvent>('safety', c.eventId))?.status === 'RESOLVED'
      ) {
        c.status = 'CLOSED';
        c.version++;
        await saveCheck(tx, c, 'system', 'SAFETY_CHECK_IN_CLOSED', now);
      }
      continue;
    }
    if (!b.assignedStaffId || !b.assignedListingId) continue;
    const due =
      (b.startedAt === undefined ? b.quote.endAt : b.startedAt + b.quote.endAt - b.quote.startAt) +
      15 * minute;
    if (!c && now >= due) {
      c = {
        id: b.id,
        bookingId: b.id,
        storeId: b.storeId,
        staffId: b.assignedStaffId,
        listingId: b.assignedListingId,
        status: 'WAITING',
        version: 1,
        round: 1,
        dueAt: due,
        escalateAt: due + 5 * minute,
      };
      await saveCheck(tx, c, 'system', 'SAFETY_CHECK_IN_REQUESTED', now);
    }
    if (!c) continue;
    if (
      c.status === 'ESCALATED' &&
      c.eventId &&
      (await tx.get<SafetyEvent>('safety', c.eventId))?.status === 'RESOLVED'
    ) {
      c.status = 'SAFE';
      c.safeAt = now;
      c.dueAt = now + 15 * minute;
      c.escalateAt = c.dueAt + 5 * minute;
      c.version++;
      await saveCheck(tx, c, 'system', 'SAFETY_CHECK_IN_REVIEWED', now);
    }
    if (c.status === 'SAFE' && now >= c.dueAt) {
      c.status = 'WAITING';
      c.round++;
      c.version++;
      c.escalateAt = c.dueAt + 5 * minute;
      c.safeAt = undefined;
      c.eventId = undefined;
      c.merchantContact = undefined;
      await saveCheck(tx, c, 'system', 'SAFETY_CHECK_IN_REQUESTED', now);
    }
    if (c.status === 'WAITING' && now >= c.escalateAt) {
      const eventId = uid('safety');
      await tx.put<SafetyEvent>('safety', {
        id: eventId,
        bookingId: b.id,
        staffId: b.assignedStaffId,
        storeId: b.storeId,
        type: 'MISSED_CHECK_IN',
        status: 'OPEN',
        createdAt: now,
        version: 1,
      });
      c.status = 'ESCALATED';
      c.eventId = eventId;
      c.version++;
      await saveCheck(tx, c, 'system', 'SAFETY_CHECK_IN_ESCALATED', now);
    }
  }
}
export class FulfillmentService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
  ) {}
  async delay(actor: Actor, bookingId: string, input: unknown) {
    const d = z
      .object({
        version: z.number().int().positive(),
        minutes: z.number().int().min(5).max(180),
        reason: z.enum(['TRAFFIC', 'PREVIOUS_VISIT', 'TRANSPORT', 'OTHER']),
      })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const b = await tx.get<Booking>('bookings', bookingId);
      ensure(b && (await staffBookingAccess(tx, actor, b)), 'NOT_FOUND', 'Task not found.', 404);
      ensure(b.version === d.version, 'VERSION_CONFLICT', 'The booking changed.', 409);
      ensure(
        ['CONFIRMED', 'EN_ROUTE'].includes(b.status) &&
          b.staffTaskStatus === 'ACKNOWLEDGED' &&
          b.replacementConsent !== 'PENDING',
        'INVALID_STATE',
        'Arrival updates are only available before arrival.',
        409,
      );
      const promisedAt =
        b.arrival?.promisedAt ??
        (b.quote.bookingMode === 'SCHEDULED' ? b.quote.startAt : undefined);
      ensure(
        promisedAt,
        'ARRIVAL_PROMISE_MISSING',
        'This legacy booking has no recorded arrival promise. Use order messages.',
        409,
      );
      const revisedAt = this.now() + d.minutes * minute;
      ensure(
        revisedAt >= promisedAt,
        'INVALID_ARRIVAL_ESTIMATE',
        'A delay report cannot move the estimate before its original promise.',
      );
      b.arrival = { ...b.arrival, promisedAt, revisedAt, reason: d.reason, reportedAt: this.now() };
      b.version++;
      b.updatedAt = this.now();
      await tx.put('bookings', b);
      await log(tx, actor.id, 'ARRIVAL_DELAY_REPORTED', b.id, this.now(), b.id);
      return b;
    });
  }
  async desk(actor: Actor): Promise<SafetyDesk> {
    return this.run(async (tx) => {
      if (actor.role === 'ADMIN') {
        actor = await currentAdmin(tx, actor);
        requireAdmin(actor, 'safety.write');
      }
      ensure(
        ['STAFF', 'MERCHANT', 'ADMIN'].includes(actor.role),
        'FORBIDDEN',
        'A service operations account is required.',
        403,
      );
      const checks: SafetyCheckInView[] = [];
      for (const c of (await tx.list<SafetyCheckIn>('safetyCheckIns'))
        .filter((c) => c.status !== 'CLOSED')
        .sort((a, b) => a.escalateAt - b.escalateAt)) {
        if (actor.role === 'MERCHANT' && actor.storeId !== c.storeId) continue;
        if (actor.role === 'STAFF') {
          const b = await tx.get<Booking>('bookings', c.bookingId);
          if (!b || !(await staffBookingAccess(tx, actor, b))) continue;
        }
        const { merchantContact, ...rest } = c;
        checks.push({
          ...rest,
          ...(merchantContact
            ? {
                merchantContact: {
                  at: merchantContact.at,
                  ...(actor.role !== 'STAFF' ? { note: merchantContact.note } : {}),
                },
              }
            : {}),
        });
      }
      const events = (await tx.list<SafetyEvent>('safety'))
        .filter(
          (e) =>
            e.status === 'OPEN' &&
            (actor.role === 'ADMIN' ||
              (actor.role === 'MERCHANT' && actor.storeId === e.storeId) ||
              (actor.role === 'STAFF' && checks.some((c) => c.eventId === e.id))),
        )
        .map((e) => ({
          id: e.id,
          bookingId: e.bookingId,
          staffId: e.staffId,
          storeId: e.storeId,
          type: e.type,
          status: e.status,
          createdAt: e.createdAt,
          version: e.version ?? 1,
        }));
      return { checks, events, now: this.now(), delivery: 'DEMO_LOCAL_ONLY' };
    });
  }
  async respond(actor: Actor, bookingId: string, input: unknown) {
    const d = z
      .object({ version: z.number().int().positive(), action: z.enum(['SAFE', 'NEED_HELP']) })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const b = await tx.get<Booking>('bookings', bookingId),
        c = await tx.get<SafetyCheckIn>('safetyCheckIns', bookingId);
      ensure(
        b && c && (await staffBookingAccess(tx, actor, b)),
        'NOT_FOUND',
        'Safety check-in not found.',
        404,
      );
      ensure(c.version === d.version, 'VERSION_CONFLICT', 'This safety check-in changed.', 409);
      ensure(
        b.status === 'IN_SERVICE' && ['WAITING', 'ESCALATED'].includes(c.status),
        'INVALID_STATE',
        'This check-in is no longer waiting for a response.',
        409,
      );
      if (d.action === 'NEED_HELP') {
        if (c.eventId) {
          const event = await tx.get<SafetyEvent>('safety', c.eventId);
          if (event?.status === 'OPEN' && event.type !== 'SOS') {
            event.type = 'SOS';
            event.version = (event.version ?? 1) + 1;
            await tx.put('safety', event);
          }
        }
        if (!c.eventId) {
          c.eventId = uid('safety');
          await tx.put<SafetyEvent>('safety', {
            id: c.eventId,
            bookingId: b.id,
            storeId: b.storeId,
            staffId: actor.staffId!,
            type: 'SOS',
            status: 'OPEN',
            version: 1,
            createdAt: this.now(),
          });
        }
        c.status = 'ESCALATED';
      } else {
        c.safeAt = this.now();
        if (c.status !== 'ESCALATED') {
          c.status = 'SAFE';
          c.dueAt = this.now() + 15 * minute;
          c.escalateAt = c.dueAt + 5 * minute;
        }
      }
      c.version++;
      await saveCheck(
        tx,
        c,
        actor.id,
        d.action === 'SAFE' ? 'SAFETY_CHECK_IN_SAFE' : 'SAFETY_CHECK_IN_HELP',
        this.now(),
      );
      return { status: c.status, version: c.version };
    });
  }
  async contact(actor: Actor, bookingId: string, input: unknown) {
    ensure(
      actor.role === 'MERCHANT',
      'FORBIDDEN',
      'Only the responsible shop can record contact.',
      403,
    );
    const d = z
      .object({ version: z.number().int().positive(), note: z.string().trim().min(10).max(500) })
      .strict()
      .parse(input);
    return this.run(async (tx) => {
      const c = await tx.get<SafetyCheckIn>('safetyCheckIns', bookingId);
      ensure(c && c.storeId === actor.storeId, 'NOT_FOUND', 'Safety check-in not found.', 404);
      ensure(c.version === d.version, 'VERSION_CONFLICT', 'This check-in changed.', 409);
      ensure(
        c.status === 'ESCALATED',
        'INVALID_STATE',
        'Contact records apply to escalated cases.',
        409,
      );
      c.merchantContact = { at: this.now(), actorId: actor.id, note: d.note };
      c.version++;
      await saveCheck(tx, c, actor.id, 'SAFETY_SHOP_CONTACT_RECORDED', this.now());
      return { version: c.version };
    });
  }
}
