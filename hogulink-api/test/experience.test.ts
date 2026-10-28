import test from 'node:test';
import assert from 'node:assert/strict';
import type { Actor, Booking, ExperienceReview, Listing, Offering } from '@hogulink/contracts';
import { DomainError } from '../src/errors.js';
import {
  customer,
  shop,
  staff,
  admin,
  fixture,
  booking,
  complete,
  reviewScores,
  reviewText,
  moderation,
} from './helpers/experience-fixture.js';
const fail = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;
const other: Actor = { ...customer, id: 'other-customer' };
test('review service name stays tied to the agreed quote after the shop renames the offering', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock);
    await e.repo.transaction(async (tx) => {
      const o = await tx.get<Offering>('offerings', b.quote.offeringId);
      await tx.put('offerings', {
        ...o!,
        name: { ja: '変更後', en: 'Renamed service', 'zh-cn': '更名服务' },
      });
    });
    await e.experience.saveReview(customer, b.id, {
      version: 0,
      scores: reviewScores,
      text: reviewText,
    });
    const r = (await e.experience.customerExperience(customer, b.id)).review!;
    assert.deepEqual(r.serviceName, b.quote.serviceName);
    assert.notEqual(r.serviceName.en, 'Renamed service');
  }));
test('platform removal after a reviewed appeal updates public aggregates and requires every check', () =>
  fixture(async (e, clock) => {
    const { r } = await published(e, clock),
      a = await e.experience.appeal(shop, r.id, {
        reviewVersion: r.version,
        reason: 'This specific publication needs a platform content policy assessment.',
      });
    await assert.rejects(
      () =>
        e.experience.moderate(admin, 'APPEAL', a.id, {
          ...moderation,
          version: a.version,
          decision: 'REMOVE',
          checks: { ...moderation.checks, privacy: false },
        }),
      fail('REVIEW_CHECKS_REQUIRED'),
    );
    assert.equal((await e.experience.publicReviews({ storeId: 'store-nagi' })).summary.count, 1);
    await e.experience.moderate(admin, 'APPEAL', a.id, {
      ...moderation,
      version: a.version,
      decision: 'REMOVE',
    });
    const page = await e.experience.publicReviews({ storeId: 'store-nagi' });
    assert.equal(page.summary.count, 0);
    assert.equal(page.summary.average, null);
    assert.equal(
      (await e.experience.customerExperience(customer, r.bookingId)).review?.status,
      'REMOVED',
    );
  }));
async function published(e: Parameters<Parameters<typeof fixture>[0]>[0], clock: { now: number }) {
  const b = await complete(e, clock),
    r = await e.experience.saveReview(customer, b.id, {
      version: 0,
      scores: reviewScores,
      text: reviewText,
    });
  await e.experience.moderate(admin, 'REVIEW', r.id, { ...moderation, version: r.version });
  return { b, r: (await e.experience.customerExperience(customer, b.id)).review! };
}

test('reviews require a completed charged visit and derive identity from its actual service', () =>
  fixture(async (e, clock) => {
    let b = await booking(e);
    await assert.rejects(
      () =>
        e.experience.saveReview(customer, b.id, {
          version: 0,
          scores: reviewScores,
          text: reviewText,
        }),
      fail('REVIEW_NOT_ELIGIBLE'),
    );
    b = await complete(e, clock, b);
    await assert.rejects(
      () =>
        e.experience.saveReview(other, b.id, {
          version: 0,
          scores: reviewScores,
          text: reviewText,
        }),
      fail('NOT_FOUND'),
    );
    const r = await e.experience.saveReview(customer, b.id, {
      version: 0,
      scores: reviewScores,
      text: reviewText,
    });
    const stored = await e.repo.transaction((tx) =>
      tx.get<ExperienceReview>('experienceReviews', r.id),
    );
    assert.equal(stored?.storeId, b.storeId);
    assert.equal(stored?.listingId, b.assignedListingId);
    assert.equal(stored?.staffId, b.assignedStaffId);
    assert.equal(stored?.customerId, customer.id);
    assert.notEqual(r.id, b.id);
  }));
