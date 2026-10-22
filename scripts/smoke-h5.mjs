import assert from 'node:assert/strict';
const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000';
const apiOrigin = process.env.SMOKE_API_ORIGIN;
if (
  !apiOrigin ||
  !['127.0.0.1', 'localhost'].includes(new URL(apiOrigin).hostname) ||
  new URL(apiOrigin).port === '4000'
)
  throw new Error('Use npm run smoke:h5 with the isolated API.');
let checks = 0;
const check = (ok, message) => {
  assert.ok(ok, message);
  checks++;
};
let cookie = '';
async function request(path, body, expected = 200, method) {
  const response = await fetch(`${apiOrigin}/v1/${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: {
      Origin: origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie && path !== 'auth/demo' ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  check(response.status === expected, `${path}: expected ${expected}, got ${response.status}`);
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return response.json();
}
const bootstrap = await request('public/h5/bootstrap');
const wrongLanguage = await request(
  'public/staff-listings/listing-ren/availability?offeringId=store-nagi-60&language=zh&area=shinjuku',
);
check(wrongLanguage.slots.length === 0, 'public availability forwards the selected language');
const wrongArea = await request(
  'public/staff-listings/listing-aoi/availability?offeringId=store-nagi-60&area=outside',
);
check(wrongArea.slots.length === 0, 'public availability excludes unsupported areas');
check(bootstrap.currency === 'JPY' && bootstrap.version === 1, 'JPY bootstrap contract');
check(
  bootstrap.features.coupons === false &&
    bootstrap.features.storedValue === false &&
    bootstrap.features.nativeApp === false &&
    bootstrap.features.gpsDistance === true &&
    bootstrap.features.promotions === true,
  'unavailable capabilities stay explicit; device distance and shop offers are live',
);
const rated = await request('public/h5/therapists?limit=5&sort=rating');
check(
  rated.items.every(
    (row) =>
      row.stats &&
      (row.stats.rating === null || (row.stats.rating >= 1 && row.stats.rating <= 5)) &&
      Number.isInteger(row.stats.completed90d) &&
      typeof row.badges?.freeTravel === 'boolean' &&
      (row.compareTotal === undefined || row.compareTotal > row.total),
  ),
  'directory rows carry real stats, badges and a fair comparison price only',
);
const near = await request('public/h5/therapists?limit=5&sort=distance&near=taito');
check(near.items.length > 0, 'distance sort accepts only a ward key');
const statsIds = rated.items.map((row) => row.listing.id).join(',');
const stats = await request(`public/listing-stats?ids=${encodeURIComponent(statsIds)}`);
check(
  rated.items.every((row) => stats[row.listing.id]?.reviewCount === row.stats.reviewCount),
  'listing stats endpoint matches directory stats',
);
const shopIds = [...new Set(rated.items.map((row) => row.store.id))];
const shopStats = await request(`public/store-stats?ids=${shopIds.join(',')},not-a-live-shop`);
check(
  shopIds.every(
    (id) =>
      shopStats[id] &&
      (shopStats[id].rating === null || (shopStats[id].rating >= 1 && shopStats[id].rating <= 5)) &&
      Number.isInteger(shopStats[id].completed90d) &&
      Number.isInteger(shopStats[id].favorites),
  ) && !('not-a-live-shop' in shopStats),
  'shop stats are real aggregates for live shops only',
);
await request('public/store-stats?ids=bad%20id', undefined, 422);
const first = await request('public/h5/therapists?limit=2&sort=price');
check(first.items.length === 2 && first.total >= 2, 'bounded page');
const next = await request(
  `public/h5/therapists?limit=2&sort=price&cursor=${encodeURIComponent(first.nextCursor)}`,
);
check(
  !next.items.some((row) => first.items.some((old) => old.listing.id === row.listing.id)),
  'pagination does not repeat profiles',
);
await request(
  `public/h5/therapists?search=Nagi&cursor=${encodeURIComponent(first.nextCursor)}`,
  undefined,
  400,
);
await request('public/h5/therapists?duration=45', undefined, 422);
await request('public/h5/therapists?area=unknown', undefined, 422);
await request('public/h5/therapists?travel=unknown', undefined, 422);
const freeTravel = await request(
  'public/h5/therapists?travel=free&duration=60&area=taito&language=zh',
);
check(
  freeTravel.items.every((row) => row.offering.transportFee === 0),
  'free travel only advertises actual zero travel charges',
);
const filtered = await request(
  'public/h5/therapists?area=shinjuku&language=zh&duration=90&search=Nagi',
);
check(
  filtered.items.length > 0 &&
    filtered.items.every(
      (row) =>
        row.listing.languages.includes('zh') &&
        row.offering.durationMinutes === 90 &&
        row.store.areas.includes('shinjuku'),
    ),
  'filters combine',
);
check(
  filtered.items.every((row) => !('merchantId' in row.store) && !('acceptanceRule' in row.store)),
  'public store whitelist',
);
await request('customer/overview', undefined, 401);
await request('customer/discovery/guide-choose-your-visit', undefined, 401);
await request('auth/demo', { role: 'CUSTOMER' });
const overview = await request('customer/overview');
const discovery = await request('public/discovery?limit=2');
check(discovery.items.length === 2 && discovery.nextCursor, 'discovery is paginated');
const postId = 'guide-choose-your-visit';
await request(`customer/discovery/${postId}/view`, {});
const repeatView = await request(`customer/discovery/${postId}/view`, {});
check(repeatView.views === 1, 'unique customer read');
const reaction = await request(
  `customer/discovery/${postId}`,
  { version: 0, liked: true, saved: true },
  200,
  'PUT',
);
check(reaction.stats.likes === 1 && reaction.stats.saves === 1, 'aggregate reaction counts');
await request(
  `customer/discovery/${postId}`,
  { version: 0, liked: false, saved: false },
  409,
  'PUT',
);
check((await request('customer/discovery/saved')).length === 1, 'content appears in saved list');
check(
  (await request('customer/overview')).counts.favorites === 1,
  'account total includes saved content',
);
check(
  (await request(`public/discovery/${postId}`)).post.stats.views === 1,
  'public detail real stats',
);
check(overview.counts.closed === 0 && overview.counts.checkout === 0, 'fresh customer counters');
const row = filtered.items[0];
check(
  row.total === row.offering.price + row.offering.transportFee + row.nominationFee,
  'list includes all three fees',
);
const quote = await request(
  'quotes',
  {
    listingId: row.listing.id,
    offeringId: row.offering.id,
    bookingMode: 'SCHEDULED',
    nominationType: 'NOMINATED',
    startAt: row.earliestAt,
    area: 'shinjuku',
    requiredLanguage: 'zh',
  },
  201,
);
check(quote.total === row.total, 'HTTP quote agrees with listed total');
const inbox = await request('customer/inbox?filter=all');
check(inbox.items.length === 0 && inbox.unreadCount === 0, 'empty inbox is real');
await request('auth/demo', { role: 'MERCHANT', storeId: 'store-nagi' });
await request('customer/overview', undefined, 403);
await request('customer/inbox', undefined, 403);
await request(`customer/discovery/${postId}`, undefined, 403);
for (const locale of ['zh-cn', 'ja', 'en'])
  for (const path of [
    '',
    '/discover',
    '/discover?tab=therapists',
    '/discover?tab=shops&area=taito&language=zh',
    '/discover?tab=shops',
    '/shops/nagi-tokyo',
    '/shops/sora-wellness?area=shibuya&language=en',
    '/discover?tab=guides',
    '/discover?tab=safety',
    '/discover/guide-choose-your-visit',
    '/discover/therapist-aoi-tokyo?area=taito&language=zh',
    '/discover/shop-nagi-tokyo',
    '/account/favorites?type=content',
    '/therapists',
    '/therapists?area=taito&language=zh&duration=90&sort=price&search=Nagi',
    '/therapists?travel=free',
    '/therapists?mode=INSTANT',
    '/therapists?sort=rating',
    '/therapists?sort=distance&near=taito',
    '/services?promo=1',
    '/account/messages',
    '/account/messages?channel=orders&filter=bookings',
    '/account/messages?channel=activity',
    '/account/messages?channel=system',
    '/account',
    '/account/bookings',
    '/account/benefits',
    '/account/settings',
    '/legal/privacy',
    '/legal/terms',
  ]) {
    const response = await fetch(`${origin}/${locale}${path}`, {
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    check(response.status === 200, `${locale}${path}: SSR HTTP ${response.status}`);
    check(
      !text.includes('NEXT_HTTP_ERROR_FALLBACK;500'),
      `${locale}${path}: no server error fallback`,
    );
  }
// Follow the actual SSR navigation contract. Provider changes keep browsing
// choices, while old holds, payment IDs and another provider's time stay behind.
function pageLinks(html) {
  return [...html.matchAll(/<a\b([^>]*?)href="([^"]+)"([^>]*)>/g)].map((match) => ({
    attributes: match[1] + match[3],
    url: new URL(match[2].replaceAll('&amp;', '&'), origin),
  }));
}
for (const locale of ['zh-cn', 'ja', 'en']) {
  const preferences = { area: 'shinjuku', language: 'ja', mode: 'INSTANT' };
  const profile = await fetch(
    `${origin}/${locale}/therapists/aoi-tokyo?${new URLSearchParams({
      ...preferences,
      offering: 'store-nagi-90',
      hold: 'old-hold',
      payment: 'old-payment',
      start: 'old-time',
    })}`,
    { signal: AbortSignal.timeout(15000) },
  );
  check(profile.ok, `${locale}: profile navigation is readable`);
  const profileLinks = pageLinks(await profile.text());
  for (const className of ['affiliated-shop', 'sidebar-shop-link']) {
    const link = profileLinks.find((item) => item.attributes.includes(className));
    check(
      link && link.url.pathname === `/${locale}/shops/nagi-tokyo`,
      `${locale}: ${className} opens the same shop`,
    );
    check(
      link &&
        Object.entries({ ...preferences, offering: 'store-nagi-90' }).every(
          ([key, value]) => link.url.searchParams.get(key) === value,
        ),
      `${locale}: ${className} preserves booking preferences and menu`,
    );
    check(
      link && ['hold', 'payment', 'start'].every((key) => !link.url.searchParams.has(key)),
      `${locale}: ${className} drops transaction state`,
    );
  }
  const shop = await fetch(
    `${origin}/${locale}/shops/nagi-tokyo?${new URLSearchParams({
      ...preferences,
      mode: 'SCHEDULED',
      offering: 'store-nagi-90',
      hold: 'old-hold',
      start: 'old-time',
    })}`,
    { signal: AbortSignal.timeout(15000) },
  );
  check(shop.ok, `${locale}: shop navigation is readable`);
  const shopLinks = pageLinks(await shop.text());
  const menu = shopLinks.find(
    (item) =>
      item.url.pathname.startsWith(`/${locale}/book/`) &&
      item.url.searchParams.get('nomination') === 'FREE' &&
      item.url.searchParams.get('offering') === 'store-nagi-90',
  );
  check(
    menu &&
      Object.entries({ ...preferences, mode: 'SCHEDULED' }).every(
        ([key, value]) => menu.url.searchParams.get(key) === value,
      ),
    `${locale}: shop-arranged checkout preserves preferences`,
  );
  check(
    menu && ['hold', 'start'].every((key) => !menu.url.searchParams.has(key)),
    `${locale}: checkout does not reuse stale transaction state`,
  );
  const back = shopLinks.find((item) => item.attributes.includes('mobile-back'));
  check(
    back &&
      Object.entries({ ...preferences, mode: 'SCHEDULED', tab: 'shops' }).every(
        ([key, value]) => back.url.searchParams.get(key) === value,
      ),
    `${locale}: H5 back navigation preserves booking mode`,
  );
  const booking = await fetch(
    `${origin}/${locale}/book/aoi-tokyo?${new URLSearchParams({
      ...preferences,
      mode: 'SCHEDULED',
      offering: 'store-nagi-90',
      nomination: 'FREE',
      start: '1792486800000',
      hold: 'old-hold',
      payment: 'old-payment',
    })}`,
    { signal: AbortSignal.timeout(15000) },
  );
  check(booking.ok, `${locale}: planner return navigation is readable`);
  const bookingLinks = pageLinks(await booking.text());
  const returnLink = bookingLinks.find((item) => item.attributes.includes('class="back-link"'));
  check(
    returnLink &&
      Object.entries({
        ...preferences,
        mode: 'SCHEDULED',
        offering: 'store-nagi-90',
        nomination: 'FREE',
        start: '1792486800000',
      }).every(([key, value]) => returnLink.url.searchParams.get(key) === value),
    `${locale}: planner back keeps the same selection`,
  );
  check(
    returnLink && ['hold', 'payment'].every((key) => !returnLink.url.searchParams.has(key)),
    `${locale}: planner back drops transaction credentials`,
  );
}
console.log(
  `H5 contracts and three-language SSR: ${checks} checks passed. Write checks used the disposable API.`,
);
