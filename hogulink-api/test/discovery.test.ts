import test from 'node:test';
import assert from 'node:assert/strict';
import type { Listing, Offering, Store } from '@hogulink/contracts';
import { fixture, customer, shop } from './helpers/experience-fixture.js';
const guide = 'guide-choose-your-visit';
const another = { ...customer, id: 'another-customer' };

test('discovery feed has bounded complete cursor pages, real zero stats and filter-bound cursors', () =>
  fixture(async (e) => {
    const first = await e.discovery.feed({ limit: 2 });
    assert.equal(first.items.length, 2);
    assert.ok(first.nextCursor);
    const ids = first.items.map((p) => p.id);
    let cursor: string | null = first.nextCursor;
    while (cursor) {
      const next = await e.discovery.feed({ limit: 2, cursor });
      ids.push(...next.items.map((p) => p.id));
      cursor = next.nextCursor;
    }
    assert.equal(ids.length, first.total);
    assert.equal(new Set(ids).size, first.total);
    assert(first.items.every((p) => Object.values(p.stats).every((n) => n === 0)));
    await assert.rejects(e.discovery.feed({ tab: 'shops', cursor: first.nextCursor }), {
      code: 'INVALID_CURSOR',
    });
    await assert.rejects(e.discovery.feed({ cursor: 'bad' }), { code: 'INVALID_CURSOR' });
    await assert.rejects(e.discovery.feed({ area: 'unknown' }));
    await assert.rejects(e.discovery.feed({ limit: 21 }));
  }));
test('discovery filters combine and normalize multilingual searches without filtering out general guides', () =>
  fixture(async (e) => {
    const result = await e.discovery.feed({ tab: 'therapists', area: 'taito', language: 'zh' });
    assert(result.items.length);
    const qualified = await e.publicCatalog({ area: 'taito', language: 'zh' });
    assert(
      result.items.every((p) =>
        qualified.listings.some(
          (person) => `therapist-${person.slug}` === p.id && person.languages.includes('zh'),
        ),
      ),
    );
    assert(!result.items.some((p) => p.storeId === 'store-sora'));
    const shops = await e.discovery.feed({ tab: 'shops', search: 'Ｎａｇｉ' });
    assert.equal(shops.items.length, 1);
    assert.equal(shops.items[0].storeId, 'store-nagi');
    assert(
      (await e.discovery.feed({ tab: 'safety', area: 'taito', language: 'zh' })).items.every(
        (p) => p.kind === 'safety',
      ),
    );
    assert.equal((await e.discovery.feed({ search: 'unmatched-query' })).total, 0);
  }));
test('public discovery excludes suspended portraits, inactive menus and shops with no eligible supply', () =>
  fixture(async (e) => {
    const old = await e.discovery.feed({ limit: 1 });
    await e.repo.transaction(async (tx) => {
      for (const p of await tx.list<Listing>('listings'))
        await tx.put('listings', { ...p, portraitConsent: false });
    });
    const result = await e.discovery.feed();
    assert(result.items.every((p) => ['guide', 'safety'].includes(p.kind)));
    await assert.rejects(e.discovery.detail('therapist-aoi-tokyo'), { code: 'NOT_FOUND' });
    await assert.rejects(e.discovery.feed({ limit: 1, cursor: old.nextCursor }), {
      code: 'INVALID_CURSOR',
    });
  }));
test('discovery requires a qualified relaxation offering for profile and shop cards', () =>
  fixture(async (e) => {
    await e.repo.transaction(async (tx) => {
      for (const o of await tx.list<Offering>('offerings'))
        if (o.storeId === 'store-nagi') await tx.put('offerings', { ...o, active: false });
    });
    assert(!(await e.discovery.feed({ limit: 20 })).items.some((p) => p.storeId === 'store-nagi'));
  }));
test('public detail uses only authored guidance and public profile fields, and GET never records reads', () =>
  fixture(async (e) => {
    const detail = await e.discovery.detail(guide);
    for (const l of ['zh-cn', 'ja', 'en'] as const) {
      assert(detail.post.title[l]);
      assert(detail.sections.every((s) => s.heading[l] && s.text[l]));
    }
    assert(detail.related.every((p) => p.id !== guide));
    const raw = JSON.stringify(await e.discovery.detail('therapist-aoi-tokyo'));
    assert(!raw.includes('merchantId'));
    assert(!raw.includes('customerId'));
    assert(!raw.includes('emergencyContact'));
    assert.equal(await e.repo.read((tx) => tx.count('discoveryViews', {})), 0);
  }));
