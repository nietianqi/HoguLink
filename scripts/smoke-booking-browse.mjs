import assert from 'node:assert/strict';
const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw Error('Local preview required');
let checks = 0;
const check = (value, message) => {
  assert.ok(value, message);
  checks++;
};
const decode = (value) =>
  value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'").replaceAll('&quot;', '"');
function links(html) {
  return [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g)].map(
    (m) => new URL(decode(m[1]), origin),
  );
}
for (const locale of ['zh-cn', 'ja', 'en']) {
  const common = {
    area: 'shinjuku',
    language: 'en',
    mode: 'SCHEDULED',
    fulfillmentMode: 'HOME_VISIT',
  };
  const old = await fetch(
    `${origin}/${locale}/discover?${new URLSearchParams({ tab: 'shops', ...common, search: 'Nagi', shopPage: '2', duration: '120', maxTotal: '10000', hold: 'private', modeConfirmed: '1' })}`,
    { redirect: 'manual', signal: AbortSignal.timeout(20000) },
  );
  check([307, 308].includes(old.status), `${locale}: legacy shop route redirects before rendering`);
  const target = new URL(old.headers.get('location'), origin);
  check(
    target.pathname === `/${locale}/shops`,
    `${locale}: redirect uses the standalone shop list`,
  );
  for (const [key, value] of Object.entries({ ...common, search: 'Nagi', shopPage: '2' }))
    check(target.searchParams.get(key) === value, `${locale}: redirect preserves ${key}`);
  for (const key of ['tab', 'duration', 'maxTotal', 'hold', 'modeConfirmed'])
    check(!target.searchParams.has(key), `${locale}: shop redirect omits ${key}`);
  for (const kind of ['services', 'therapists', 'shops']) {
    const response = await fetch(
      `${origin}/${locale}/${kind}?${new URLSearchParams({ ...common, search: 'Nagi', duration: '90', sort: 'price' })}`,
      { signal: AbortSignal.timeout(20000) },
    );
    check(response.ok, `${locale}/${kind}: renders`);
    const html = await response.text();
    check(html.includes('booking-browse-header'), `${locale}/${kind}: shared booking header`);
    const navigation = html.match(
      /<nav\b[^>]*class="booking-browse-tabs"[^>]*>([\s\S]*?)<\/nav>/,
    )?.[1];
    check(!!navigation, `${locale}/${kind}: shared dimensions navigation`);
    const destinations = links(navigation);
    check(destinations.length === 3, `${locale}/${kind}: all three dimensions available`);
    for (const other of ['services', 'therapists', 'shops'].filter((x) => x !== kind)) {
      const link = destinations.find((url) => url.pathname === `/${locale}/${other}`);
      check(!!link, `${locale}/${kind}: switch to ${other}`);
      for (const [key, value] of Object.entries(common))
        check(link.searchParams.get(key) === value, `${locale}/${kind}: switch preserves ${key}`);
      for (const key of [
        'search',
        'duration',
        'sort',
        'maxTotal',
        'start',
        'offering',
        'modeConfirmed',
      ])
        check(!link.searchParams.has(key), `${locale}/${kind}: switch drops ${key}`);
    }
    if (kind === 'shops') {
      check(html.includes(`/${locale}/shops`), `${locale}: shop canonical and navigation`);
      check(
        !/<(?:input|select)\b[^>]*name="(?:duration|maxTotal)"/.test(html),
        `${locale}: unsupported shop filters are not rendered`,
      );
    }
  }
  const advanced = await fetch(
    `${origin}/${locale}/therapists?filters=advanced&area=shinjuku&mode=SCHEDULED`,
    { signal: AbortSignal.timeout(20000) },
  );
  check(advanced.ok, `${locale}: advanced therapist results render`);
  const advancedHtml = await advanced.text();
  const actions = [...advancedHtml.matchAll(/<a\b[^>]*class="card-cta"[^>]*href="([^"]+)"/g)].map(
    (match) => new URL(decode(match[1]), origin),
  );
  check(actions.length > 0, `${locale}: advanced results contain real therapists`);
  check(
    actions.every(
      (url) =>
        url.pathname.startsWith(`/${locale}/therapists/`) &&
        url.hash === '#reserve' &&
        url.searchParams.get('from') === 'therapists',
    ),
    `${locale}: advanced actions visit profiles before booking`,
  );
}
console.log(
  `Booking directories SSR and legacy links: ${checks} checks passed. Read-only local preview checks.`,
);
