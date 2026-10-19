import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  Actor,
  Booking,
  Listing,
  Message,
  Offering,
  Store,
  SupportTicket,
  TicketMessage,
} from '@hogulink/contracts';
import { DomainError } from '../src/errors.js';
import { fixture, booking, customer, shop, staff, admin } from './helpers/experience-fixture.js';
const other: Actor = { ...customer, id: 'other-inbox-customer' };
const fail = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;
const seen = (item: { id: string; token: string }) => ({
  items: [{ id: item.id, token: item.token }],
});

test('inbox and store collections require a verified customer, including reads', () =>
  fixture(async (e) => {
    for (const actor of [shop, staff, admin, { ...customer, verificationLevel: 0 }]) {
      await assert.rejects(() => e.engagement.inbox(actor), fail('FORBIDDEN'));
      await assert.rejects(() => e.engagement.favorites(actor), fail('FORBIDDEN'));
      await assert.rejects(
        () => e.engagement.favorite(actor, 'store-nagi', { version: 0, active: true }),
        fail('FORBIDDEN'),
      );
      await assert.rejects(() => e.engagement.read(actor, { items: [] }), fail('FORBIDDEN'));
    }
    assert.deepEqual(await e.engagement.inbox(customer), {
      items: [],
      unreadCount: 0,
      nextCursor: null,
    });
  }));
test('store favorites are owner private, versioned and included in the real collection total', () =>
  fixture(async (e) => {
    const saved = await e.engagement.favorite(customer, 'store-nagi', { version: 0, active: true });
    assert.equal(saved.version, 1);
    assert.equal((await e.engagement.favorites(customer)).length, 1);
    assert.deepEqual(await e.engagement.favorites(other), []);
    assert.equal((await e.engagement.favoriteState(other, 'store-nagi')).active, false);
    assert.equal((await e.experience.overview(customer)).counts.favorites, 1);
    await assert.rejects(
      () => e.engagement.favorite(customer, 'store-nagi', { version: 0, active: false }),
      fail('VERSION_CONFLICT'),
    );
    const removed = await e.engagement.favorite(customer, 'store-nagi', {
      version: 1,
      active: false,
    });
    assert.equal(removed.version, 2);
    assert.deepEqual(await e.engagement.favorites(customer), []);
    assert.equal((await e.experience.overview(customer)).counts.favorites, 0);
  }));
