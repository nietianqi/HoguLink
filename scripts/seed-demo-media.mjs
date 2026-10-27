import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

export const demoMediaData = JSON.parse(
  await readFile(new URL('./fixtures/demo-media-data.json', import.meta.url), 'utf8'),
);
const publicRoot = new URL('../hogulink-web/public/', import.meta.url);
export function assertLocalDemo(apiOrigin, health, catalog) {
  const url = new URL(apiOrigin);
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password,
    'Demo import requires a local API',
  );
  assert.ok(
    health.mode === 'demo' && health.demoAccessEnabled === true && catalog.demo === true,
    'Demo import is disabled outside an explicitly enabled demo runtime',
  );
}
export function uneditedDemoListing(listing, spec) {
  return (
    !!listing &&
    listing.id === spec.id &&
    listing.slug === spec.slug &&
    listing.storeId === spec.storeId &&
    listing.photo === `/portraits/${spec.slug.replace('-tokyo', '')}.svg`
  );
}
export async function seedDemoMedia({
  apiOrigin = process.env.DEMO_API_ORIGIN || 'http://127.0.0.1:4000',
  webOrigin = process.env.DEMO_WEB_ORIGIN || 'http://localhost:3000',
} = {}) {
  // Reject remote targets before even sending a health request.
  assertLocalDemo(apiOrigin, { mode: 'demo', demoAccessEnabled: true }, { demo: true });
  const headers = { Origin: webOrigin },
    cookies = [],
    merchants = new Map(),
    report = { therapistsAdded: 0, shopsAdded: 0, skipped: [] };
  async function call(path, body, cookie, method = body === undefined ? 'GET' : 'POST') {
    const r = await fetch(new URL('/v1/' + path, apiOrigin), {
      method,
      headers: {
        ...headers,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const data = await r.json();
    if (!r.ok)
      throw Error(`${method} ${path}: ${r.status} ${data.error?.code ?? 'request failed'}`);
    return data;
  }
  const health = await call('health'),
    catalog = await call('public/staff-listings?fulfillmentMode=ALL');
  assertLocalDemo(apiOrigin, health, catalog);
  // Preflight every bundled image before creating sessions or changing any record.
  const images = new Map();
  for (const path of new Set([
    ...demoMediaData.stores.flatMap((s) => s.photos),
    ...demoMediaData.therapists.map((p) => p.photo),
  ])) {
    assert.match(path, /^\/images\/[a-z0-9/-]+\.(jpg|png)$/);
    const bytes = await sharp(await readFile(new URL(path.slice(1), publicRoot)))
      .rotate()
      .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    assert.ok(bytes.length <= 350000, `Image exceeds upload limit: ${path}`);
    images.set(path, { mime: 'image/jpeg', data: bytes.toString('base64') });
  }
  async function login(role, extra = {}) {
    const r = await fetch(new URL('/v1/auth/demo', apiOrigin), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, ...extra }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw Error(`Demo ${role} sign-in failed (${r.status})`);
    const actor = await r.json(),
      cookie = r.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie && actor.role === role, 'Invalid demo session');
    cookies.push(cookie);
    return { cookie, actor };
  }
  async function merchant(storeId) {
    if (!merchants.has(storeId)) {
      const session = await login('MERCHANT', { storeId });
      assert.equal(session.actor.storeId, storeId);
      merchants.set(storeId, session.cookie);
    }
    return merchants.get(storeId);
  }
  try {
    const admin = (await login('ADMIN')).cookie;
    for (const spec of demoMediaData.therapists) {
      const listing = catalog.listings.find((l) => l.id === spec.id),
        store = catalog.stores.find((s) => s.id === spec.storeId);
      if (!uneditedDemoListing(listing, spec) || !store?.legalName.includes('Demo')) {
        report.skipped.push(spec.id + ': existing or unavailable profile');
        continue;
      }
      const staff = (await login('STAFF', { staffId: spec.staffId })).cookie;
      const current = await call(
        'media?listingId=' + encodeURIComponent(spec.id),
        undefined,
        staff,
      );
      if (current.items.length) {
        report.skipped.push(spec.id + ': existing media preserved');
        continue;
      }
      let media = await call('media/photos', { ...images.get(spec.photo), consent: true }, staff);
      media = await call(
        `media/${media.id}/confirm`,
        {
          version: media.version,
          approved: true,
          note: 'Synthetic demo fixture, not a real consent record.',
        },
        await merchant(spec.storeId),
      );
      await call(
        `admin/listing-media/${media.id}/review`,
        {
          version: media.version,
          approved: true,
          note: 'DEMO synthetic character and image; not a real identity or qualification review.',
        },
        admin,
      );
      report.therapistsAdded++;
    }
    for (const spec of demoMediaData.stores) {
      const store = catalog.stores.find(
        (s) => s.id === spec.id && s.slug === spec.slug && s.legalName.includes('Demo'),
      );
      if (!store) {
        report.skipped.push(spec.id + ': unavailable demo shop');
        continue;
      }
      const owner = await merchant(spec.id),
        w = await call('merchant/storefront', undefined, owner);
      if (w.published || w.draft.version !== 0 || w.assets.length) {
        report.skipped.push(spec.id + ': existing shop content preserved');
        continue;
      }
      const uploaded = [];
      for (const path of spec.photos)
        uploaded.push(await call('merchant/storefront/images', images.get(path), owner));
      const content = {
        tagline: spec.tagline,
        about: spec.about,
        logoId: null,
        coverId: uploaded[spec.photos.indexOf(spec.cover)].id,
        photoIds: uploaded.map((a) => a.id),
        featuredOfferingIds: w.offerings.slice(0, 3).map((o) => o.id),
        teamListingIds: w.team.map((l) => l.id).slice(0, 30),
      };
      let draft = await call(
        'merchant/storefront',
        { version: w.draft.version, content },
        owner,
        'PUT',
      );
      draft = await call('merchant/storefront/submit', { version: draft.version }, owner);
      await call(
        `admin/storefronts/${spec.id}/review`,
        {
          version: draft.version,
          approved: true,
          note: 'DEMO synthetic brand illustration, not an actual venue or qualification review. Existing service eligibility is unchanged.',
        },
        admin,
      );
      report.shopsAdded++;
    }
    return report;
  } finally {
    for (const cookie of cookies) await call('auth/logout', {}, cookie).catch(() => {});
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(await seedDemoMedia(), null, 2));
}
