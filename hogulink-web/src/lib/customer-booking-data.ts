import type { Booking } from '@hogulink/contracts';
import { api, type Catalog } from './api';

/** Public profiles enrich an order; their availability never controls order access. */
export async function loadCustomerBookings(bookingId?: string) {
  const orders = bookingId
    ? api<Booking>(`bookings/${encodeURIComponent(bookingId)}`).then((booking) => [booking])
    : api<Booking[]>('bookings');
  const catalog = api<Catalog>('public/staff-listings?fulfillmentMode=ALL').catch(() => undefined);
  return {
    bookings: await orders,
    catalog,
  };
}
