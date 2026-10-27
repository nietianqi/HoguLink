import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { assertLocalDemo, uneditedDemoListing, demoMediaData } from './seed-demo-media.mjs';
test('demo importer rejects remote targets and authenticated URL targets', () => {
  for (const origin of [
    'https://example.com',
    'http://localhost.example.com',
    'http://user:password@localhost:4000',
  ])
    assert.throws(() =>
      assertLocalDemo(origin, { mode: 'demo', demoAccessEnabled: true }, { demo: true }),
    );
});
test('demo importer requires demo runtime, enabled demo access and a demo catalog together', () => {
  const origin = 'http://127.0.0.1:4000';
  assert.throws(() =>
    assertLocalDemo(origin, { mode: 'staging', demoAccessEnabled: true }, { demo: true }),
  );
  assert.throws(() =>
    assertLocalDemo(origin, { mode: 'demo', demoAccessEnabled: false }, { demo: true }),
  );
  assert.throws(() =>
    assertLocalDemo(origin, { mode: 'demo', demoAccessEnabled: true }, { demo: false }),
  );
  assert.doesNotThrow(() =>
    assertLocalDemo(origin, { mode: 'demo', demoAccessEnabled: true }, { demo: true }),
  );
});
test('user-changed or reassigned therapist profiles never qualify for automatic sample import', () => {
  const s = demoMediaData.therapists[0],
    original = { id: s.id, slug: s.slug, storeId: s.storeId, photo: '/portraits/aoi.svg' };
  assert.equal(uneditedDemoListing(original, s), true);
  assert.equal(
    uneditedDemoListing({ ...original, photo: '/v1/public/listing-media/custom' }, s),
    false,
  );
  assert.equal(uneditedDemoListing({ ...original, storeId: 'another-shop' }, s), false);
  assert.equal(uneditedDemoListing(undefined, s), false);
});
test('bundled demo records have matching shop ownership and explicit three-language synthetic descriptions', () => {
  assert.equal(demoMediaData.synthetic, true);
  assert.equal(new Set(demoMediaData.therapists.map((p) => p.id)).size, 6);
  assert.equal(new Set(demoMediaData.stores.map((s) => s.id)).size, 3);
  for (const p of demoMediaData.therapists)
    assert.ok(demoMediaData.stores.some((s) => s.id === p.storeId));
  for (const s of demoMediaData.stores) {
    assert.equal(s.photos.length, 3);
    assert.ok(s.photos.includes(s.cover));
    for (const l of ['ja', 'en', 'zh-cn']) {
      assert.ok(s.tagline[l].length > 8 && s.about[l].length > 30);
      assert.match(s.about[l], l === 'ja' ? /デモ|合成/ : l === 'en' ? /synthetic/i : /合成/);
    }
  }
});
test('all twelve generated assets are present, decodable and fit real image upload limits', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('./fixtures/demo-media-manifest.json', import.meta.url), 'utf8'),
  );
  assert.equal(manifest.assets.length, 12);
  assert.equal(manifest.synthetic, true);
  for (const a of manifest.assets) {
    const bytes = await readFile(new URL('../' + a.file, import.meta.url));
    const info = await sharp(bytes).metadata();
    assert.equal(info.format, 'jpeg');
    assert.ok(bytes.length <= 350000);
    assert.ok(info.width >= 500 && info.height >= 500);
    assert.ok(a.prompt.length > 40);
  }
});