test('simultaneous shop favorite edits cannot lose a version', () =>
  fixture(async (e) => {
    const results = await Promise.allSettled([
      e.engagement.favorite(customer, 'store-nagi', { version: 0, active: true }),
      e.engagement.favorite(customer, 'store-nagi', { version: 0, active: true }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      results.filter((r) => r.status === 'rejected' && fail('VERSION_CONFLICT')(r.reason)).length,
      1,
    );
  }));
test('unavailable shops remain removable without exposing stale business or private contacts', () =>
  fixture(async (e) => {
    await e.engagement.favorite(customer, 'store-nagi', { version: 0, active: true });
    const live = await e.engagement.favorites(customer);
    assert(live[0].store);
    assert(!JSON.stringify(live).includes('pspAccount'));
    assert(!JSON.stringify(live).includes('emergencyContact'));
    await e.repo.transaction(async (tx) => {
      const s = (await tx.get<Store>('stores', 'store-nagi'))!;
      await tx.put('stores', { ...s, active: false });
    });
    const saved = await e.engagement.favorites(customer);
    assert.equal(saved[0].store, null);
    assert.equal(saved[0].available, false);
    await assert.rejects(
      () => e.engagement.favorite(customer, 'store-nagi', { version: 1, active: true }),
      fail('STORE_UNAVAILABLE'),
    );
    await e.engagement.favorite(customer, 'store-nagi', { version: 1, active: false });
  }));
test('a store without an eligible authorized portrait and approved relaxation menu cannot be newly saved', () =>
  fixture(async (e) => {
    await e.repo.transaction(async (tx) => {
      for (const l of await tx.list<Listing>('listings'))
        if (l.storeId === 'store-nagi') await tx.put('listings', { ...l, portraitConsent: false });
    });
    await assert.rejects(
      () => e.engagement.favorite(customer, 'store-nagi', { version: 0, active: true }),
      fail('STORE_UNAVAILABLE'),
    );
    await assert.rejects(
      () => e.engagement.favorite(customer, 'unknown', { version: 0, active: true }),
      fail('STORE_UNAVAILABLE'),
    );
    await assert.rejects(
      () => e.engagement.favorite(customer, 'unknown', { version: 0, active: false }),
      fail('NOT_FOUND'),
    );
  }));
test('inactive or licensed-only menus are excluded from store favorites even if the shop is approved', () =>
  fixture(async (e) => {
    await e.repo.transaction(async (tx) => {
      for (const o of await tx.list<Offering>('offerings'))
        if (o.storeId === 'store-nagi')
          await tx.put('offerings', { ...o, regulatoryCategory: 'LICENSED' });
    });
    await assert.rejects(
      () => e.engagement.favorite(customer, 'store-nagi', { version: 0, active: true }),
      fail('STORE_UNAVAILABLE'),
    );
  }));
test('store collection limit is bounded and existing saves can still be removed at the limit', () =>
  fixture(async (e) => {
    await e.engagement.favorite(customer, 'store-nagi', { version: 0, active: true });
    await e.repo.transaction(async (tx) => {
      for (let i = 0; i < 99; i++)
        await tx.put('storeFavorites', {
          id: `f-${i}`,
          customerId: customer.id,
          storeId: `old-${i}`,
          active: true,
          version: 1,
          createdAt: e.now(),
          updatedAt: e.now(),
        });
    });
    await assert.rejects(
      () => e.engagement.favorite(customer, 'store-mori', { version: 0, active: true }),
      fail('FAVORITE_LIMIT'),
    );
    await e.engagement.favorite(customer, 'store-nagi', { version: 1, active: false });
    assert.equal(
      (await e.engagement.favorite(customer, 'store-mori', { version: 0, active: true })).active,
      true,
    );
  }));
test('inbox scopes bookings and reporter-owned cases, never a staff safety report sharing customerId', () =>
  fixture(async (e) => {
    const b = await booking(e);
    await e.repo.transaction(async (tx) => {
      await tx.put('bookings', { ...b, id: 'foreign-booking', customerId: other.id });
      for (const [id, reporterId, reporterRole] of [
        ['own', customer.id, 'CUSTOMER'],
        ['foreign-case', other.id, 'CUSTOMER'],
        ['staff-secret', staff.id, 'STAFF'],
      ] as const)
        await tx.put('supportTickets', {
          id,
          customerId: customer.id,
          reporterId,
          reporterRole,
          subject: 'Private subject',
          description: 'Secret complaint evidence',
          status: 'PLATFORM_ESCALATED',
          visibility: 'PLATFORM_ONLY',
          version: 1,
          createdAt: e.now(),
          updatedAt: e.now(),
        } as SupportTicket);
      await tx.put('ticketHandling', { id: 'own', notes: 'Internal operator notes' });
    });
    const inbox = await e.engagement.inbox(customer);
    assert.equal(inbox.items.length, 2);
    assert.equal(inbox.unreadCount, 2);
    const json = JSON.stringify(inbox);
    for (const secret of [
      'foreign-booking',
      'foreign-case',
      'staff-secret',
      'customerId',
      'Private subject',
      'Secret complaint evidence',
      'Internal operator notes',
      'Private QA address',
      'paymentId',
      'actorId',
    ])
      assert(!json.includes(secret), secret);
    assert.equal((await e.engagement.inbox(other)).items.length, 2);
  }));
test('read receipts acknowledge the displayed snapshot and repeated acknowledgement is idempotent', () =>
  fixture(async (e) => {
    await booking(e);
    const first = (await e.engagement.inbox(customer)).items[0];
    assert.deepEqual(await e.engagement.read(customer, seen(first)), {
      marked: [first.id],
      stale: [],
    });
    assert.deepEqual(await e.engagement.read(customer, seen(first)), {
      marked: [first.id],
      stale: [],
    });
    assert.equal((await e.engagement.inbox(customer)).unreadCount, 0);
    assert.equal((await e.engagement.inbox(customer, { filter: 'unread' })).items.length, 0);
    assert.equal((await e.engagement.inbox(customer, { filter: 'bookings' })).items.length, 1);
  }));
test('a racing provider reply at the same millisecond stays unread and never leaks its body', () =>
  fixture(async (e) => {
    const b = await booking(e),
      first = (await e.engagement.inbox(customer)).items[0];
    await e.messages(shop, b.id, 'Private provider reply');
    const r = await e.engagement.read(customer, seen(first));
    assert.deepEqual(r, { marked: [], stale: [first.id] });
    const next = await e.engagement.inbox(customer);
    assert.equal(next.unreadCount, 1);
    assert.equal(next.items[0].replies, 1);
    assert.notEqual(next.items[0].token, first.token);
    assert(!JSON.stringify(next).includes('Private provider reply'));
  }));
test('own booking messages do not create false unread replies, while status changes do', () =>
  fixture(async (e) => {
    const b = await booking(e),
      item = (await e.engagement.inbox(customer)).items[0];
    await e.engagement.read(customer, seen(item));
    await e.messages(customer, b.id, 'My own note');
    assert.equal((await e.engagement.inbox(customer)).unreadCount, 0);
    await e.repo.transaction(async (tx) => {
      await tx.put('bookings', {
        ...b,
        status: 'CANCELLED',
        version: b.version + 1,
      } satisfies Booking);
    });
    const next = await e.engagement.inbox(customer);
    assert.equal(next.unreadCount, 1);
    assert.equal(next.items[0].status, 'CANCELLED');
  }));
test('customer cannot mark another customer thread or arbitrary opaque tokens as read', () =>
  fixture(async (e) => {
    await booking(e);
    const item = (await e.engagement.inbox(customer)).items[0];
    assert.deepEqual((await e.engagement.read(other, seen(item))).marked, []);
    assert.equal((await e.engagement.inbox(customer)).unreadCount, 1);
    assert.deepEqual(
      (await e.engagement.read(customer, seen({ ...item, token: 'a'.repeat(64) }))).marked,
      [],
    );
  }));
test('support reply and resolution updates change snapshots independently of booking threads', () =>
  fixture(async (e) => {
    await e.repo.transaction(async (tx) => {
      await tx.put('supportTickets', {
        id: 'private-case',
        customerId: customer.id,
        reporterId: customer.id,
        reporterRole: 'CUSTOMER',
        version: 1,
        status: 'PLATFORM_ESCALATED',
        createdAt: e.now(),
        updatedAt: e.now(),
      } as SupportTicket);
    });
    const item = (await e.engagement.inbox(customer)).items[0];
    await e.engagement.read(customer, seen(item));
    await e.repo.transaction(async (tx) => {
      await tx.put('ticketMessages', {
        id: 'reply',
        ticketId: 'private-case',
        actorId: admin.id,
        role: 'ADMIN',
        kind: 'MESSAGE',
        text: 'Private resolution text',
        createdAt: e.now(),
      } satisfies TicketMessage);
    });
    assert.equal((await e.engagement.inbox(customer, { filter: 'support' })).unreadCount, 1);
    assert.equal((await e.engagement.inbox(customer, { filter: 'bookings' })).items.length, 0);
    const next = (await e.engagement.inbox(customer)).items[0];
    await e.engagement.read(customer, seen(next));
    await e.repo.transaction(async (tx) => {
      const s = (await tx.get<SupportTicket>('supportTickets', 'private-case'))!;
      await tx.put('supportTickets', { ...s, status: 'RESOLVED', version: 2 });
    });
    assert.equal((await e.engagement.inbox(customer)).items[0].status, 'RESOLVED');
    assert.equal((await e.engagement.inbox(customer)).unreadCount, 1);
  }));
test('stable inbox pagination covers equal-timestamp threads once; receipts do not reorder history', () =>
  fixture(async (e) => {
    const b = await booking(e);
    await e.repo.transaction(async (tx) => {
      for (let i = 0; i < 44; i++) await tx.put('bookings', { ...b, id: `inbox-${i}` });
    });
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await e.engagement.inbox(customer, { cursor });
      ids.push(...page.items.map((i) => i.id));
      await e.engagement.read(customer, {
        items: page.items.map(({ id, token }) => ({ id, token })),
      });
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.equal(ids.length, 45);
    assert.equal(new Set(ids).size, 45);
    assert.equal((await e.engagement.inbox(customer)).unreadCount, 0);
  }));
test('malformed pagination, unbounded receipts and unexpected inputs are rejected', () =>
  fixture(async (e) => {
    await assert.rejects(
      () => e.engagement.inbox(customer, { cursor: 'garbage' }),
      fail('INVALID_CURSOR'),
    );
    await assert.rejects(
      () =>
        e.engagement.inbox(customer, {
          cursor: Buffer.from(JSON.stringify({ at: -1, id: 'x' })).toString('base64url'),
        }),
      fail('INVALID_CURSOR'),
    );
    await assert.rejects(() => e.engagement.inbox(customer, { filter: 'staff' }));
    await assert.rejects(() => e.engagement.read(customer, { items: [] }));
    await assert.rejects(() =>
      e.engagement.read(customer, {
        items: Array.from({ length: 101 }, () => ({ id: 'x', token: 'a'.repeat(64) })),
      }),
    );
    await assert.rejects(() =>
      e.engagement.favorite(customer, 'store-nagi', {
        version: 0,
        active: true,
        customerId: other.id,
      }),
    );
  }));