test('pending reviews and replies never reach public pages or staff metrics; only approved content is counted', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock),
      r = await e.experience.saveReview(customer, b.id, {
        version: 0,
        scores: reviewScores,
        text: reviewText,
      });
    assert.equal(
      (await e.experience.publicReviews({ storeId: 'store-nagi' })).summary.average,
      null,
    );
    assert.equal((await e.experience.staff(staff)).summary.count, 0);
    assert.equal((await e.experience.merchant(shop)).items.length, 0);
    await e.experience.moderate(admin, 'REVIEW', r.id, { ...moderation, version: 1 });
    const reply = await e.experience.reply(shop, r.id, {
      version: 0,
      reviewVersion: 2,
      text: 'Thank you for sharing your experience with our shop.',
    });
    assert.equal(
      (await e.experience.publicReviews({ storeId: 'store-nagi' })).items[0].reply,
      undefined,
    );
    await e.experience.moderate(admin, 'REPLY', reply.id, {
      ...moderation,
      version: reply.version,
    });
    const p = await e.experience.publicReviews({ listingId: 'listing-aoi' });
    assert.equal(p.summary.count, 1);
    assert.equal(p.summary.average, 4);
    assert(p.items[0].reply);
    assert.equal((await e.experience.staff(staff)).summary.count, 1);
    const raw = JSON.stringify(p);
    for (const privateValue of [customer.id, b.id, 'Private QA address', 'customerId', 'paymentId'])
      assert(!raw.includes(privateValue));
  }));
test('one booking has one review record; edits create a revision and require fresh review and reply approval', () =>
  fixture(async (e, clock) => {
    const { b, r } = await published(e, clock);
    const reply = await e.experience.reply(shop, r.id, {
      version: 0,
      reviewVersion: r.version,
      text: 'Thank you for visiting our shop and leaving feedback.',
    });
    await e.experience.moderate(admin, 'REPLY', r.id, { ...moderation, version: reply.version });
    const updated = await e.experience.saveReview(customer, b.id, {
      version: r.version,
      scores: { ...reviewScores, overall: 3 },
      text: 'The revised service feedback remains clear and factual.',
    });
    assert.equal(updated.id, r.id);
    assert.equal((await e.experience.publicReviews({ storeId: 'store-nagi' })).summary.count, 0);
    await e.experience.moderate(admin, 'REVIEW', r.id, { ...moderation, version: updated.version });
    const publicRow = (await e.experience.publicReviews({ storeId: 'store-nagi' })).items[0];
    assert.equal(publicRow.reply, undefined);
    assert.equal(publicRow.scores.overall, 3);
    assert.equal((await e.repo.transaction((tx) => tx.list('experienceReviews'))).length, 1);
    assert.equal((await e.repo.transaction((tx) => tx.list('experienceRevisions'))).length, 2);
  }));
test('simultaneous review submissions have one winner and stale moderation cannot approve changed content', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock),
      input = { version: 0, scores: reviewScores, text: reviewText },
      results = await Promise.allSettled([
        e.experience.saveReview(customer, b.id, input),
        e.experience.saveReview(customer, b.id, input),
      ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const r = (await e.experience.customerExperience(customer, b.id)).review!;
    await e.experience.saveReview(customer, b.id, {
      ...input,
      version: r.version,
      text: 'Updated factual service experience for a new revision.',
    });
    await assert.rejects(
      () => e.experience.moderate(admin, 'REVIEW', r.id, { ...moderation, version: r.version }),
      fail('VERSION_CONFLICT'),
    );
  }));
for (const text of [
  'Contact me at person@example.com',
  'Phone 090-1234-5678',
  'My room number is 204',
  '颜值和身材评价',
  'This will cure anything',
])
  test(`unsafe public text is rejected: ${text}`, () =>
    fixture(async (e, clock) => {
      const b = await complete(e, clock);
      await assert.rejects(
        () => e.experience.saveReview(customer, b.id, { version: 0, scores: reviewScores, text }),
        fail('REVIEW_CONTENT_REJECTED'),
      );
      assert.equal((await e.repo.transaction((tx) => tx.list('experienceReviews'))).length, 0);
    }));
