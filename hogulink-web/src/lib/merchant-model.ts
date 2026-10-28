import type { Booking, Locale } from '@hogulink/contracts';
import { statusText } from './i18n';
import { mo } from './merchant-operations-i18n';
export function merchantBookingStatus(l: Locale, b: Booking) {
  return b.status === 'ACCEPTED' && !b.assignedStaffId ? mo(l, 'assign') : statusText(l, b.status);
}
import { japanDay, needsAttention } from './desktop-model';
export function merchantAttentionKeys(bookings: Booking[], now = Date.now()) {
  return new Set(
    bookings
      .filter((b) => needsAttention(b, 'MERCHANT'))
      .map(
        (b) =>
          `${b.id}:${b.status}:${b.staffTaskStatus}:${b.replacementConsent}:${['REQUESTED', 'ACCEPTED'].includes(b.status) && b.deadline > now && b.deadline - now <= 300000 ? 'due' : 'open'}`,
      ),
  );
}
export function merchantNewAttention(
  previous: ReadonlySet<string> | null,
  next: ReadonlySet<string>,
) {
  return previous === null ? 0 : [...next].filter((id) => !previous.has(id)).length;
}
export type FeeEntry = {
  id: string;
  storeId: string;
  bookingId: string;
  type: string;
  amount: number;
  createdAt?: number;
};
export function merchantNumbers(bookings: Booking[], fees: FeeEntry[], now = Date.now()) {
  const captured = bookings.reduce((n, b) => n + b.capturedAmount, 0),
    refunded = bookings.reduce((n, b) => n + b.refundedAmount, 0),
    platform = fees.reduce((n, f) => n + f.amount, 0);
  return {
    today: bookings.filter(
      (b) =>
        japanDay(b.quote.startAt) === japanDay(now) &&
        !['CANCELLED', 'EXPIRED', 'REJECTED'].includes(b.status),
    ).length,
    captured,
    refunded,
    net: captured - refunded,
    platform,
    afterFees: captured - refunded - platform,
  };
}
export function merchantTrend(bookings: Booking[], now = Date.now()) {
  return Array.from({ length: 7 }, (_, i) => {
    const day = japanDay(now - (6 - i) * 86400_000);
    return { day, count: bookings.filter((b) => japanDay(b.createdAt) === day).length };
  });
}
export function japanInput(at: number) {
  return new Date(at + 9 * 3600_000).toISOString().slice(0, 16);
}
export function parseJapanInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return NaN;
  const at = Date.parse(value + ':00+09:00');
  return Number.isFinite(at) && japanInput(at) === value ? at : NaN;
}
