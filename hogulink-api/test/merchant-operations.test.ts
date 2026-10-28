import test from 'node:test';
import assert from 'node:assert/strict';
import {
  type Actor,
  type Listing,
  type Store,
  type SafetyEvent,
  type ExperienceReview,
  type ExperienceReply,
} from '@hogulink/contracts';
import { Repository } from '../src/repository.js';
import { Engine } from '../src/engine.js';
import { seed } from '../src/seed.js';
import { DomainError } from '../src/errors.js';
import { safetyEventView } from '../src/care.js';
const owner: Actor = { id: 'owner', role: 'MERCHANT', storeId: 'store-nagi', verificationLevel: 1 };
const other: Actor = { ...owner, id: 'other', storeId: 'store-mori' };
const admin: Actor = { id: 'platform', role: 'ADMIN', verificationLevel: 3 };
const customer: Actor = { id: 'guest', role: 'CUSTOMER', verificationLevel: 1 };
const staff: Actor = {
  id: 'aoi',
  role: 'STAFF',
  storeId: 'store-nagi',
  staffId: 'staff-aoi',
  verificationLevel: 1,
};
const code = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;
test('review reminders are shop scoped and do not repeat while the current reply awaits moderation', () =>
  fixture(async (e) => {
    const review: ExperienceReview = {
      id: 'review-a',
      bookingId: 'fixture-order',
      customerId: 'fixture-customer',
      merchantId: 'merchant-nagi',
      storeId: 'store-nagi',
      listingId: 'listing-aoi',
      staffId: 'staff-aoi',
      serviceName: draft.name,
      scores: { overall: 5, punctuality: 5, communication: 5, explanation: 5, cleanliness: 5 },
      text: 'Fixture review for merchant reply reminder',
      status: 'APPROVED',
      version: 1,
      revision: 1,
      createdAt: e.now(),
      updatedAt: e.now(),
    };
    await e.repo.transaction(async (tx) => {
      await tx.put('experienceReviews', review);
      await tx.put('experienceReviews', { ...review, id: 'other-review', storeId: 'store-mori' });
    });
    assert.equal((await e.merchant.snapshot(owner)).unrepliedReviews, 1);
    const reply: ExperienceReply = {
      id: 'reply-a',
      reviewId: review.id,
      reviewRevision: 1,
      storeId: 'store-nagi',
      text: 'Fixture merchant reply',
      status: 'PENDING',
      version: 1,
      createdAt: e.now(),
      updatedAt: e.now(),
    };
    await e.repo.transaction((tx) => tx.put('experienceReplies', reply));
    assert.equal((await e.merchant.snapshot(owner)).unrepliedReviews, 0);
    await e.repo.transaction((tx) => tx.put('experienceReplies', { ...reply, status: 'REJECTED' }));
    assert.equal((await e.merchant.snapshot(owner)).unrepliedReviews, 1);
    await e.repo.transaction((tx) =>
      tx.put('experienceReplies', { ...reply, status: 'APPROVED', reviewRevision: 0 }),
    );
    assert.equal((await e.merchant.snapshot(owner)).unrepliedReviews, 1);
  }));
async function fixture(fn: (e: Engine) => Promise<void>) {
  const repo = new Repository(undefined, ':memory:');
  await repo.init();
  await seed(repo);
  const e = new Engine(repo, () => Date.UTC(2026, 9, 28, 0));
  try {
    await fn(e);
  } finally {
    await repo.close();
  }
}
const draft = {
  name: { ja: 'ゆったりリラックス', en: 'Extended relaxation', 'zh-cn': '悠享放松' },
  durationMinutes: 105,
  fulfillmentMode: 'HOME_VISIT',
  price: 12000,
  transportFee: 1000,
  listingIds: ['listing-aoi'],
};
const quote = (e: Engine) =>
  e.quote(customer, {
    listingId: 'listing-aoi',
    offeringId: 'store-nagi-60',
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt: e.now() + 180 * 60000,
    area: 'shinjuku',
    requiredLanguage: '',
  });