test('scores and fields are strict and permission checks protect moderation and shop replies', () =>
  fixture(async (e, clock) => {
    const { r } = await published(e, clock);
    await assert.rejects(() => e.experience.moderation(customer), fail('FORBIDDEN'));
    await assert.rejects(
      () => e.experience.moderation({ ...admin, id: 'system', adminRole: 'SUPPORT' }),
      fail('FORBIDDEN'),
    );
    await assert.rejects(
      () =>
        e.experience.reply({ ...shop, storeId: 'store-mori' }, r.id, {
          version: 0,
          reviewVersion: r.version,
          text: reviewText,
        }),
      fail('NOT_FOUND'),
    );
    const b = (await e.repo.transaction((tx) => tx.list<Booking>('bookings')))[0];
    await assert.rejects(() =>
      e.experience.saveReview(customer, b.id, {
        version: r.version,
        scores: { ...reviewScores, overall: 6 },
        text: reviewText,
      }),
    );
    await assert.rejects(() =>
      e.experience.saveReview(customer, b.id, {
        version: r.version,
        scores: reviewScores,
        text: reviewText,
        storeId: 'store-mori',
      }),
    );
  }));
test('withdrawal immediately removes review, reply and aggregate score while preserving private revision evidence', () =>
  fixture(async (e, clock) => {
    const { b, r } = await published(e, clock);
    await assert.rejects(
      () => e.experience.withdraw(other, r.id, { version: r.version }),
      fail('NOT_FOUND'),
    );
    await e.experience.withdraw(customer, r.id, { version: r.version });
    assert.equal((await e.experience.publicReviews({ storeId: 'store-nagi' })).summary.count, 0);
    assert.equal(
      (await e.experience.customerExperience(customer, b.id)).review?.status,
      'WITHDRAWN',
    );
    assert.equal((await e.repo.transaction((tx) => tx.list('experienceRevisions'))).length, 1);
  }));
test('shop appeals are private, cannot remove reviews, and platform outcomes are versioned', () =>
  fixture(async (e, clock) => {
    const { r } = await published(e, clock),
      a = await e.experience.appeal(shop, r.id, {
        reviewVersion: r.version,
        reason: 'Private appeal evidence only for platform reviewers.',
      });
    assert.equal((await e.experience.publicReviews({ storeId: 'store-nagi' })).summary.count, 1);
    assert(
      !JSON.stringify(await e.experience.publicReviews({ storeId: 'store-nagi' })).includes(
        'Private appeal',
      ),
    );
    await assert.rejects(
      () =>
        e.experience.appeal(shop, r.id, {
          reviewVersion: r.version,
          reason: 'A repeated private appeal should not create duplicates.',
        }),
      fail('APPEAL_EXISTS'),
    );
    await e.experience.moderate(admin, 'APPEAL', a.id, {
      ...moderation,
      decision: 'UPHOLD',
      version: a.version,
    });
    await assert.rejects(
      () =>
        e.experience.appeal(shop, r.id, {
          reviewVersion: r.version,
          reason: 'Repeated appeal after adjudication must not create a new case.',
        }),
      fail('APPEAL_EXISTS'),
    );
    assert.equal((await e.experience.publicReviews({ storeId: 'store-nagi' })).summary.count, 1);
    await assert.rejects(
      () =>
        e.experience.moderate(admin, 'APPEAL', a.id, {
          ...moderation,
          decision: 'REMOVE',
          version: a.version,
        }),
      fail('VERSION_CONFLICT'),
    );
  }));
test('review edits invalidate pending appeals and stale replies', () =>
  fixture(async (e, clock) => {
    const { b, r } = await published(e, clock),
      a = await e.experience.appeal(shop, r.id, {
        reviewVersion: r.version,
        reason: 'Please check the specific service feedback and evidence.',
      });
    await e.experience.saveReview(customer, b.id, {
      version: r.version,
      scores: reviewScores,
      text: reviewText,
    });
    assert(!(await e.experience.moderation(admin)).items.some((i) => i.id === a.id));
    const stored = await e.repo.transaction((tx) =>
      tx.get<{ status: string }>('experienceAppeals', a.id),
    );
    assert.equal(stored?.status, 'STALE');
  }));
