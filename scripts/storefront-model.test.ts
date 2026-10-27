import test from 'node:test';
import assert from 'node:assert/strict';
import {
  storefrontOrder,
  storefrontChecklist,
  storefrontHours,
} from '../hogulink-web/src/lib/storefront-model.js';

test('shop hours distinguish overnight reception from all-day opening in three languages', () => {
  for (const l of ['ja', 'en', 'zh-cn'] as const)
    assert.equal(storefrontHours({ startMinute: 0, endMinute: 1440 }, l), '00:00–24:00');
  assert.equal(storefrontHours({ startMinute: 1320, endMinute: 120 }, 'zh-cn'), '22:00–次日 02:00');
  assert.equal(storefrontHours({ startMinute: 1320, endMinute: 120 }, 'ja'), '22:00–翌日 02:00');
  assert.equal(
    storefrontHours({ startMinute: 1320, endMinute: 120 }, 'en'),
    '22:00–next day 02:00',
  );
});
test('editorial order preserves eligibility and stable unfeatured order', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(storefrontOrder(items, ['removed', 'c', 'a']), [
    { id: 'c' },
    { id: 'a' },
    { id: 'b' },
  ]);
  assert.deepEqual(items, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
});
test('profile checklist requires all three introductions and three photos without inventing completeness', () => {
  assert.deepEqual(
    storefrontChecklist({
      logoId: null,
      coverId: null,
      photoIds: ['one'],
      tagline: { ja: '', en: '', 'zh-cn': '' },
      about: { ja: '紹介文が設定されています', en: 'A complete introduction', 'zh-cn': '' },
      featuredOfferingIds: [],
      teamListingIds: [],
    }),
    { logo: false, cover: false, gallery: false, introduction: false },
  );
});
