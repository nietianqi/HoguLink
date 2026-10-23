import test from 'node:test';
import assert from 'node:assert/strict';
import { areaCentroids, type MobileTherapist } from '@hogulink/contracts';
import {
  directoryQuery,
  directoryHref,
  therapistSelection,
  directoryTime,
  directoryDistance,
} from '../hogulink-web/src/lib/therapist-directory-model';

test('directory distance waits for a valid consented point and a known service area', () => {
  assert.equal(directoryDistance(null, ['shinjuku']), null);
  assert.equal(directoryDistance({ lat: NaN, lng: 139.7 }, ['shinjuku']), null);
  assert.equal(directoryDistance({ lat: 35.7, lng: Infinity }, ['shinjuku']), null);
  assert.equal(directoryDistance({ lat: 91, lng: 139.7 }, ['shinjuku']), null);
  assert.equal(directoryDistance({ lat: 35.7, lng: -181 }, ['shinjuku']), null);
  assert.equal(directoryDistance(areaCentroids.shinjuku, ['unknown']), null);
  assert.equal(directoryDistance(areaCentroids.shinjuku, []), null);
});

test('directory distance uses the nearest service area and never rounds a short estimate to zero km', () => {
  const close = directoryDistance(areaCentroids.shinjuku, ['chuo', 'shinjuku']);
  assert.equal(close?.area, 'shinjuku');
  assert.equal(close?.displayKm, '<0.1');
  const nearby = directoryDistance(areaCentroids.chuo, ['shinjuku']);
  assert(nearby && nearby.km > 0 && nearby.km < 10);
  assert.match(nearby.displayKm, /^\d+\.\d$/);
  const far = directoryDistance({ lat: 0, lng: 0 }, ['shinjuku']);
  assert(far && far.km > 10);
  assert.match(far.displayKm, /^\d+$/);
});

test('directory URLs normalize supported combinations and discard checkout state and stale cursor', () => {
  const q = directoryQuery({
    area: 'taito',
    language: 'zh',
    mode: 'INSTANT',
    duration: '90',
    travel: 'free',
    sort: 'price',
    search: '  Ｎａｇｉ  ',
    cursor: 'stale',
    start: '123',
    nomination: 'FREE',
    offering: 'old',
    token: 'secret',
  });
  assert.deepEqual(q, {
    mode: 'INSTANT',
    duration: '90',
    sort: 'price',
    area: 'taito',
    language: 'zh',
    search: 'Nagi',
    travel: 'free',
  });
  const url = new URL(directoryHref('ja', q), 'http://localhost');
  assert.equal(url.pathname, '/ja/therapists');
  assert.equal(url.searchParams.get('search'), 'Nagi');
  assert.equal(url.searchParams.has('cursor'), false);
  assert.deepEqual(
    directoryQuery({
      area: ['taito'],
      language: 'de',
      mode: 'weird',
      duration: ['90'],
      sort: 'random',
      travel: 'false',
    }),
    { mode: 'SCHEDULED', duration: '60', sort: 'recommended' },
  );
  assert.equal(directoryQuery({ search: 'a'.repeat(90) }).search.length, 80);
});

test('directory booking links freeze only the displayed menu, nominated fee and latest time with area and language', () => {
  const row = { offering: { id: 'shown-90' }, earliestAt: 1792314000000 } as MobileTherapist;
  const selection = therapistSelection(
    {
      area: 'taito',
      language: 'zh',
      mode: 'INSTANT',
      duration: '90',
      sort: 'price',
      travel: 'free',
      search: 'Nagi',
      nomination: 'FREE',
      offering: 'stale',
      start: 'old',
      hold: 'private',
    },
    row,
  );
  assert.deepEqual(Object.fromEntries(selection), {
    mode: 'INSTANT',
    area: 'taito',
    language: 'zh',
    nomination: 'NOMINATED',
    offering: 'shown-90',
    start: '1792314000000',
  });
  assert.equal(therapistSelection({}, { ...row, earliestAt: null }).has('start'), false);
});

test('earliest time labels use Tokyo dates through UTC midnight across all locales', () => {
  const checked = Date.UTC(2026, 9, 18, 16);
  const sameDay = Date.UTC(2026, 9, 19, 3);
  for (const locale of ['zh-cn', 'ja', 'en'] as const) {
    assert.equal(directoryTime(locale, sameDay, checked, 'TODAY'), 'TODAY 12:00');
    assert.equal(
      directoryTime(locale, Date.UTC(2026, 9, 19, 16), checked, 'TODAY').includes('TODAY'),
      false,
    );
  }
});

test('distance sort keeps only the coarse ward key and needs one; raw coordinates never pass', () => {
  assert.deepEqual(directoryQuery({ sort: 'distance', near: 'taito' }), {
    mode: 'SCHEDULED',
    duration: '60',
    sort: 'distance',
    near: 'taito',
  });
  // No ward → fall back to the recommended order instead of a request the API rejects.
  assert.equal(directoryQuery({ sort: 'distance' }).sort, 'recommended');
  assert.equal(directoryQuery({ sort: 'distance', near: '35.71,139.77' }).sort, 'recommended');
  assert.equal('near' in directoryQuery({ sort: 'price', near: 'taito' }), false);
  assert.equal(directoryQuery({ sort: 'rating' }).sort, 'rating');
  for (const key of ['lat', 'lng', 'latitude', 'coords'])
    assert.equal(key in directoryQuery({ [key]: '35.7', sort: 'distance', near: 'chuo' }), false);
});