test('service proposals stay private until a platform review and become bookable by the selected team', () =>
  fixture(async (e) => {
    const p = await e.merchantServices.submit(owner, draft, 'service-project-01');
    assert.equal(p.status, 'PENDING');
    assert.ok(!(await e.publicCatalog()).offerings.some((o) => o.id === p.id));
    assert.equal((await e.merchantServices.list(other)).length, 0);
    assert.equal((await e.adminTodo(admin)).services, 1);
    const q = (await e.merchantServices.queue(admin))[0];
    assert.equal(q.storeId, owner.storeId);
    assert.equal(q.staffNames.length, 1);
    const approved = await e.merchantServices.review(admin, p.id, {
      version: p.version,
      approve: true,
      feedback: 'Reviewed relaxation scope and team',
    });
    assert.equal(approved.status, 'APPROVED');
    const catalog = await e.publicCatalog(),
      o = catalog.offerings.find((o) => o.id === p.id);
    assert.ok(o?.approved);
    assert.equal(o.durationMinutes, 105);
    assert.ok(
      (await e.repo.read((tx) => tx.get<Listing>('listings', 'listing-aoi')))!.offeringIds.includes(
        p.id,
      ),
    );
    const slots = await e.availability('listing-aoi', p.id);
    assert.ok(slots.slots.length > 0);
    const actual = await e.quote(customer, {
      listingId: 'listing-aoi',
      offeringId: p.id,
      bookingMode: 'SCHEDULED',
      nominationType: 'NOMINATED',
      startAt: slots.slots[0],
      area: 'shinjuku',
      requiredLanguage: '',
    });
    assert.equal(actual.serviceFee, 12000);
    await assert.rejects(
      e.merchantServices.review(admin, p.id, {
        version: approved.version,
        approve: true,
        feedback: 'Cannot approve twice',
      }),
      code('INVALID_STATE'),
    );
  }));
test('proposal retries are idempotent but different content under the same key is rejected', () =>
  fixture(async (e) => {
    const p = await e.merchantServices.submit(owner, draft, 'service-retry-01');
    assert.equal((await e.merchantServices.submit(owner, draft, 'service-retry-01')).id, p.id);
    await assert.rejects(
      e.merchantServices.submit(owner, { ...draft, price: 15000 }, 'service-retry-01'),
      code('IDEMPOTENCY_CONFLICT'),
    );
    await assert.rejects(
      e.merchantServices.submit(owner, { ...draft, approved: true }, 'service-retry-02'),
    );
    await assert.rejects(e.merchantServices.submit(owner, draft, ''), code('IDEMPOTENCY_REQUIRED'));
  }));
test('project submission protects tenant, role, venue and current membership eligibility', () =>
  fixture(async (e) => {
    await assert.rejects(
      e.merchantServices.submit(customer, draft, 'service-role-01'),
      code('FORBIDDEN'),
    );
    await assert.rejects(
      e.merchantServices.submit(other, draft, 'service-tenant-01'),
      code('INVALID_SERVICE_TEAM'),
    );
    await assert.rejects(
      e.merchantServices.submit(
        owner,
        { ...draft, fulfillmentMode: 'IN_STORE' },
        'service-travel-01',
      ),
      code('INVALID_TRANSPORT_FEE'),
    );
    await assert.rejects(
      e.merchantServices.submit(
        owner,
        { ...draft, fulfillmentMode: 'IN_STORE', transportFee: 0 },
        'service-venue-01',
      ),
      code('VENUE_UNAVAILABLE'),
    );
    const p = await e.merchantServices.submit(owner, draft, 'service-team-01');
    await e.repo.transaction(async (tx) => {
      const x = await tx.get<Listing>('listings', 'listing-aoi');
      await tx.put('listings', { ...x!, membershipActive: false });
    });
    await assert.rejects(
      e.merchantServices.review(admin, p.id, {
        version: 1,
        approve: true,
        feedback: 'Current members must be rechecked',
      }),
      code('INVALID_SERVICE_TEAM'),
    );
    assert.equal((await e.merchantServices.list(owner))[0].status, 'PENDING');
  }));
test('review permissions and versions are enforced and rejected projects never become public', () =>
  fixture(async (e) => {
    const p = await e.merchantServices.submit(owner, draft, 'service-review-01');
    await assert.rejects(
      e.merchantServices.review(owner, p.id, {
        version: 1,
        approve: true,
        feedback: 'Shop cannot approve',
      }),
      code('FORBIDDEN'),
    );
    await assert.rejects(
      e.merchantServices.queue({ ...admin, id: 'system', adminRole: 'FINANCE' }),
      code('FORBIDDEN'),
    );
    await assert.rejects(
      e.merchantServices.review(admin, p.id, {
        version: 2,
        approve: true,
        feedback: 'Stale version rejected',
      }),
      code('VERSION_CONFLICT'),
    );
    await e.merchantServices.review(admin, p.id, {
      version: 1,
      approve: false,
      feedback: 'Please clarify the service name',
    });
    assert.ok(!(await e.publicCatalog()).offerings.some((o) => o.id === p.id));
    assert.equal(
      (await e.merchantServices.list(owner))[0].feedback,
      'Please clarify the service name',
    );
  }));
