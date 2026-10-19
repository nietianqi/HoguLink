import { registerClock, advanceClock, finishVisit } from './helpers/visit-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Actor, Audit, Listing, Offering, Store } from '@hogulink/contracts';
import { Repository } from '../src/repository.js';
import { Engine } from '../src/engine.js';
import { seed } from '../src/seed.js';
import { DomainError } from '../src/errors.js';
const admin: Actor = { id: 'admin', role: 'ADMIN', verificationLevel: 3 },
  owner: Actor = { id: 'owner', role: 'MERCHANT', storeId: 'store-nagi', verificationLevel: 1 },
  customer: Actor = { id: 'customer', role: 'CUSTOMER', verificationLevel: 1 },
  staff: Actor = {
    id: 'aoi',
    role: 'STAFF',
    staffId: 'staff-aoi',
    storeId: 'store-nagi',
    verificationLevel: 1,
  };
const code = (value: string) => (e: unknown) => e instanceof DomainError && e.code === value;
async function fixture(fn: (e: Engine) => Promise<void>) {
  const repo = new Repository(undefined, ':memory:');
  await repo.init();
  await seed(repo);
  const clock = { now: Date.UTC(2026, 9, 18, 0) };
  const e = new Engine(repo, () => clock.now);
  registerClock(e, (at) => {
    clock.now = at;
  });
  try {
    await fn(e);
  } finally {
    await repo.close();
  }
}
const review = (extra = {}) => ({
  targetType: 'STORE',
  targetId: 'store-nagi',
  decision: 'SUSPEND',
  version: 1,
  reason: 'Local demo review decision with a documented operational reason.',
  ...extra,
});
const quote = (e: Engine, start = e.now() + 3 * 3600000) =>
  e.quote(customer, {
    listingId: 'listing-aoi',
    offeringId: 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt: start,
    area: 'shinjuku',
    requiredLanguage: '',
  });
async function booking(e: Engine) {
  const q = await quote(e),
    h = await e.hold(customer, q.id),
    p = await e.authorizeDemo(customer, h.id, true);
  return e.createBooking(
    customer,
    {
      quoteId: q.id,
      holdId: h.id,
      paymentId: p.id,
      termsAccepted: true,
      policyVersion: q.cancellationPolicy.version,
      address: {
        name: 'Admin QA Guest',
        type: 'HOTEL',
        area: 'shinjuku',
        detail: 'Private sample visit address',
        hotelName: 'Sample Hotel',
        room: 'ADMIN-101',
        hotelPermission: true,
      },
    },
    'admin-existing-order',
  );
}
test('administrator workspace rejects other roles and exposes no payment routing or visit identity', () =>
  fixture(async (e) => {
    await booking(e);
    const s = await e.admin.snapshot(admin);
    assert.equal(s.stores.length, 3);
    assert.equal(s.listings.length, 6);
    assert.equal(s.offerings.length, 9);
    assert.ok(s.bookings.every((b) => !('customerId' in b.quote)));
    assert.ok(s.stores.every((x) => !('pspAccount' in x) && x.pspReady));
    assert.ok(
      s.bookings.every(
        (x) => !('address' in x) && !('customerId' in x) && !('paymentId' in x) && !('holdId' in x),
      ),
    );
    for (const actor of [owner, customer, staff]) {
      await assert.rejects(e.admin.snapshot(actor), code('FORBIDDEN'));
      await assert.rejects(e.admin.review(actor, review()), code('FORBIDDEN'));
    }
  }));
test('shop suspension stops discovery and new reservations without changing submitted visits or capture totals', () =>
  fixture(async (e) => {
    let b = await booking(e);
    const pending = await quote(e, e.now() + 6 * 3600000);
    await e.admin.review(admin, review());
    assert.ok(!(await e.publicCatalog()).stores.some((s) => s.id === 'store-nagi'));
    await assert.rejects(e.hold(customer, pending.id), code('LISTING_UNAVAILABLE'));
    assert.equal((await e.booking(customer, b.id)).status, b.status);
    b = await e.ack(staff, b.id, b.version);
    b = await finishVisit(e, b, staff, customer);
    assert.equal(b.capturedAmount, b.quote.total);
    assert.equal(b.status, 'COMPLETED');
  }));
test('restoring a shop bumps booking rules so pre-review quotes cannot silently become valid again', () =>
  fixture(async (e) => {
    const q = await quote(e);
    await e.admin.review(admin, review());
    await e.admin.review(admin, review({ decision: 'APPROVE', version: 2 }));
    assert.ok((await e.publicCatalog()).stores.some((s) => s.id === 'store-nagi'));
    await assert.rejects(e.hold(customer, q.id), code('SHOP_RULES_CHANGED'));
    const s = (await e.admin.snapshot(admin)).stores.find((s) => s.id === 'store-nagi')!;
    assert.equal(s.ruleVersion, 3);
    assert.equal(s.moderationVersion, 3);
  }));
test('shop approval requires business details and configured payment routing', () =>
  fixture(async (e) => {
    await e.repo.transaction(async (tx) => {
      const s = (await tx.get<Store>('stores', 'store-nagi'))!;
      s.pspAccount = '';
      await tx.put('stores', s);
    });
    await assert.rejects(
      e.admin.review(admin, review({ decision: 'APPROVE' })),
      code('REVIEW_INCOMPLETE'),
    );
    assert.equal((await e.admin.snapshot(admin)).reviews.length, 0);
  }));
