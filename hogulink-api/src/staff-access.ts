import type { Actor, Booking, Listing } from '@hogulink/contracts';
import type { Records } from './repository.js';

// Publication controls new discovery. Active membership controls access to existing work.
export async function activeStaffMembership(
  tx: Records,
  actor: Actor,
  storeId = actor.storeId,
  listingId?: string,
) {
  if (actor.role !== 'STAFF' || !actor.staffId || !actor.storeId || actor.storeId !== storeId)
    return false;
  return (await tx.list<Listing>('listings')).some(
    (l) =>
      l.staffId === actor.staffId &&
      l.membershipActive &&
      (!storeId || l.storeId === storeId) &&
      (!listingId || l.id === listingId),
  );
}
export async function staffBookingAccess(tx: Records, actor: Actor, booking: Booking) {
  return (
    actor.role === 'STAFF' &&
    actor.staffId === booking.assignedStaffId &&
    !!booking.assignedListingId &&
    activeStaffMembership(tx, actor, booking.storeId, booking.assignedListingId)
  );
}