test('intake pause blocks new quotes and old checkout while existing visits can still be accepted', () =>
  fixture(async (e) => {
    await e.repo.transaction(async (tx) => {
      const store = await tx.get<Store>('stores', owner.storeId!);
      await tx.put('stores', { ...store!, acceptanceMode: 'MANUAL' });
    });
    const q = await quote(e),
      h = await e.hold(customer, q.id),
      p = await e.authorizeDemo(customer, h.id, true);
    const b = await e.createBooking(
      customer,
      {
        quoteId: q.id,
        holdId: h.id,
        paymentId: p.id,
        termsAccepted: true,
        policyVersion: q.cancellationPolicy.version,
        address: {
          name: 'Fixture Guest',
          area: 'shinjuku',
          type: 'HOTEL',
          detail: 'Fixture address',
          hotelName: 'Fixture hotel',
          room: '101',
          hotelPermission: true,
        },
      },
      'intake-existing-01',
    );
    await e.merchant.intake(owner, { version: 0, paused: true });
    await assert.rejects(quote(e), code('LISTING_UNAVAILABLE'));
    await assert.rejects(
      e.availability('listing-aoi', 'store-nagi-60'),
      code('LISTING_UNAVAILABLE'),
    );
    const accepted = await e.accept(owner, b.id, b.version);
    assert.ok(['ACCEPTED', 'CONFIRMED'].includes(accepted.status));
    assert.ok(!(await e.publicCatalog()).stores.some((s) => s.id === owner.storeId));
    await e.merchant.intake(owner, { version: 1, paused: false });
    assert.ok((await e.publicCatalog()).stores.some((s) => s.id === owner.storeId));
  }));
test('pausing invalidates an unsubmitted quote and does not bypass platform restrictions on resume', () =>
  fixture(async (e) => {
    const q = await quote(e);
    await e.merchant.intake(owner, { version: 0, paused: true });
    await assert.rejects(e.hold(customer, q.id), code('LISTING_UNAVAILABLE'));
    await assert.rejects(
      e.merchant.intake(owner, { version: 0, paused: false }),
      code('VERSION_CONFLICT'),
    );
    await assert.rejects(
      e.merchant.intake(customer, { version: 1, paused: false }),
      code('FORBIDDEN'),
    );
    await e.repo.transaction(async (tx) => {
      const s = await tx.get<Store>('stores', owner.storeId!);
      await tx.put('stores', { ...s!, active: false });
    });
    await e.merchant.intake(owner, { version: 1, paused: false });
    assert.equal(
      (await e.repo.read((tx) => tx.get<Store>('stores', owner.storeId!)))!.active,
      false,
    );
    await e.repo.transaction(async (tx) => {
      const s = await tx.get<Store>('stores', owner.storeId!);
      await tx.put('stores', { ...s!, active: false });
    });
    await assert.rejects(quote(e), code('LISTING_UNAVAILABLE'));
  }));
test('merchant SOS contact is versioned, scoped, does not close the event, and is hidden from therapists', () =>
  fixture(async (e) => {
    const event: SafetyEvent = {
      id: 'test-safety',
      bookingId: 'fixture-booking',
      staffId: 'staff-aoi',
      storeId: 'store-nagi',
      type: 'SOS',
      status: 'OPEN',
      createdAt: e.now(),
      version: 1,
    };
    await e.repo.transaction((tx) => tx.put('safety', event));
    await assert.rejects(
      e.merchant.safetyContact(other, event.id, {
        version: 1,
        note: 'Tried contacting the therapist',
      }),
      code('NOT_FOUND'),
    );
    await assert.rejects(
      e.merchant.safetyContact(staff, event.id, {
        version: 1,
        note: 'Tried contacting the therapist',
      }),
      code('FORBIDDEN'),
    );
    await e.merchant.safetyContact(owner, event.id, {
      version: 1,
      note: 'Shop contacted therapist and platform',
    });
    const saved = await e.repo.read((tx) => tx.get<SafetyEvent>('safety', event.id));
    assert.equal(saved!.status, 'OPEN');
    assert.equal(saved!.version, 2);
    assert.equal(safetyEventView(staff, saved!).merchantContact, undefined);
    const merchantEvents = await e.care.safetyEvents(owner);
    assert.ok(merchantEvents.find((s) => s.id === event.id)?.merchantContact);
    await assert.rejects(
      e.merchant.safetyContact(owner, event.id, {
        version: 1,
        note: 'Stale follow-up must be rejected',
      }),
      code('VERSION_CONFLICT'),
    );
  }));
