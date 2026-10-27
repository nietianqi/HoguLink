import assert from 'node:assert/strict';
import sharp from 'sharp';
const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000',
  base = process.env.SMOKE_API_ORIGIN;
if (!base) throw Error('Run with the isolated smoke harness.');
let checks = 0;
const check = (condition, label) => {
  assert.ok(condition, label);
  checks++;
};
async function call(
  cookie,
  path,
  body,
  expected = 200,
  method = body === undefined ? 'GET' : 'POST',
) {
  const r = await fetch(`${base}/v1/${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  assert.equal(r.status, expected, `${path}: ${JSON.stringify(data)}`);
  checks++;
  return data;
}
async function login(role, extra = {}) {
  const r = await fetch(`${base}/v1/auth/demo`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, ...extra }),
  });
  check(r.ok, `Login ${role}`);
  return r.headers.get('set-cookie').split(';')[0];
}
const m = await login('MERCHANT'),
  a = await login('ADMIN'),
  c = await login('CUSTOMER'),
  s = await login('STAFF', { staffId: 'staff-aoi' }),
  other = await login('MERCHANT', { storeId: 'store-mori' });
await call(c, 'merchant/storefront', undefined, 403);
await call(s, 'merchant/storefront', undefined, 403);
await call(m, 'admin/storefronts', undefined, 403);
const w = await call(m, 'merchant/storefront');
check(w.draft.version === 0 && !w.published, 'Fresh shop page has no fabricated published content');
const image = {
  mime: 'image/png',
  data: (
    await sharp({ create: { width: 100, height: 60, channels: 3, background: '#0e8b65' } })
      .png()
      .toBuffer()
  ).toString('base64'),
};
const asset = await call(m, 'merchant/storefront/images', image, 201);
const unused = await call(m, 'merchant/storefront/images', image, 201);
await call(other, 'merchant/storefront/images/' + unused.id, undefined, 404, 'DELETE');
await call(m, 'merchant/storefront/images/' + unused.id, undefined, 200, 'DELETE');
async function file(cookie, expected) {
  const r = await fetch(`${base}${asset.url}`, {
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
  });
  check(r.status === expected, `Image privacy ${expected}`);
  if (expected === 200) {
    check(r.headers.get('content-type') === 'image/jpeg', 'Images are sanitized JPEG');
    check(
      r.headers.get('cache-control') === 'private, no-store',
      'No public cache after withdrawal',
    );
    await r.arrayBuffer();
  }
}
await file('', 404);
await file(other, 404);
await file(m, 200);
const content = {
  tagline: { ja: '東京でゆっくり', en: 'Relax in Tokyo', 'zh-cn': '在东京，从容放松' },
  about: {
    ja: 'お店がサービスと担当者を手配します。',
    en: 'Our shop arranges your relaxation service and therapist.',
    'zh-cn': '店铺提供放松服务，并安排合适的技师。',
  },
  logoId: asset.id,
  coverId: asset.id,
  photoIds: [asset.id],
  featuredOfferingIds: ['store-nagi-60'],
  teamListingIds: ['listing-aoi'],
};
let d = await call(m, 'merchant/storefront', { version: w.draft.version, content }, 200, 'PUT');
await call(m, 'merchant/storefront/images/' + asset.id, undefined, 409, 'DELETE');
await call(m, 'merchant/storefront', { version: 0, content }, 409, 'PUT');
await call(other, 'merchant/storefront', { version: 0, content }, 400, 'PUT');
d = await call(m, 'merchant/storefront/submit', { version: d.version });
await call(m, 'merchant/storefront', { version: d.version, content }, 409, 'PUT');
check(
  (await call(a, 'admin/storefronts')).some((x) => x.id === w.store.id),
  'Submitted page appears in the platform queue',
);
let pub = await call('', 'public/stores/' + w.store.slug);
check(!pub.storefront, 'Draft is absent from public catalog');
await file('', 404);
d = await call(a, `admin/storefronts/${w.store.id}/review`, {
  version: d.version,
  approved: true,
  note: 'HTTP QA: verified image and three language introductions.',
});
await file('', 200);
pub = await call('', 'public/stores/' + w.store.slug);
check(pub.storefront.cover.id === asset.id, 'Approved snapshot appears in public shop data');
check(!JSON.stringify(pub).includes('HTTP QA:'), 'Review notes stay private');
const published = pub.storefront;
d = await call(
  m,
  'merchant/storefront',
  {
    version: d.version,
    content: { ...content, tagline: { ...content.tagline, en: 'Draft revision' } },
  },
  200,
  'PUT',
);
d = await call(m, 'merchant/storefront/submit', { version: d.version });
check(
  JSON.stringify((await call('', 'public/stores/' + w.store.slug)).storefront) ===
    JSON.stringify(published),
  'Pending revision retains prior published page',
);
const stale = d.version;
d = await call(m, 'merchant/storefront/withdraw', { version: d.version });
await call(
  a,
  `admin/storefronts/${w.store.id}/review`,
  { version: stale, approved: true, note: 'Stale review cannot publish.' },
  409,
);
d = await call(m, 'merchant/storefront/submit', { version: d.version });
d = await call(a, `admin/storefronts/${w.store.id}/review`, {
  version: d.version,
  approved: false,
  note: 'Please revise the short introduction.',
});
check(d.status === 'CHANGES_REQUESTED', 'Shop receives a returned revision');
for (const l of ['ja', 'en', 'zh-cn']) {
  const r = await fetch(`${origin}/${l}/shops/${w.store.slug}`),
    html = await r.text();
  check(r.ok, `${l} shop SSR`);
  check(html.includes('storefront-layout'), `${l} brand layout`);
  check((html.match(/id="reserve"/g) || []).length === 1, `${l} uses a single booking form`);
  check(
    html.indexOf('id="team"') < html.indexOf('id="reserve"'),
    `${l} mobile DOM puts team before reservation`,
  );
}
console.log(
  `Storefront HTTP smoke passed: ${checks} checks. Private drafts, image access, review, withdrawal, version conflicts and trilingual SSR verified.`,
);
