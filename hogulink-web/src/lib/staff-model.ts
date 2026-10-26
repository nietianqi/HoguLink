import type { Booking } from '@hogulink/contracts';
import { japanDay } from './desktop-model';
export const isOpenTask = (b: Booking) =>
  !['COMPLETED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(b.status);
export const canRespond = (b: Booking) =>
  isOpenTask(b) &&
  ['ACCEPTED', 'CONFIRMED'].includes(b.status) &&
  b.staffTaskStatus === 'OFFERED' &&
  b.replacementConsent !== 'PENDING';
export const canProgress = (b: Booking) =>
  ['CONFIRMED', 'EN_ROUTE', 'ARRIVED', 'IN_SERVICE'].includes(b.status) &&
  b.staffTaskStatus === 'ACKNOWLEDGED' &&
  b.replacementConsent !== 'PENDING';
export const nextEvent = (b: Booking) =>
  canProgress(b) &&
  !(b.quote?.fulfillmentMode === 'IN_STORE' && b.status === 'CONFIRMED' && !b.checkIn)
    ? (
        {
          CONFIRMED: b.quote?.fulfillmentMode === 'IN_STORE' ? 'START' : 'EN_ROUTE',
          EN_ROUTE: 'ARRIVED',
          ARRIVED: 'START',
          IN_SERVICE: 'COMPLETE',
        } as Record<string, string>
      )[b.status]
    : undefined;
export function staffNumbers(bookings: Booking[], now = Date.now()) {
  return {
    pending: bookings.filter(canRespond).length,
    today: bookings.filter(
      (b) =>
        japanDay(b.quote.startAt) === japanDay(now) && (isOpenTask(b) || b.status === 'COMPLETED'),
    ).length,
    minutes: bookings
      .filter((b) => b.status === 'COMPLETED')
      .reduce((n, b) => n + Math.round((b.quote.endAt - b.quote.startAt) / 60000), 0),
  };
}
export function focusTask(bookings: Booking[]) {
  return [...bookings].filter(isOpenTask).sort((a, b) => {
    const priority = (x: Booking) =>
      canProgress(x) && ['EN_ROUTE', 'ARRIVED', 'IN_SERVICE'].includes(x.status)
        ? 0
        : canRespond(x)
          ? 1
          : canProgress(x)
            ? 2
            : 3;
    return (
      priority(a) - priority(b) ||
      (canRespond(a) ? a.deadline - b.deadline : a.quote.startAt - b.quote.startAt)
    );
  })[0];
}
