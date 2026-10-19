import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  Actor,
  Booking,
  CustomerInbox,
  InboxItem,
  Listing,
  Message,
  Offering,
  Store,
  StoreFavoriteItem,
  StoreFavoriteRecord,
  SupportTicket,
  TicketMessage,
} from '@hogulink/contracts';
import type { Records } from './repository.js';
import { ensure } from './errors.js';
import { toPublicStore } from './public-catalog.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Receipt = { id: string; token: string };
const favoriteInput = z
  .object({ version: z.number().int().nonnegative(), active: z.boolean() })
  .strict();
const readInput = z
  .object({
    items: z
      .array(
        z
          .object({ id: z.string().min(1).max(180), token: z.string().regex(/^[a-f0-9]{64}$/) })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
const inboxInput = z
  .object({
    filter: z.enum(['all', 'unread', 'bookings', 'support']).default('all'),
    cursor: z.string().max(500).optional(),
  })
  .strict();

export class EngagementService {
  constructor(
    private run: <T>(fn: (tx: Records) => Promise<T>) => Promise<T>,
    private now: () => number,
  ) {}
  private customer(actor: Actor) {
    ensure(
      actor.role === 'CUSTOMER' && actor.verificationLevel >= 1,
      'FORBIDDEN',
      'Sign in with your customer account.',
      403,
    );
  }
  private async availableStore(tx: Records, id: string) {
    const store = await tx.get<Store>('stores', id);
    if (!store?.active || !store.approved || !store.pspAccount || store.billingBlocked) return null;
    const offerings = (await tx.list<Offering>('offerings')).filter(
      (o) =>
        o.storeId === id &&
        o.approved &&
        o.active !== false &&
        o.regulatoryCategory === 'RELAXATION',
    );
    const active = (await tx.list<Listing>('listings')).some(
      (l) =>
        l.storeId === id &&
        l.membershipActive &&
        l.identityVerified &&
        l.portraitConsent &&
        l.publicationStatus === 'PUBLISHED_INDEXABLE' &&
        offerings.some((o) => l.offeringIds.includes(o.id)),
    );
    if (!active) return null;
    return toPublicStore(store);
  }
  async favorites(actor: Actor): Promise<StoreFavoriteItem[]> {
    this.customer(actor);
    return this.run(async (tx) => {
      const result: StoreFavoriteItem[] = [];
      for (const f of (await tx.list<StoreFavoriteRecord>('storeFavorites'))
        .filter((f) => f.customerId === actor.id && f.active)
        .sort((a, b) => b.updatedAt - a.updatedAt || a.storeId.localeCompare(b.storeId))) {
        const store = await this.availableStore(tx, f.storeId);
        result.push({ storeId: f.storeId, version: f.version, available: !!store, store });
      }
      return result;
    });
  }
  async favoriteState(actor: Actor, storeId: string) {
    this.customer(actor);
    return this.run(async (tx) => {
      const f = await tx.get<StoreFavoriteRecord>('storeFavorites', hash([actor.id, storeId]));
      return { active: f?.active ?? false, version: f?.version ?? 0 };
    });
  }
  async favorite(actor: Actor, storeId: string, input: unknown) {
    this.customer(actor);
    const d = favoriteInput.parse(input);
    return this.run(async (tx) => {
      const id = hash([actor.id, storeId]);
      const old = await tx.get<StoreFavoriteRecord>('storeFavorites', id);
      ensure((old?.version ?? 0) === d.version, 'VERSION_CONFLICT', 'Refresh your favorites.', 409);
      ensure(
        !d.active || (await this.availableStore(tx, storeId)),
        'STORE_UNAVAILABLE',
        'This shop is no longer available.',
        409,
      );
      ensure(d.active || old, 'NOT_FOUND', 'Favorite not found.', 404);
      ensure(
        !d.active ||
          old?.active ||
          (await tx.list<StoreFavoriteRecord>('storeFavorites')).filter(
            (f) => f.customerId === actor.id && f.active,
          ).length < 100,
        'FAVORITE_LIMIT',
        'You can save up to 100 shops.',
        409,
      );
      const f: StoreFavoriteRecord = {
        id,
        customerId: actor.id,
        storeId,
        active: d.active,
        version: (old?.version ?? 0) + 1,
        createdAt: old?.createdAt ?? this.now(),
        updatedAt: this.now(),
      };
      await tx.put('storeFavorites', f);
      return { active: f.active, version: f.version };
    });
  }
  private async items(tx: Records, actor: Actor): Promise<InboxItem[]> {
    const rows: InboxItem[] = [];
    const messages = await tx.list<Message>('messages');
    const ticketMessages = await tx.list<TicketMessage>('ticketMessages');
    const add = async (item: Omit<InboxItem, 'unread'>) => {
      const receipt = await tx.get<Receipt>('inboxReceipts', hash([actor.id, item.id]));
      rows.push({ ...item, unread: receipt?.token !== item.token });
    };
    for (const b of await tx.find<Booking>('bookings', { customerId: actor.id })) {
      const incoming = messages
        .filter((m) => m.bookingId === b.id && m.role !== 'CUSTOMER')
        .sort((a, b) => a.id.localeCompare(b.id));
      const id = `booking:${b.id}`;
      await add({
        id,
        kind: 'BOOKING',
        targetId: b.id,
        title: b.quote.serviceName ?? {
          ja: 'ご予約の更新',
          en: 'Booking update',
          'zh-cn': '预约更新',
        },
        status: b.status,
        updatedAt: Math.max(b.updatedAt, ...incoming.map((m) => m.createdAt)),
        token: hash([id, b.version, incoming.map((m) => m.id)]),
        replies: incoming.length,
      });
    }
    for (const s of (await tx.list<SupportTicket>('supportTickets')).filter(
      (s) => s.reporterRole === 'CUSTOMER' && s.reporterId === actor.id,
    )) {
      const incoming = ticketMessages
        .filter((m) => m.ticketId === s.id && m.role !== 'CUSTOMER')
        .sort((a, b) => a.id.localeCompare(b.id));
      const id = `support:${s.id}`;
      // No message bodies, complaint evidence, internal notes or staff-only safety reports in the inbox.
      await add({
        id,
        kind: 'SUPPORT',
        targetId: s.id,
        title: { ja: 'お問い合わせの更新', en: 'Support case update', 'zh-cn': '售后工单更新' },
        status: s.status,
        updatedAt: Math.max(s.updatedAt, ...incoming.map((m) => m.createdAt)),
        token: hash([id, s.version, incoming.map((m) => m.id)]),
        replies: incoming.length,
      });
    }
    return rows.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }
  async inbox(actor: Actor, input: unknown = {}): Promise<CustomerInbox> {
    this.customer(actor);
    const d = inboxInput.parse(input);
    let cursor: { at: number; id: string } | undefined;
    if (d.cursor) {
      try {
        cursor = z
          .object({ at: z.number().int().nonnegative(), id: z.string().max(180) })
          .strict()
          .parse(JSON.parse(Buffer.from(d.cursor, 'base64url').toString('utf8')));
      } catch {
        ensure(false, 'INVALID_CURSOR', 'Refresh the inbox.', 400);
      }
    }
    return this.run(async (tx) => {
      const all = await this.items(tx, actor);
      const filtered = all
        .filter((i) =>
          d.filter === 'unread'
            ? i.unread
            : d.filter === 'bookings'
              ? i.kind === 'BOOKING'
              : d.filter === 'support'
                ? i.kind === 'SUPPORT'
                : true,
        )
        .filter(
          (i) =>
            !cursor ||
            i.updatedAt < cursor.at ||
            (i.updatedAt === cursor.at && i.id.localeCompare(cursor.id) > 0),
        );
      const items = filtered.slice(0, 20),
        last = items.at(-1);
      return {
        items,
        unreadCount: all.filter((i) => i.unread).length,
        nextCursor:
          filtered.length > 20 && last
            ? Buffer.from(JSON.stringify({ at: last.updatedAt, id: last.id })).toString('base64url')
            : null,
      };
    });
  }
  async read(actor: Actor, input: unknown) {
    this.customer(actor);
    const d = readInput.parse(input);
    return this.run(async (tx) => {
      const items = await this.items(tx, actor),
        marked: string[] = [],
        stale: string[] = [];
      for (const r of new Map(d.items.map((r) => [r.id, r])).values()) {
        const item = items.find((i) => i.id === r.id);
        // Receipts acknowledge exactly the snapshot the customer saw. A racing new reply stays unread.
        if (!item || item.token !== r.token) {
          stale.push(r.id);
          continue;
        }
        await tx.put<Receipt>('inboxReceipts', {
          id: hash([actor.id, item.id]),
          token: item.token,
        });
        marked.push(item.id);
      }
      return { marked, stale };
    });
  }
}
