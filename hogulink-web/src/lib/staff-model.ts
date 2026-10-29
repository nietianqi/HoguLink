import { travelRecordOpensAt, type Booking } from '@hogulink/contracts';
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
export const staffCanMessage = (b: Booking) => canProgress(b);
export function staffTravelReady(b: Booking, now: number) {
  const opensAt = travelRecordOpensAt(b.quote);
  return opensAt === undefined || now >= opensAt;
}
/** Attention keys change once when a new offer arrives or its response becomes urgent. */
export function staffAttentionKeys(bookings: Booking[], now: number) {
  return new Set(
    bookings
      .filter(canRespond)
      .map((b) => `${b.id}:${b.deadline}:${b.deadline - now <= 5 * 60000 ? 'due' : 'offer'}`),
  );
}
export function staffNewAttention(previous: Set<string> | null, current: Set<string>) {
  return previous ? [...current].filter((key) => !previous.has(key)).length : 0;
}
export function staffPerformance(bookings: Booking[], now: number) {
  const month = japanDay(now).slice(0, 7);
  const completed = bookings.filter(
    (b) => b.status === 'COMPLETED' && japanDay(b.quote.startAt).slice(0, 7) === month,
  );
  return {
    month,
    completed: completed.length,
    minutes: completed.reduce(
      (sum, b) => sum + Math.round((b.quote.endAt - b.quote.startAt) / 60000),
      0,
    ),
  };
}
export const staffProfileSections = ['public', 'media', 'settings', 'performance'] as const;
export type StaffProfileSection = (typeof staffProfileSections)[number];
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
