import {
  fulfillmentMode,
  type Booking,
  type Hold,
  type Quote,
  type Store,
  type Listing,
  venueAvailable,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { config } from './config.js';

export const resourceKey = (storeId: string, resourceId: string) =>
  `venue:${storeId}:${resourceId}`;
/**
 * When a visit that is under way frees its therapist and bed. One that ran past its full
 * duration is still going, so it keeps the next stretch free but does not hide later days.
 */
const occupiedUntil = (b: Booking, now: number) => {
  const end =
    b.startedAt !== undefined ? b.startedAt + b.quote.endAt - b.quote.startAt : b.quote.endAt;
  return end > now ? end : now + config.bufferMinutes * 60_000;
};
export async function availableResources(
  tx: Records,
  store: Store,
  q: Quote,
  now: number,
  exceptHold = '',
  existingReservation = false,
  requiredResource?: string,
) {
  if ((!existingReservation && !venueAvailable(store)) || !store.venue) return [];
  const running = await tx.find<Booking>('bookings', { storeId: store.id, status: 'IN_SERVICE' });
  for (const resource of store.venue.resources.filter(
    (r) => r.active && (!requiredResource || r.id === requiredResource),
  )) {
    const turnover = (q.venue?.turnoverMinutes ?? store.venue.turnoverMinutes) * 60_000;
    if (
      running.some(
        (b) =>
          b.holdId !== exceptHold &&
          b.resourceId === resource.id &&
          occupiedUntil(b, now) + turnover > q.startAt,
      )
    )
      continue;
    const key = resourceKey(store.id, resource.id);
    const clean = await tx.get<{ id: string; startAt: number; endAt: number }>(
      'venueTurnovers',
      key,
    );
    if (clean && clean.startAt < q.endAt && clean.endAt > q.startAt) continue;
    if (
      !(await tx.conflicts(
        key,
        q.startAt,
        q.endAt + (q.venue?.turnoverMinutes ?? store.venue.turnoverMinutes) * 60_000,
        `resource:${exceptHold}`,
      ))
    )
      return [resource.id];
  }
  return [];
}
export async function reserveResource(tx: Records, q: Quote, h: Hold) {
  if (!h.resourceId) return;
  await tx.interval({
    id: `resource:${h.id}`,
    staffId: resourceKey(q.storeId, h.resourceId),
    startAt: q.startAt,
    endAt: q.endAt + (q.venue?.turnoverMinutes ?? 0) * 60_000,
    expiresAt: h.expiresAt,
  });
}
/** Staff share one calendar, including travel between different shops. */
export async function transitionAvailable(
  tx: Records,
  staffId: string,
  q: Quote,
  now: number,
  exceptHold = '',
) {
  const running = await tx.find<Booking>('bookings', {
    assignedStaffId: staffId,
    status: ['IN_SERVICE', 'EN_ROUTE', 'ARRIVED'],
  });
  if (
    running.some(
      (b) =>
        b.holdId !== exceptHold &&
        (b.startedAt !== undefined || b.quote.endAt <= now) &&
        occupiedUntil(b, now) > q.startAt,
    )
  )
    return false;
  const fitsTransition = (other: Quote) => {
    if (
      fulfillmentMode(q) !== 'IN_STORE' ||
      fulfillmentMode(other) !== 'IN_STORE' ||
      q.storeId === other.storeId
    )
      return true;
    const gap =
      q.endAt <= other.startAt
        ? other.startAt - q.endAt
        : other.endAt <= q.startAt
          ? q.startAt - other.endAt
          : -1;
    return gap >= 30 * 60_000;
  };
  for (const h of await tx.find<Hold>('holds', { staffId, active: true })) {
    if (h.id === exceptHold) continue;
    const other = await tx.get<Quote>('quotes', h.quoteId);
    if (!other) continue;
    const started = running.find((b) => b.holdId === h.id && b.startedAt !== undefined);
    if (
      !fitsTransition(
        started
          ? {
              ...other,
              startAt: started.startedAt!,
              endAt: started.startedAt! + other.endAt - other.startAt,
            }
          : other,
      )
    )
      return false;
  }
  if (fulfillmentMode(q) === 'IN_STORE')
    for (const proposal of await tx.find<Booking>('bookings', {
      replacementConsent: 'PENDING',
      status: ['ACCEPTED', 'CONFIRMED'],
    })) {
      if (proposal.holdId === exceptHold || !proposal.proposedListingId) continue;
      const candidate = await tx.get<Listing>('listings', proposal.proposedListingId);
      if (candidate?.staffId === staffId && !fitsTransition(proposal.quote)) return false;
    }
  return true;
}
