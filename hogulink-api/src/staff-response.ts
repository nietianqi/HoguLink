import type { Booking } from '@hogulink/contracts';

function pick<T, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) result[key] = value[key];
  return result;
}

/** Explicit transport view: domain bookings retain their financial records internally. */
export function staffBookingView(booking: Booking) {
  return {
    ...pick(booking, [
      'id',
      'storeId',
      'selectedStaffId',
      'selectedStaffListingId',
      'assignedStaffId',
      'assignedListingId',
      'status',
      'merchantAcceptance',
      'staffTaskStatus',
      'acceptanceMode',
      'paymentStatus',
      'paymentActionBy',
      'replacementConsent',
      'proposedListingId',
      'replacementDeadline',
      'cancelReason',
      'address',
      'contact',
      'resourceId',
      'checkIn',
      'resourceName',
      'legalNameSnapshot',
      'deadline',
      'version',
      'createdAt',
      'updatedAt',
      'arrivalMinutes',
      'arrivedAt',
      'startedAt',
      'completedAt',
      'arrival',
    ]),
    quote: pick(booking.quote, [
      'fulfillmentMode',
      'venue',
      'completionPolicy',
      'id',
      'listingId',
      'storeId',
      'offeringId',
      'offeringVersion',
      'serviceName',
      'regulatoryCategory',
      'storeRuleVersion',
      'bookingRulesVersion',
      'startAt',
      'endAt',
      'expiresAt',
      'bookingMode',
      'nominationType',
      'area',
      'requiredLanguage',
      'serviceFee',
      'promotionId',
      'regularServiceFee',
      'nominationFee',
      'transportFee',
      'timeSurcharge',
      'total',
      'cancellationPolicy',
    ]),
    completion: booking.completion && {
      ...pick(booking.completion, [
        'status',
        'eligibleAt',
        'timingInvalid',
        'endedAt',
        'requestedAt',
        'confirmBy',
        'confirmedAt',
        'autoConfirmed',
        'reviewStatus',
      ]),
      history: booking.completion.history.map(({ note, ...entry }) =>
        entry.role === 'STAFF' ? { ...entry, note } : entry,
      ),
    },
    noShow:
      booking.noShow &&
      pick(booking.noShow, [
        'status',
        'startedAt',
        'waitUntil',
        'contacts',
        'reportedAt',
        'resolvedAt',
        'fee',
      ]),
  };
}

/** Covers list, detail, mutations and booking envelopes without changing other roles. */
export function staffResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(staffResponse);
  if (!value || typeof value !== 'object') return value;
  if ('quote' in value && 'staffTaskStatus' in value && 'merchantAcceptance' in value)
    return staffBookingView(value as Booking);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, staffResponse(item)]));
}
