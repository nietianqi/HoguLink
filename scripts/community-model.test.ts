import test from 'node:test';
import assert from 'node:assert/strict';
import { asDiscoveryTab, communityContactRules } from '@hogulink/contracts/discovery';
import type { DiscoveryPost } from '@hogulink/contracts';
import {
  badgeText,
  blockText,
  communityHref,
  communityLanguage,
  draftProblems,
  errorText,
  expiryAt,
  expiryBounds,
  templateNeeds,
} from '../hogulink-web/src/lib/community-model.ts';
import {
  authorHref,
  discoveryQuery,
  postBookingHref,
} from '../hogulink-web/src/lib/discovery-feed-model.ts';
import { cm } from '../hogulink-web/src/lib/community-i18n.ts';

const post = (extra: Partial<DiscoveryPost>): DiscoveryPost => ({
  id: 'post-1',
  kind: 'question',
  title: { ja: 't', en: 't', 'zh-cn': 't' },
  summary: { ja: 's', en: 's', 'zh-cn': 's' },
  images: [],
  portrait: false,
  sample: false,
  illustration: false,
  author: { id: 'customer-ABCD', name: { ja: 'a', en: 'a', 'zh-cn': 'a' }, kind: 'customer' },
  stats: { views: 0, likes: 0, saves: 0 },
  community: {
    type: 'QUESTION',
    language: 'ja',
    topic: 'HOTEL',
    answers: 0,
    accepted: false,
    publishedAt: 0,
  },
  ...extra,
});

test('old discovery links open the matching community tab', () => {
  assert.equal(asDiscoveryTab('therapists'), 'notes');
  assert.equal(asDiscoveryTab('safety'), 'guides');
  assert.equal(asDiscoveryTab('questions'), 'questions');
  assert.equal(asDiscoveryTab('constructor'), 'recommended');
  assert.equal(discoveryQuery({ tab: 'safety' }).tab, 'guides');
});

test('drafts are checked like the server: length and contact details', () => {
  assert.deepEqual(
    draftProblems({ title: 'Hotel visits?', body: 'Can a therapist come to my hotel room?' }),
    [],
  );
  assert.deepEqual(draftProblems({ title: 'Hi', body: 'short' }), ['title', 'body']);
  assert.deepEqual(draftProblems({ body: 'Thanks!' }, 'reply'), []);
  assert(
    draftProblems({ title: 'Contact me', body: 'My LINE ID is abc, message me.' }).includes(
      'contact',
    ),
  );
  assert.deepEqual(communityContactRules('电话 080 1234 5678'), ['contact-phone']);
  // Budgets, prices and dates stay allowed.
  assert.deepEqual(communityContactRules('预算 10000 20000，¥8,700，10月30日 19:00'), []);
});

test('shop update templates say what they need, with end dates in Japan time', () => {
  assert.deepEqual(templateNeeds('OFFER'), { offering: true, expiry: true });
  assert.deepEqual(templateNeeds('NOTICE'), { offering: false, expiry: true });
  assert.deepEqual(templateNeeds('VENUE'), { offering: false, expiry: false });
  // At 23:30 JST on 30 October the last day still ends inside the 30-day limit.
  const now = Date.parse('2026-10-30T14:30:00Z');
  const bounds = expiryBounds(now);
  assert.deepEqual(bounds, { min: '2026-10-30', max: '2026-11-28' });
  assert(expiryAt(bounds.max) <= now + 30 * 86_400_000);
  assert(expiryAt(bounds.min) > now);
  assert.equal(new Date(expiryAt('2026-11-01')).toISOString(), '2026-11-01T14:59:00.000Z');
});

test('end dates allow today until its cutoff and roll over on the Japan day', () => {
  for (const [instant, minimum] of [
    ['2026-11-02T03:00:00Z', '2026-11-02'],
    ['2026-11-01T15:00:00Z', '2026-11-02'],
    ['2026-11-02T14:58:59Z', '2026-11-02'],
    ['2026-11-02T14:59:00Z', '2026-11-03'],
    ['2026-11-02T15:00:00Z', '2026-11-03'],
  ]) {
    const now = Date.parse(instant);
    const bounds = expiryBounds(now);
    assert.equal(bounds.min, minimum);
    assert(expiryAt(bounds.min) > now);
    assert(expiryAt(bounds.max) <= now + 30 * 86_400_000);
    assert(expiryAt(bounds.max) + 86_400_000 > now + 30 * 86_400_000);
  }
});

test('business posts are labelled as the business’s own words', () => {
  assert.equal(
    badgeText(post({ kind: 'update', author: { ...post({}).author, kind: 'shop' } })),
    'shopPost',
  );
  assert.equal(
    badgeText(post({ kind: 'note', author: { ...post({}).author, kind: 'therapist' } })),
    'staffPost',
  );
  assert.equal(badgeText(post({})), 'customer');
  assert.equal(cm('zh-cn', 'shopPost'), '店铺发布');
});

test('community posts lead to the real menu, shop or therapist, never a customer profile', () => {
  const carry = new URLSearchParams({ area: 'shinjuku' });
  const update = post({
    kind: 'update',
    author: { id: 'store-nagi', name: post({}).author.name, kind: 'shop', slug: 'nagi-tokyo' },
    community: {
      ...post({}).community!,
      type: 'UPDATE',
      offering: {
        id: 'store-nagi-60',
        name: post({}).title,
        durationMinutes: 60,
        storeSlug: 'nagi-tokyo',
      },
    },
  });
  assert.deepEqual(communityHref('ja', update, carry), {
    href: '/ja/shops/nagi-tokyo?area=shinjuku&offering=store-nagi-60',
    label: 'viewOffering',
  });
  assert.equal(postBookingHref('en', post({}), { tab: 'questions' }), '/en/therapists?');
  assert.equal(authorHref('en', post({}), { tab: 'questions' }), '#replies');
});

test('locale, reply blocks and server errors map to copy', () => {
  assert.equal(communityLanguage('zh-cn'), 'zh');
  assert.equal(communityLanguage('ja'), 'ja');
  assert.equal(blockText('NOT_SERVED'), 'block_NOT_SERVED');
  assert.equal(blockText(undefined), 'closed');
  assert.equal(errorText('COMMUNITY_CONTACT'), 'COMMUNITY_CONTACT');
  assert.equal(errorText('SOMETHING_NEW'), 'failed');
});
