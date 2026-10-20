import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';
import { Repository } from '../src/repository.js';
import { seed } from '../src/seed.js';
import { listingStats, storeStats } from '../src/mobile.js';

const day = 86_400_000;

async function fixture(fn: (e: Engine) => Promise<void>) {
  const repo = new Repository('', ':memory:');
  await repo.init();
  await seed(repo);
  const clock = { now: Date.UTC(2026, 9, 20, 0) };
  const e = new Engine(repo, () => clock.now);
  try {
    await fn(e);
  } finally {
    await repo.close();
  }
}

test('shop stats count only that shop: approved reviews, completions within 90 days, active shop saves', () =>
  fixture(async (e) => {
    const since = e.now() - 90 * day;
    await e.repo.transaction(async (tx) => {
      for (const [id, storeId, status, overall] of [
        ['nagi-a', 'store-nagi', 'APPROVED', 5],
        ['nagi-b', 'store-nagi', 'APPROVED', 4],
        ['nagi-pending', 'store-nagi', 'PENDING', 1],
        ['nagi-rejected', 'store-nagi', 'REJECTED', 1],
        ['mori-a', 'store-mori', 'APPROVED', 2],
      ] as const)
        await tx.put('experienceReviews', { id, storeId, status, scores: { overall } });
      for (const [id, storeId, status, completedAt] of [
        ['done-recent', 'store-nagi', 'COMPLETED', e.now()],
        ['done-boundary', 'store-nagi', 'COMPLETED', since],
        ['done-old', 'store-nagi', 'COMPLETED', since - 1],
        ['confirmed', 'store-nagi', 'CONFIRMED', e.now()],
        ['mori-done', 'store-mori', 'COMPLETED', e.now()],
      ] as const)
        await tx.put('bookings', { id, storeId, status, updatedAt: e.now(), completedAt });
      await tx.put('storeFavorites', { id: 'saved', storeId: 'store-nagi', active: true });
      await tx.put('storeFavorites', { id: 'unsaved', storeId: 'store-nagi', active: false });
      // A therapist favorite is not a shop save.
      await tx.put('favorites', { id: 'person', listingId: 'listing-aoi', active: true });
    });
    assert.deepEqual(await storeStats(e, ['store-nagi', 'store-sora', 'store-nagi']), {
      'store-nagi': { rating: 4.5, reviewCount: 2, completed90d: 2, favorites: 1 },
      'store-sora': { rating: null, reviewCount: 0, completed90d: 0, favorites: 0 },
    });
    assert.equal((await storeStats(e, ['store-mori']))['store-mori'].rating, 2);
    assert.deepEqual(await storeStats(e, []), {});
    // The shared aggregate still keys therapist stats by listing.
    assert.equal((await listingStats(e, ['listing-aoi']))['listing-aoi'].favorites, 1);
  }));

test('shop stats run in a read-only transaction', () =>
  fixture(async (e) => {
    const before = await e.repo.transaction((tx) => tx.list('meta'));
    await storeStats(e, ['store-nagi']);
    assert.deepEqual(await e.repo.transaction((tx) => tx.list('meta')), before);
  }));
