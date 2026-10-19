import type {
  AdminBooking,
  AdminReview,
  Audit,
  Listing,
  Offering,
  SafetyEvent,
  Store,
  SupportTicket,
  TicketHandling,
  Actor,
  AdminAssignee,
} from '@hogulink/contracts';
import { japanDay } from './desktop-model';
export type AdminStore = Omit<Store, 'pspAccount'> & { pspReady: boolean };
export type AdminCase = Pick<
  SupportTicket,
  | 'id'
  | 'bookingId'
  | 'storeId'
  | 'category'
  | 'subject'
  | 'visibility'
  | 'priority'
  | 'status'
  | 'dueAt'
  | 'createdAt'
  | 'updatedAt'
>;
export type AdminFee = {
  id: string;
  storeId: string;
  bookingId: string;
  type: string;
  amount: number;
  createdAt?: number;
};
export type AdminWorkspace = {
  actor: Actor;
  assignees: AdminAssignee[];
  generatedAt: number;
  stores: AdminStore[];
  listings: Listing[];
  offerings: Offering[];
  bookings: AdminBooking[];
  feeEntries: AdminFee[];
  safety: SafetyEvent[];
  cases: AdminCase[];
  caseHandling: TicketHandling[];
  reviews: AdminReview[];
  audit: Audit[];
  system: {
    mode: string;
    payments: string;
    notifications: string;
    pending: number;
    oldestPendingAt: number | null;
    bufferMinutes: number;
    holdTtlSeconds: number;
    standardFeeBps: number;
    annualFeeBps: number;
    queue: { id: string; type: string; status: string; createdAt: number; delivery: string }[];
  };
};
export const activeCase = (c: AdminCase) => !['RESOLVED', 'CLOSED'].includes(c.status);
export function filterCaseWork(
  cases: AdminCase[],
  handling: TicketHandling[],
  input: { team: string; filter: string; actorId: string; now: number },
) {
  const work = new Map(handling.map((h) => [h.id, h]));
  const due = (c: AdminCase) =>
    activeCase(c) && (c.dueAt <= input.now || (work.get(c.id)?.followUpAt ?? c.dueAt) <= input.now);
  return cases
    .filter(
      (c) =>
        (!input.team || work.get(c.id)?.team === input.team) &&
        (input.filter === 'all' ||
          (activeCase(c) &&
            (input.filter === 'unassigned'
              ? !work.get(c.id)?.ownerId
              : input.filter === 'mine'
                ? work.get(c.id)?.ownerId === input.actorId
                : input.filter === 'followUpDue'
                  ? (work.get(c.id)?.followUpAt ?? c.dueAt) <= input.now
                  : c.dueAt <= input.now))),
    )
    .sort(
      (a, b) =>
        Number(activeCase(b)) - Number(activeCase(a)) ||
        Number(due(b)) - Number(due(a)) ||
        Number(b.priority === 'HIGH') - Number(a.priority === 'HIGH') ||
        (work.get(a.id)?.followUpAt ?? a.dueAt) - (work.get(b.id)?.followUpAt ?? b.dueAt),
    );
}
export const openOrder = (b: AdminBooking) =>
  !['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(b.status);
export function orderNeedsAttention(b: AdminBooking) {
  return (
    openOrder(b) &&
    (b.status === 'REQUESTED' ||
      (b.status === 'AWAITING_COMPLETION' && b.completion?.status !== 'PENDING') ||
      b.staffTaskStatus === 'OFFERED' ||
      b.noShow?.status === 'REPORTED' ||
      ['DECLINED', 'WITHDRAWN'].includes(b.staffTaskStatus) ||
      b.replacementConsent === 'PENDING')
  );
}
export function adminTrend(bookings: AdminBooking[], now = Date.now()) {
  return Array.from({ length: 7 }, (_, i) => {
    const day = japanDay(now - (6 - i) * 86400000);
    return { day, count: bookings.filter((b) => japanDay(b.createdAt) === day).length };
  });
}
export function financeTotals(bookings: AdminBooking[], fees: AdminFee[]) {
  const captured = bookings.reduce((n, b) => n + b.capturedAmount, 0),
    refunded = bookings.reduce((n, b) => n + b.refundedAmount, 0),
    platform = fees.reduce((n, f) => n + f.amount, 0);
  return {
    captured,
    refunded,
    net: captured - refunded,
    platform,
    afterFees: captured - refunded - platform,
  };
}
export function liveListing(x: Listing, stores: AdminStore[]) {
  const store = stores.find((s) => s.id === x.storeId);
  return (
    !!store?.active &&
    store.approved &&
    store.pspReady &&
    x.membershipActive &&
    x.identityVerified &&
    x.portraitConsent &&
    x.publicationStatus === 'PUBLISHED_INDEXABLE'
  );
}
export function filterAdminOrders(
  bookings: AdminBooking[],
  input: {
    search: string;
    storeId: string;
    status: string;
    period: string;
    now?: number;
    describe: (b: AdminBooking) => string;
  },
) {
  const today = japanDay(input.now ?? Date.now()),
    query = input.search.trim().toLowerCase();
  return bookings.filter(
    (b) =>
      (!input.storeId || b.storeId === input.storeId) &&
      (input.status === 'all' ||
        (input.status === 'attention' ? orderNeedsAttention(b) : b.status === input.status)) &&
      (!query || `${b.id} ${input.describe(b)}`.toLowerCase().includes(query)) &&
      (input.period === 'all' ||
        (input.period === 'today'
          ? japanDay(b.quote.startAt) === today
          : openOrder(b) && b.quote.startAt >= (input.now ?? Date.now()))),
  );
}
