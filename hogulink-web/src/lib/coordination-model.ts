import type { Booking } from '@hogulink/contracts';
import type { CoordinationText } from './coordination-i18n';
/** A terminal cancellation never implies that the visit or customer approval happened. */
export function workOrderStage(b: Booking): number | null {
  if (['CANCELLED', 'REJECTED', 'EXPIRED'].includes(b.status)) return null;
  if (b.status === 'COMPLETED') return 4;
  if (b.status === 'AWAITING_COMPLETION') return 3;
  if (b.status === 'REQUESTED') return 0;
  if (b.replacementConsent === 'PENDING' || b.staffTaskStatus !== 'ACKNOWLEDGED') return 1;
  return 2;
}
export function nextWork(b: Booking): CoordinationText {
  if (['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(b.status)) return 'closed';
  if (b.status === 'AWAITING_COMPLETION')
    return b.completion?.status === 'PENDING' ? 'completionPending' : 'completionReview';
  if (b.status === 'REQUESTED') return 'accept';
  if (b.replacementConsent === 'PENDING' && b.proposedListingId) return 'consent';
  if (b.staffTaskStatus === 'NOT_SENT' && b.replacementConsent !== 'PENDING') return 'assign';
  if (
    ['DECLINED', 'WITHDRAWN', 'EXPIRED', 'NOT_SENT'].includes(b.staffTaskStatus) ||
    b.replacementConsent === 'PENDING'
  )
    return 'arrange';
  return b.staffTaskStatus === 'OFFERED' ? 'confirm' : 'visit';
}
