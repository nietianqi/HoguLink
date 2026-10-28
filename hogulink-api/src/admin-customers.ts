import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  Actor,
  AdminBooking,
  AdminCustomerProfile,
  AdminCustomerSearch,
  AdminCustomerSummary,
  Audit,
  Booking,
  CustomerRestriction,
  SupportTicket,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { adminCaseVisible } from './admin-access.js';
import { canAdmin } from '@hogulink/contracts';
import { ensure } from './errors.js';

type Account = {
  id: string;
  name: string;
  email: string;
  status: 'ACTIVE' | 'DISABLED';
  verifiedAt?: number;
  createdAt: number;
};

export function adminBookingView({
  address: _address,
  contact: _contact,
  checkInCode: _checkInCode,
  customerId: _customer,
  paymentId: _payment,
  holdId: _hold,
  quote,
  ...b
}: Booking): AdminBooking {
  const { customerId: _quoteCustomer, ...safeQuote } = quote;
  return {
    ...b,
    completion: b.completion
      ? { ...b.completion, history: b.completion.history.map(({ note: _note, ...h }) => h) }
      : undefined,
    noShow: b.noShow ? { ...b.noShow, reviewNote: undefined } : undefined,
    quote: safeQuote,
  };
}

function summary(
  id: string,
  account: Account | undefined,
  orders: Booking[],
): AdminCustomerSummary {
  return {
    id,
    name: account?.name ?? orders.find((b) => b.address?.name)?.address?.name ?? id,
    email: account?.email,
    status: account?.status ?? 'DEMO',
    verified: !!account?.verifiedAt,
    createdAt: account?.createdAt ?? orders.at(-1)?.createdAt,
    orders: orders.length,
    completed: orders.filter((b) => b.status === 'COMPLETED').length,
  };
}
async function directory(tx: Records) {
  const accounts = new Map((await tx.list<Account>('customerAccounts')).map((a) => [a.id, a]));
  const bookings = (await tx.list<Booking>('bookings')).sort((a, b) => b.createdAt - a.createdAt);
  const grouped = new Map<string, Booking[]>();
  for (const b of bookings) {
    const orders = grouped.get(b.customerId);
    if (orders) orders.push(b);
    else grouped.set(b.customerId, [b]);
  }
  const ids = new Set([...accounts.keys(), ...grouped.keys()]);
  return {
    items: [...ids].map((id) => summary(id, accounts.get(id), grouped.get(id) ?? [])),
    bookings,
  };
}

async function record(tx: Records, actor: Actor, action: string, detail: string, now: number) {
  await tx.put<Audit>('audit', {
    id: `audit_${randomUUID()}`,
    actorId: actor.id,
    actorRole: 'ADMIN',
    action,
    detail,
    at: now,
  });
}

export async function searchCustomers(
  tx: Records,
  actor: Actor,
  input: unknown,
  now: number,
): Promise<AdminCustomerSearch> {
  const { q, page } = z
    .object({
      q: z.string().trim().min(2).max(254),
      page: z.coerce.number().int().min(1).max(10000).default(1),
    })
    .strict()
    .parse(input);
  const query = q.toLocaleLowerCase();
  const { items, bookings } = await directory(tx);
  const matchedBookingIds = new Set(
    bookings
      .filter((b) => b.id.toLowerCase() === query || b.id.slice(-8).toLowerCase() === query)
      .map((b) => b.customerId),
  );
  const matched = items.filter(
    (c) =>
      c.id.toLowerCase() === query ||
      c.email?.toLowerCase() === query ||
      c.name.toLocaleLowerCase().includes(query) ||
      matchedBookingIds.has(c.id),
  );
  await record(
    tx,
    actor,
    'CUSTOMER_DIRECTORY_SEARCHED',
    `matches:${matched.length};page:${page}`,
    now,
  );
  return {
    items: matched.slice((page - 1) * 20, page * 20),
    page,
    total: matched.length,
    pageSize: 20,
  };
}

export async function customerProfile(
  tx: Records,
  actor: Actor,
  id: string,
  now: number,
): Promise<AdminCustomerProfile> {
  const account = await tx.get<Account>('customerAccounts', id);
  const orders = await tx.find<Booking>(
    'bookings',
    { customerId: id },
    { orderBy: 'createdAt', descending: true },
  );
  ensure(account || orders.length, 'NOT_FOUND', 'Customer not found.', 404);
  const customer = summary(id, account, orders);
  const orderIds = new Set(orders.map((b) => b.id));
  const cases: AdminCustomerProfile['cases'] = [];
  for (const c of await tx.list<SupportTicket>('supportTickets')) {
    if (
      (c.customerId === id || (c.bookingId && orderIds.has(c.bookingId))) &&
      (await adminCaseVisible(tx, actor, c))
    )
      cases.push({
        id: c.id,
        bookingId: c.bookingId,
        subject: c.subject,
        category: c.category,
        status: c.status,
        createdAt: c.createdAt,
      });
  }
  await record(tx, actor, 'CUSTOMER_PROFILE_VIEWED', id, now);
  return {
    customer,
    bookings: orders.map(adminBookingView),
    cases: cases.sort((a, b) => b.createdAt - a.createdAt),
    ...(canAdmin(actor, 'safety.write')
      ? { restriction: await tx.get<CustomerRestriction>('restrictions', id) }
      : {}),
  };
}