test('reads are idempotent per customer and do not increment reaction versions', () =>
  fixture(async (e) => {
    assert.equal((await e.discovery.view(customer, guide)).views, 1);
    assert.equal((await e.discovery.view(customer, guide)).views, 1);
    assert.equal((await e.discovery.view(another, guide)).views, 2);
    assert.equal((await e.discovery.state(customer, guide)).version, 0);
    assert.equal((await e.discovery.detail(guide)).post.stats.views, 2);
  }));
test('reactions persist privately, use optimistic versions and have accurate aggregate counts', () =>
  fixture(async (e) => {
    const next = await e.discovery.react(customer, guide, { version: 0, liked: true, saved: true });
    assert.equal(next.version, 1);
    assert.deepEqual(await e.discovery.state(another, guide), {
      liked: false,
      saved: false,
      version: 0,
    });
    await assert.rejects(
      e.discovery.react(customer, guide, { version: 0, liked: false, saved: false }),
      { code: 'VERSION_CONFLICT' },
    );
    assert.deepEqual((await e.discovery.detail(guide)).post.stats, {
      views: 0,
      likes: 1,
      saves: 1,
    });
    assert.equal((await e.discovery.saved(customer)).length, 1);
    assert.equal((await e.experience.overview(customer)).counts.favorites, 1);
    assert.equal((await e.discovery.saved(another)).length, 0);
    await e.discovery.react(customer, guide, { version: 1, liked: true, saved: false });
    assert.equal((await e.discovery.saved(customer)).length, 0);
    assert.equal((await e.experience.overview(customer)).counts.favorites, 0);
    assert.deepEqual((await e.discovery.detail(guide)).post.stats, {
      views: 0,
      likes: 1,
      saves: 0,
    });
  }));
test('simultaneous stale writes cannot lose a reaction update', () =>
  fixture(async (e) => {
    const results = await Promise.allSettled([
      e.discovery.react(customer, guide, { version: 0, liked: true, saved: false }),
      e.discovery.react(customer, guide, { version: 0, liked: false, saved: true }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await e.discovery.state(customer, guide)).version, 1);
  }));
test('unpublished content is unavailable publicly but a customer can remove their saved receipt', () =>
  fixture(async (e) => {
    const id = 'therapist-aoi-tokyo';
    await e.discovery.react(customer, id, { version: 0, liked: true, saved: true });
    await e.repo.transaction(async (tx) => {
      const p = (await tx.get<Listing>('listings', 'listing-aoi'))!;
      await tx.put('listings', { ...p, publicationStatus: 'SUSPENDED' });
    });
    assert.equal((await e.discovery.saved(customer))[0].post, null);
    await assert.rejects(
      e.discovery.react(customer, id, { version: 1, liked: true, saved: false }),
      { code: 'CONTENT_UNAVAILABLE' },
    );
    await assert.rejects(e.discovery.view(customer, id), { code: 'NOT_FOUND' });
    await e.discovery.react(customer, id, { version: 1, liked: false, saved: false });
    assert.equal((await e.discovery.saved(customer)).length, 0);
  }));
test('only verified customers may read or change personal discovery interactions', () =>
  fixture(async (e) => {
    for (const actor of [shop, { ...customer, verificationLevel: 0 }]) {
      await assert.rejects(e.discovery.state(actor, guide), { code: 'FORBIDDEN' });
      await assert.rejects(e.discovery.saved(actor), { code: 'FORBIDDEN' });
      await assert.rejects(
        e.discovery.react(actor, guide, { version: 0, liked: true, saved: true }),
        { code: 'FORBIDDEN' },
      );
      await assert.rejects(e.discovery.view(actor, guide), { code: 'FORBIDDEN' });
    }
  }));
test('saved-content cap still allows likes and removals', () =>
  fixture(async (e) => {
    await e.repo.transaction(async (tx) => {
      for (let i = 0; i < 100; i++)
        await tx.put('discoveryReactions', {
          id: `cap-${i}`,
          customerId: customer.id,
          postId: `removed-${i}`,
          liked: false,
          saved: true,
          version: 1,
          updatedAt: i,
        });
    });
    await assert.rejects(
      e.discovery.react(customer, guide, { version: 0, liked: false, saved: true }),
      { code: 'FAVORITE_LIMIT' },
    );
    assert.equal(
      (await e.discovery.react(customer, guide, { version: 0, liked: true, saved: false })).liked,
      true,
    );
  }));
