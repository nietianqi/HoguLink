import type { Booking } from '@hogulink/contracts';
import { needsAttention } from './desktop-model';
export function merchantWorkday(bookings: Booking[]) {
  const live = bookings.filter(
    (b) => !['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(b.status),
  );
  return {
    attention: live
      .filter(
        (b) =>
          needsAttention(b, 'MERCHANT') &&
          !(b.replacementConsent === 'PENDING' && b.proposedListingId),
      )
      .sort((a, b) => a.deadline - b.deadline || a.quote.startAt - b.quote.startAt),
    waitingStaff: live
      .filter((b) => b.staffTaskStatus === 'OFFERED' && b.replacementConsent !== 'PENDING')
      .sort((a, b) => a.deadline - b.deadline),
    waitingCustomer: live
      .filter(
        (b) =>
          (b.replacementConsent === 'PENDING' && !!b.proposedListingId) ||
          (b.status === 'AWAITING_COMPLETION' && b.completion?.status === 'PENDING'),
      )
      .sort(
        (a, b) => (a.replacementDeadline ?? a.deadline) - (b.replacementDeadline ?? b.deadline),
      ),
  };
}
