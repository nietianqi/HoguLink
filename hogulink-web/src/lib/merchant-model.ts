import type { Booking } from '@hogulink/contracts';
import { japanDay } from './desktop-model';
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
