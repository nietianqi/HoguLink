import type { Booking } from '@hogulink/contracts';
import type { PcConsumerText } from './pc-consumer-i18n';

/** Customer wording uses fulfillment and parallel decisions, never the staff's task instructions. */
export function customerNextStep(b: Booking): {
  key: PcConsumerText;
  deadline?: number;
  target: string;
  action: PcConsumerText;
} {
  const overview = `#order-overview-${b.id}`;
  if (['CANCELLED', 'EXPIRED', 'REJECTED'].includes(b.status))
    return { key: 'closed', target: overview, action: 'viewService' };
  if (b.status === 'COMPLETED')
    return { key: 'completed', target: `#aftercare-${b.id}`, action: 'support' };
  if (b.status === 'AWAITING_COMPLETION')
    return {
      key: b.completion?.status === 'PENDING' ? 'completion' : 'completionReview',
      target: `#customer-completion-${b.id}`,
      action: 'reviewService',
    };
  if (b.paymentStatus === 'FAILED' && b.paymentActionBy && b.status !== 'IN_SERVICE')
    return {
      key: 'paymentAction',
      deadline: b.paymentActionBy,
      target: `#customer-guarantee-${b.id}`,
      action: 'viewService',
    };
  if (b.replacementConsent === 'PENDING')
    return {
      key: b.proposedListingId ? 'replacement' : 'arranging',
      deadline: b.replacementDeadline ?? b.deadline,
      target: `#customer-replacement-${b.id}`,
      action: b.proposedListingId ? 'reviewReplacement' : 'viewService',
    };
  if (b.status === 'REQUESTED')
    return { key: 'waitingShop', deadline: b.deadline, target: overview, action: 'viewService' };
  if (b.status === 'IN_SERVICE') return { key: 'serving', target: overview, action: 'viewService' };
  if (b.status === 'EN_ROUTE') return { key: 'onWay', target: overview, action: 'viewService' };
  if (b.status === 'ARRIVED') return { key: 'arrived', target: overview, action: 'viewService' };
  if (b.staffTaskStatus !== 'ACKNOWLEDGED')
    return {
      key: ['DECLINED', 'WITHDRAWN', 'EXPIRED', 'NOT_SENT'].includes(b.staffTaskStatus)
        ? 'arranging'
        : 'waitingTherapist',
      deadline: b.deadline,
      target: overview,
      action: 'viewService',
    };
  if (b.quote.fulfillmentMode === 'IN_STORE')
    return {
      key: b.checkIn ? 'checkedIn' : 'storeReady',
      target: `#customer-venue-${b.id}`,
      action: 'viewVenue',
    };
  return { key: 'homeReady', target: overview, action: 'viewService' };
}

export function customerShowAmounts(data: {
  captured: number;
  refunded: number;
  requests: unknown[];
}) {
  return data.captured > 0 || data.refunded > 0 || data.requests.length > 0;
}
