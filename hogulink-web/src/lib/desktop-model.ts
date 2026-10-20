import { effectiveServicePrice } from '@hogulink/contracts';
import type { Booking, Listing, Offering, Role } from '@hogulink/contracts';

export function japanDay(time: number): string {
  return new Date(time + 9 * 3600_000).toISOString().slice(0, 10);
}
export function matchingOffering(listing: Listing, offerings: Offering[], duration: number) {
  return offerings
    .filter((o) => listing.offeringIds.includes(o.id) && o.durationMinutes === duration)
    .sort(
      (a, b) =>
        effectiveServicePrice(a, Date.now()).price +
        a.transportFee -
        effectiveServicePrice(b, Date.now()).price -
        b.transportFee,
    )[0];
}
/** Nominated total at the price charged now (a live shop promotion is applied). */
export const nominatedTotal = (offering: Offering, fee = 500, now = Date.now()) =>
  effectiveServicePrice(offering, now).price + offering.transportFee + fee;
export function needsAttention(b: Booking, role: Role): boolean {
  if (['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(b.status)) return false;
  if (role === 'CUSTOMER')
    return (
      b.status === 'AWAITING_COMPLETION' ||
      (b.replacementConsent === 'PENDING' && !!b.proposedListingId)
    );
  if (role === 'STAFF') return b.staffTaskStatus === 'OFFERED';
  return (
    b.status === 'REQUESTED' ||
    (b.status === 'AWAITING_COMPLETION' && b.completion?.status !== 'PENDING') ||
    b.noShow?.status === 'REPORTED' ||
    (b.status === 'ACCEPTED' && !b.assignedStaffId) ||
    ['DECLINED', 'WITHDRAWN', 'EXPIRED'].includes(b.staffTaskStatus)
  );
}
export type BookingFilter = 'all' | 'attention' | 'active' | 'completed' | 'closed';
export function filterBookings(
  bookings: Booking[],
  options: {
    role: Role;
    status: BookingFilter;
    search: string;
    period: string;
    now?: number;
    describe: (b: Booking) => string;
  },
) {
  const now = options.now ?? Date.now();
  const search = options.search.trim().toLocaleLowerCase();
  return bookings
    .filter((b) => {
      const closed = ['CANCELLED', 'EXPIRED', 'REJECTED'].includes(b.status);
      if (options.status === 'attention' && !needsAttention(b, options.role)) return false;
      if (options.status === 'active' && (closed || b.status === 'COMPLETED')) return false;
      if (options.status === 'completed' && b.status !== 'COMPLETED') return false;
      if (options.status === 'closed' && !closed) return false;
      if (options.period === 'today' && japanDay(b.quote.startAt) !== japanDay(now)) return false;
      if (
        options.period === 'upcoming' &&
        (b.quote.startAt < now || closed || b.status === 'COMPLETED')
      )
        return false;
      return !search || `${b.id} ${options.describe(b)}`.toLocaleLowerCase().includes(search);
    })
    .sort(
      (a, b) =>
        Number(needsAttention(b, options.role)) - Number(needsAttention(a, options.role)) ||
        b.createdAt - a.createdAt,
    );
}
// Protect spreadsheet consumers from formula injection in exported labels.
export function csvCell(value: string | number) {
  const text = String(value);
  return `"${(typeof value === 'string' && /^[\s]*[=+@-]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
}
