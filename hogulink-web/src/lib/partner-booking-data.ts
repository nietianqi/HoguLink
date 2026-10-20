import type { Audit, Booking, Listing, SafetyEvent, Store } from '@hogulink/contracts';
import { api, type Catalog } from './api';

export type PartnerDashboard = {
  stores: Store[];
  listings: Listing[];
  safety: SafetyEvent[];
  audit: Audit[];
  feeEntries: { id: string; storeId: string; amount: number; bookingId: string; type: string }[];
  outboxPending: number;
};

/** Orders stay usable while optional profiles and dashboard summaries recover. */
export async function loadPartnerBookings(role: string, bookingId?: string) {
  const orders = bookingId
    ? api<Booking>(`bookings/${encodeURIComponent(bookingId)}`).then((booking) => [booking])
    : api<Booking[]>('bookings');
  const catalog = api<Catalog>('public/staff-listings').catch(() => undefined);
  const dashboard =
    role === 'MERCHANT' || role === 'ADMIN'
      ? api<PartnerDashboard>('dashboard').catch(() => undefined)
      : Promise.resolve(undefined);
  return { bookings: await orders, catalog, dashboard };
}