test('refunds do not let a shop erase genuine completed-service feedback', () =>
  fixture(async (e, clock) => {
    const { b, r } = await published(e, clock);
    await e.refund(shop, b.id, b.version, b.capturedAmount);
    assert.equal((await e.experience.publicReviews({ storeId: 'store-nagi' })).summary.count, 1);
    assert.equal((await e.experience.customerExperience(customer, b.id)).eligible, true);
    assert.equal((await e.experience.customerExperience(customer, b.id)).review?.id, r.id);
  }));
test('favorites are private, versioned and tied to the shop listing; unavailable people reveal no stale name or portrait', () =>
  fixture(async (e) => {
    await e.experience.favorite(customer, 'listing-aoi', { version: 0, active: true });
    assert.equal((await e.experience.favorites(other)).length, 0);
    await assert.rejects(
      () => e.experience.favorite(customer, 'listing-aoi', { version: 0, active: false }),
      fail('VERSION_CONFLICT'),
    );
    await e.repo.transaction(async (tx) => {
      const l = await tx.get<Listing>('listings', 'listing-aoi');
      await tx.put('listings', { ...l!, portraitConsent: false, publicationStatus: 'SUSPENDED' });
    });
    const f = (await e.experience.favorites(customer))[0];
    assert.equal(f.available, false);
    assert.equal(f.listing, null);
    assert.equal(f.store, null);
    await e.experience.favorite(customer, 'listing-aoi', { version: f.version, active: false });
    assert.equal((await e.experience.favorites(customer)).length, 0);
  }));
test('rebooking resolves the current shop service and never reuses a time, payment guarantee or old quote', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock);
    await e.repo.transaction(async (tx) => {
      const o = await tx.get<Offering>('offerings', 'store-nagi-60');
      await tx.put('offerings', { ...o!, price: o!.price + 1000, version: o!.version + 1 });
    });
    const next = await e.experience.rebook(customer, b.id);
    assert.equal(next.fulfillmentMode, 'HOME_VISIT');
    assert.equal(next.priceChanged, true);
    assert.equal(next.offeringId, b.quote.offeringId);
    assert.equal(next.listingSlug, 'aoi-tokyo');
    assert.equal(next.bookingMode, 'SCHEDULED');
    const raw = JSON.stringify(next);
    for (const field of ['paymentId', 'holdId', 'quoteId', 'startAt']) assert(!raw.includes(field));
    await assert.rejects(() => e.experience.rebook(other, b.id), fail('NOT_FOUND'));
    await e.repo.transaction(async (tx) => {
      const l = await tx.get<Listing>('listings', 'listing-aoi');
      await tx.put('listings', { ...l!, membershipActive: false });
    });
    await assert.rejects(() => e.experience.rebook(customer, b.id), fail('REBOOK_UNAVAILABLE'));
  }));
test('moderator feedback stays private and all publication checks are required', () =>
  fixture(async (e, clock) => {
    const b = await complete(e, clock),
      r = await e.experience.saveReview(customer, b.id, {
        version: 0,
        scores: reviewScores,
        text: reviewText,
      });
    await assert.rejects(
      () =>
        e.experience.moderate(admin, 'REVIEW', r.id, {
          ...moderation,
          version: r.version,
          checks: { ...moderation.checks, privacy: false },
        }),
      fail('REVIEW_CHECKS_REQUIRED'),
    );
    const reason = 'Private moderation instructions for the applicant only.';
    await e.experience.moderate(admin, 'REVIEW', r.id, {
      ...moderation,
      decision: 'REJECT',
      reason,
      version: r.version,
    });
    assert.equal((await e.experience.customerExperience(customer, b.id)).review?.feedback, reason);
    for (const kind of ['audit', 'outbox'])
      assert(!JSON.stringify(await e.repo.transaction((tx) => tx.list(kind))).includes(reason));
  }));