test('therapist review shares versions with the legacy enforcement endpoint', () =>
  fixture(async (e) => {
    await e.enforce(admin, 'listing-aoi', true, 'Legacy review');
    await assert.rejects(
      e.admin.review(
        admin,
        review({ targetType: 'LISTING', targetId: 'listing-aoi', decision: 'APPROVE' }),
      ),
      code('VERSION_CONFLICT'),
    );
    await e.admin.review(
      admin,
      review({ targetType: 'LISTING', targetId: 'listing-aoi', decision: 'APPROVE', version: 2 }),
    );
    assert.equal(
      (await e.admin.snapshot(admin)).listings.find((x) => x.id === 'listing-aoi')
        ?.publicationStatus,
      'PUBLISHED_INDEXABLE',
    );
  }));
test('publication approval cannot invent identity, membership or portrait permission', () =>
  fixture(async (e) => {
    await e.repo.transaction(async (tx) => {
      const s = (await tx.get<Listing>('listings', 'listing-aoi'))!;
      s.portraitConsent = false;
      await tx.put('listings', s);
    });
    await assert.rejects(
      e.admin.review(
        admin,
        review({ targetType: 'LISTING', targetId: 'listing-aoi', decision: 'APPROVE' }),
      ),
      code('REVIEW_INCOMPLETE'),
    );
    await assert.rejects(
      e.enforce(admin, 'listing-aoi', false, 'Cannot restore without consent'),
      code('LISTING_UNAVAILABLE'),
    );
  }));
test('service moderation invalidates quotes and approval preserves the merchant availability switch', () =>
  fixture(async (e) => {
    const q = await quote(e);
    await e.admin.review(admin, review({ targetType: 'OFFERING', targetId: 'store-nagi-60' }));
    await assert.rejects(e.hold(customer, q.id), code('PRICE_CHANGED'));
    await e.repo.transaction(async (tx) => {
      const s = (await tx.get<Offering>('offerings', 'store-nagi-60'))!;
      s.active = false;
      await tx.put('offerings', s);
    });
    await e.admin.review(
      admin,
      review({
        targetType: 'OFFERING',
        targetId: 'store-nagi-60',
        decision: 'APPROVE',
        version: 2,
      }),
    );
    const s = (await e.admin.snapshot(admin)).offerings.find((s) => s.id === 'store-nagi-60')!;
    assert.equal(s.approved, true);
    assert.equal(s.active, false);
    assert.equal(s.version, 3);
  }));
test('licensed services cannot be approved through the ordinary content review form', () =>
  fixture(async (e) => {
    await e.repo.transaction(async (tx) => {
      const s = (await tx.get<Offering>('offerings', 'store-nagi-60'))!;
      s.regulatoryCategory = 'LICENSED';
      await tx.put('offerings', s);
    });
    await assert.rejects(
      e.admin.review(
        admin,
        review({ targetType: 'OFFERING', targetId: 'store-nagi-60', decision: 'APPROVE' }),
      ),
      code('REGULATORY_REVIEW_REQUIRED'),
    );
  }));
test('concurrent review decisions have one winner; short notes, extra fields and unknown targets fail', () =>
  fixture(async (e) => {
    const results = await Promise.allSettled([
      e.admin.review(admin, review()),
      e.admin.review(admin, review({ decision: 'REJECT' })),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await e.admin.snapshot(admin)).reviews.length, 1);
    await assert.rejects(e.admin.review(admin, review({ version: 2, reason: 'short' })));
    await assert.rejects(e.admin.review(admin, review({ version: 2, pspAccount: 'spoofed' })));
    await assert.rejects(e.admin.review(admin, review({ targetId: 'missing' })), code('NOT_FOUND'));
  }));
test('private review notes stay out of shared audit and outbox payloads', () =>
  fixture(async (e) => {
    const note = 'PRIVATE_REVIEW_NOTE sample evidence seen by the administrator only.';
    const r = await e.admin.review(admin, review({ reason: note }));
    const snapshot = await e.admin.snapshot(admin);
    assert.equal(snapshot.reviews[0].reason, note);
    assert.equal(r.previousVersion, 1);
    assert.equal(r.nextVersion, 2);
    const payload = await e.repo.transaction(async (tx) => ({
      audit: await tx.list<Audit>('audit'),
      outbox: await tx.list('outbox'),
    }));
    assert.ok(!JSON.stringify(payload).includes('PRIVATE_REVIEW_NOTE'));
    assert.ok(JSON.stringify(payload).includes(r.id));
  }));
test('system snapshot reports a missing notification adapter truthfully and returns null for an empty queue', () =>
  fixture(async (e) => {
    // Initialization now queues legitimate plan events. Model an already-drained queue.
    await e.run(async (tx) => {
      for (const item of await tx.list<{ id: string }>('outbox'))
        await tx.put('outbox', { ...item, status: 'DONE' });
    });
    const s = await e.admin.snapshot(admin);
    assert.equal(s.system.pending, 0);
    assert.equal(s.system.oldestPendingAt, null);
    assert.equal(s.system.notifications, 'DEMO_LOCAL_ONLY');
    await e.admin.review(admin, review());
    const updated = await e.admin.snapshot(admin);
    assert.equal(updated.system.pending, 1);
    assert.equal(updated.system.oldestPendingAt, e.now());
    assert(updated.system.queue.some((item) => item.status === 'PENDING'));
  }));
