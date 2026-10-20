import type { Booking, Locale } from '@hogulink/contracts';

/** Count down a server snapshot using monotonic elapsed time, not the device's wall clock. */
export function holdSecondsRemaining(
  expiresAt: number,
  serverNow: number,
  elapsedMs: number,
  active = true,
) {
  return active
    ? Math.max(0, Math.floor((expiresAt - serverNow - Math.max(0, elapsedMs)) / 1000))
    : 0;
}

/** A selected late time stays visible when the time grid is collapsed. */
export function visibleVisitTimes(
  times: number[],
  selected: number,
  expanded: boolean,
  limit: number,
) {
  if (expanded) return times;
  const visible = times.slice(0, limit);
  if (times.includes(selected) && !visible.includes(selected))
    return [...visible.slice(0, Math.max(0, limit - 1)), selected];
  return visible;
}

export function visitTimeRange(locale: Locale, start: number, end: number) {
  const common = {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  } as const;
  const date = new Intl.DateTimeFormat(locale, { ...common, month: 'short', day: 'numeric' });
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const last =
    day.format(start) === day.format(end)
      ? new Intl.DateTimeFormat(locale, common).format(end)
      : date.format(end);
  return `${date.format(start)} – ${last} JST`;
}

/** Cancellation never marks fulfillment or customer acceptance as completed. */
export function customerBookingStage(
  booking: Pick<Booking, 'status' | 'staffTaskStatus' | 'replacementConsent'>,
): number | null {
  if (['CANCELLED', 'REJECTED', 'EXPIRED'].includes(booking.status)) return null;
  if (booking.status === 'COMPLETED') return 5;
  if (booking.status === 'AWAITING_COMPLETION') return 4;
  if (booking.status === 'IN_SERVICE') return 3;
  if (booking.status === 'REQUESTED') return 0;
  if (booking.replacementConsent === 'PENDING' || booking.staffTaskStatus !== 'ACKNOWLEDGED')
    return 1;
  return 2;
}
