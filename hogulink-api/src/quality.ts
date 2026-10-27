import { z } from 'zod';
import {
  fulfillmentMode,
  type Actor,
  type Booking,
  type Listing,
  type SafetyEvent,
  type Store,
  type SupportTicket,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { currentAdmin, requireAdmin } from './admin-access.js';

/** Starting thresholds for shop follow-up; tune with operating data before enforcing penalties. */
export const qualityThresholds = {
  minOrders: 10,
  shopFailRate: 0.1,
  customerFeeRate: 0.05,
  complaintRate: 0.1,
} as const;
const activeStatuses = ['REQUESTED', 'ACCEPTED', 'CONFIRMED', 'EN_ROUTE', 'ARRIVED', 'IN_SERVICE'];
const shopReasons = ['MERCHANT_UNABLE', 'PROVIDER_ARRIVAL_DELAY'];
export type ShopQualityRow = {
  storeId: string;
  name: Store['name'];
  orders: number;
  completed: number;
  shopCancelled: number;
  expired: number;
  customerFees: number;
  disputes: number;
  complaints: number;
  safetyEvents: number;
  flags: ('SHOP_FAILURES' | 'CUSTOMER_FEES' | 'COMPLAINTS' | 'SAFETY')[];
};
export type SuspensionImpact = {
  targetType: 'STORE' | 'LISTING' | 'VENUE';
  targetId: string;
  storeId: string;
  name: Store['name'] | Listing['name'];
  bookings: { id: string; startAt: number; status: Booking['status']; mode: string }[];
};

/** Platform views for supply governance; they read booking facts only, never customer details. */
export class QualityService {
  constructor(
    private read: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
  ) {}
  async shops(actor: Actor, input: unknown): Promise<ShopQualityRow[]> {
    const { days } = z
      .object({ days: z.coerce.number().int().min(7).max(365).default(30) })
      .parse(input ?? {});
    return this.read(async (tx) => {
      requireAdmin(await currentAdmin(tx, actor), 'supply.read');
      const since = this.now() - days * 86_400_000;
      const bookings = (await tx.list<Booking>('bookings')).filter((b) => b.createdAt >= since);
      const tickets = (await tx.list<SupportTicket>('supportTickets')).filter(
        (t) => t.createdAt >= since,
      );
      const safety = (await tx.list<SafetyEvent>('safety')).filter((s) => s.createdAt >= since);
      const storeOf = new Map(bookings.map((b) => [b.id, b.storeId]));
      const rows = (await tx.list<Store>('stores'))
        .filter((s) => s.approved)
        .map((store): ShopQualityRow => {
          const own = bookings.filter((b) => b.storeId === store.id);
          const row: ShopQualityRow = {
            storeId: store.id,
            name: store.name,
            orders: own.length,
            completed: own.filter((b) => b.status === 'COMPLETED').length,
            shopCancelled: own.filter(
              (b) =>
                b.status === 'REJECTED' ||
                (b.status === 'CANCELLED' && shopReasons.includes(b.cancelReason ?? '')),
            ).length,
            expired: own.filter((b) => b.status === 'EXPIRED').length,
            // Fees the shop itself starts: confirmed no-shows and late-arrival closures.
            customerFees: own.filter(
              (b) => b.noShow?.status === 'CONFIRMED' || b.cancelReason === 'CUSTOMER_LATE_ARRIVAL',
            ).length,
            disputes: own.filter((b) =>
              b.completion?.history.some((h) => h.action === 'DISPUTE' || h.action === 'EXCEPTION'),
            ).length,
            complaints: tickets.filter(
              (t) =>
                (t.storeId ?? (t.bookingId ? storeOf.get(t.bookingId) : undefined)) === store.id,
            ).length,
            safetyEvents: safety.filter((s) => s.storeId === store.id).length,
            flags: [],
          };
          const enough = row.orders >= qualityThresholds.minOrders;
          if (
            enough &&
            (row.shopCancelled + row.expired) / row.orders > qualityThresholds.shopFailRate
          )
            row.flags.push('SHOP_FAILURES');
          if (enough && row.customerFees / row.orders > qualityThresholds.customerFeeRate)
            row.flags.push('CUSTOMER_FEES');
          if (enough && row.complaints / row.orders > qualityThresholds.complaintRate)
            row.flags.push('COMPLAINTS');
          if (row.safetyEvents) row.flags.push('SAFETY');
          return row;
        });
      return rows.sort((a, b) => b.flags.length - a.flags.length || b.orders - a.orders);
    });
  }
  /** Bookings still open under a suspended shop, therapist or venue, for aftercare. */
  async suspensionImpact(actor: Actor): Promise<SuspensionImpact[]> {
    return this.read(async (tx) => {
      requireAdmin(await currentAdmin(tx, actor), 'supply.read');
      const open = (await tx.list<Booking>('bookings')).filter((b) =>
        activeStatuses.includes(b.status),
      );
      const view = (list: Booking[]) =>
        list
          .map((b) => ({
            id: b.id,
            startAt: b.quote.startAt,
            status: b.status,
            mode: fulfillmentMode(b.quote),
          }))
          .sort((a, b) => a.startAt - b.startAt);
      const result: SuspensionImpact[] = [];
      for (const store of await tx.list<Store>('stores')) {
        if (store.approved && !store.active) {
          const affected = open.filter((b) => b.storeId === store.id);
          if (affected.length)
            result.push({
              targetType: 'STORE',
              targetId: store.id,
              storeId: store.id,
              name: store.name,
              bookings: view(affected),
            });
        } else if (store.venue?.suspension) {
          const affected = open.filter(
            (b) => b.storeId === store.id && fulfillmentMode(b.quote) === 'IN_STORE',
          );
          if (affected.length)
            result.push({
              targetType: 'VENUE',
              targetId: store.id,
              storeId: store.id,
              name: store.name,
              bookings: view(affected),
            });
        }
      }
      for (const listing of await tx.list<Listing>('listings')) {
        if (listing.publicationStatus !== 'SUSPENDED') continue;
        const affected = open.filter((b) => b.assignedListingId === listing.id);
        if (affected.length)
          result.push({
            targetType: 'LISTING',
            targetId: listing.id,
            storeId: listing.storeId,
            name: listing.name,
            bookings: view(affected),
          });
      }
      return result;
    });
  }
}
