import test from 'node:test';
import assert from 'node:assert/strict';
import type { Actor, CommunityQueueItem, Store } from '@hogulink/contracts';
import { fixture, customer, shop, staff, admin, complete } from './helpers/experience-fixture.js';
import { communityAlias, communityCheck, seedDemoCommunity } from '../src/community.js';

type E = Parameters<Parameters<typeof fixture>[0]>[0];
const day = 86_400_000;
const others = [2, 3, 4].map((n): Actor => ({
  id: `community-customer-${n}`,
  role: 'CUSTOMER',
  verificationLevel: 1,
}));
const question = {
  title: 'Can I book a visit to my hotel?',
  body: 'I am staying in Shinjuku next week. What should I prepare in the room?',
  language: 'en' as const,
  topic: 'HOTEL' as const,
  area: 'shinjuku' as const,
};
const reply = (body: string) => ({ body, language: 'en' as const });
async function queued(e: E, id: string) {
  const item = (await e.community.queue(admin)).find((x) => x.id === id);
  assert(item, `${id} should be in the review queue`);
  return item;
}
async function approve(e: E, id: string) {
  const item = await queued(e, id);
  return e.community.review(admin, item.kind, id, { version: item.version, decision: 'APPROVE' });
}
async function staffPosting(e: E, on = true) {
  await e.community.setStaffPosting(shop, { staffPosting: on });
}

test('questions wait for review, then appear under a pseudonym with their answers', () =>
  fixture(async (e) => {
    const asked = await e.community.ask(customer, question);
    assert.equal(asked.status, 'PENDING');
    assert(!(await e.discovery.feed({ tab: 'questions' })).items.some((p) => p.id === asked.id));
    await assert.rejects(e.discovery.detail(asked.id), { code: 'NOT_FOUND' });
    await approve(e, asked.id);

    const feed = await e.discovery.feed({ tab: 'questions' });
    const card = feed.items.find((p) => p.id === asked.id)!;
    assert.equal(card.kind, 'question');
    assert.equal(card.author.kind, 'customer');
    assert.deepEqual(card.author.name, communityAlias(customer.id));
    assert.equal(card.community?.answers, 0);
    assert((await e.discovery.feed()).items.some((p) => p.id === asked.id));
    // The public never sees the account behind a question.
    assert(!JSON.stringify(await e.discovery.detail(asked.id)).includes(customer.id));

    const answer = await e.community.reply(
      shop,
      asked.id,
      reply('Yes. Choose “hotel” and add the room number.'),
    );
    assert.equal(answer.status, 'PENDING');
    await approve(e, answer.id);
    const detail = await e.discovery.detail(asked.id);
    assert.equal(detail.community?.replies.length, 1);
    assert.equal(detail.community?.replies[0].author.kind, 'shop');
    assert.equal((await e.discovery.feed({ tab: 'questions' })).items[0].community?.answers, 1);
  }));

test('contact details and sexual wording are refused; medical and appearance words are flagged', () =>
  fixture(async (e) => {
    for (const body of [
      'Please add my LINE ID so we can talk directly.',
      'Call me on 090-1234-5678 before the visit.',
      'Details at https://example.com/menu please.',
      'Mail me at someone@example.com for times.',
    ])
      await assert.rejects(e.community.ask(customer, { ...question, body }), {
        code: 'COMMUNITY_CONTACT',
      });
    await assert.rejects(
      e.community.ask(customer, { ...question, body: 'Is a happy ending included in the price?' }),
      { code: 'COMMUNITY_PROHIBITED' },
    );
    // Prices, durations and dates are not phone numbers.
    assert.deepEqual(communityCheck('60分钟 ¥8,700，预算 10000 20000，10月30日').blocked, []);
    const flagged = await e.community.ask(customer, {
      ...question,
      body: 'Can this massage cure my back pain after surgery?',
    });
    assert.deepEqual((await queued(e, flagged.id)).flags, ['medical']);
    assert.deepEqual(communityCheck('施術者がかわいいと聞きました').flags, ['appearance']);
  }));

test('only verified customers ask; businesses answer within their own rules', () =>
  fixture(async (e) => {
    await assert.rejects(e.community.ask({ ...customer, verificationLevel: 0 }, question), {
      code: 'FORBIDDEN',
    });
    for (const actor of [shop, staff, admin])
      await assert.rejects(e.community.ask(actor, question), { code: 'FORBIDDEN' });
    const asked = await e.community.ask(customer, question);
    await approve(e, asked.id);

    assert.equal((await e.community.viewer(staff, asked.id)).block, 'POSTING_OFF');
    await assert.rejects(e.community.reply(staff, asked.id, reply('I can help with that.')), {
      code: 'COMMUNITY_POSTING_OFF',
    });
    await staffPosting(e);
    const fromStaff = await e.community.reply(staff, asked.id, reply('Towels are brought along.'));
    const fromEditor = await e.community.reply(admin, asked.id, reply('See our hotel guide.'));
    assert.equal(fromEditor.status, 'PUBLISHED');
    await approve(e, fromStaff.id);
    const ws = await e.community.shopWorkspace(shop);
    assert(ws.questions.find((q) => q.id === asked.id)?.answeredByBusiness);
  }));

test('the asker chooses one answer and customers mark answers helpful, never their own', () =>
  fixture(async (e) => {
    const asked = await e.community.ask(customer, question);
    await approve(e, asked.id);
    const a = await e.community.reply(others[0], asked.id, reply('I asked the front desk first.'));
    const b = await e.community.reply(shop, asked.id, reply('Add the hotel name and room number.'));
    await approve(e, a.id);
    await approve(e, b.id);

    await assert.rejects(e.community.accept(others[0], asked.id, { replyId: b.id }), {
      code: 'FORBIDDEN',
    });
    await e.community.accept(customer, asked.id, { replyId: b.id });
    await assert.rejects(e.community.helpful(others[0], a.id, { helpful: true }), {
      code: 'FORBIDDEN',
    });
    assert.equal((await e.community.helpful(others[1], a.id, { helpful: true })).count, 1);
    assert.equal((await e.community.helpful(others[2], a.id, { helpful: true })).count, 2);
    assert.equal((await e.community.helpful(others[2], a.id, { helpful: false })).count, 1);
    assert.deepEqual((await e.community.viewer(others[1], asked.id)).helpful, [a.id]);

    const detail = await e.discovery.detail(asked.id);
    // The accepted answer leads even with fewer helpful marks.
    assert.deepEqual(
      detail.community?.replies.map((r) => [r.id, r.accepted]),
      [
        [b.id, true],
        [a.id, false],
      ],
    );
    assert.equal(detail.community?.replies[1].author.asker, undefined);
    assert(detail.post.community?.accepted);
  }));

test('therapist notes need the shop switch, approved own photos and stay within the weekly limit', () =>
  fixture(async (e) => {
    const note = {
      title: 'After a long day at a desk',
      body: 'Tell me where it feels heavy first.',
      language: 'ja' as const,
    };
    await assert.rejects(e.community.note(staff, note), { code: 'COMMUNITY_POSTING_OFF' });
    await staffPosting(e);
    await e.repo.transaction(async (tx) => {
      await tx.put('listingMedia', {
        id: 'media_own',
        listingId: 'listing-aoi',
        status: 'APPROVED',
        kind: 'PHOTO',
      });
      await tx.put('listingMedia', {
        id: 'media_other',
        listingId: 'listing-ren',
        status: 'APPROVED',
        kind: 'PHOTO',
      });
    });
    await assert.rejects(e.community.note(staff, { ...note, mediaIds: ['media_other'] }), {
      code: 'INVALID_MEDIA',
    });
    const first = await e.community.note(staff, { ...note, mediaIds: ['media_own'] });
    assert.equal((await e.community.staffWorkspace(staff)).weeklyRemaining, 2);
    await e.community.note(staff, note);
    await e.community.note(staff, note);
    await assert.rejects(e.community.note(staff, note), { code: 'COMMUNITY_WEEKLY_LIMIT' });
    await approve(e, first.id);
    const card = (await e.discovery.feed({ tab: 'notes' })).items[0];
    assert.equal(card.id, first.id);
    assert.equal(card.author.kind, 'therapist');
    assert.deepEqual(card.images, ['/v1/public/listing-media/media_own']);
    // The old therapist tab link opens notes, followed by profile cards.
    assert.equal((await e.discovery.feed({ tab: 'therapists' })).items[0].id, first.id);
  }));

test('therapists decide who may reply to their notes', () =>
  fixture(async (e, clock) => {
    await staffPosting(e);
    const note = await e.community.note(staff, {
      title: 'Stretch before bed',
      body: 'A slow neck stretch before bed helps you relax.',
      language: 'en',
    });
    await approve(e, note.id);
    assert.equal((await e.community.viewer(customer, note.id)).canReply, true);
    assert.equal((await e.community.viewer(shop, note.id)).canReply, true);

    await e.community.setReplyPolicy(staff, { replyPolicy: 'SERVED' });
    assert.equal((await e.community.viewer(customer, note.id)).block, 'NOT_SERVED');
    await complete(e, clock);
    assert.equal((await e.community.viewer(customer, note.id)).canReply, true);
    assert.equal((await e.community.viewer(others[0], note.id)).block, 'NOT_SERVED');

    await e.community.setReplyPolicy(staff, { replyPolicy: 'NONE' });
    assert.equal((await e.community.viewer(customer, note.id)).block, 'CLOSED');
    assert.equal((await e.discovery.detail(note.id)).community?.closed, true);
  }));

test('shop updates link real menus, need end dates for offers and disappear when they end', () =>
  fixture(async (e, clock) => {
    const update = {
      title: 'Weekday evening offer',
      body: 'More evening times this week for the 60-minute session.',
      language: 'en' as const,
      template: 'OFFER' as const,
    };
    await assert.rejects(e.community.update(shop, { ...update, offeringId: 'store-nagi-60' }), {
      code: 'EXPIRY_REQUIRED',
    });
    await assert.rejects(
      e.community.update(shop, {
        ...update,
        offeringId: 'store-sora-60',
        expiresAt: clock.now + day,
      }),
      { code: 'INVALID_OFFERING' },
    );
    await assert.rejects(
      e.community.update(shop, {
        ...update,
        offeringId: 'store-nagi-60',
        expiresAt: clock.now + 40 * day,
      }),
      { code: 'INVALID_EXPIRY' },
    );
    await assert.rejects(
      e.community.update(shop, {
        ...update,
        offeringId: 'store-nagi-60',
        expiresAt: clock.now + day,
        imageIds: ['brand_unpublished'],
      }),
      { code: 'INVALID_MEDIA' },
    );
    const posted = await e.community.update(shop, {
      ...update,
      offeringId: 'store-nagi-60',
      expiresAt: clock.now + day,
    });
    await approve(e, posted.id);
    const card = (await e.discovery.feed({ tab: 'updates' })).items[0];
    assert.equal(card.id, posted.id);
    assert.equal(card.community?.offering?.id, 'store-nagi-60');
    assert.equal(card.community?.offering?.storeSlug, 'nagi-tokyo');
    clock.now += day + 1;
    assert(!(await e.discovery.feed({ tab: 'updates' })).items.some((p) => p.id === posted.id));
    await assert.rejects(e.discovery.detail(posted.id), { code: 'NOT_FOUND' });
  }));

test('three reports hide content until a reviewer restores it', () =>
  fixture(async (e) => {
    const asked = await e.community.ask(customer, question);
    await approve(e, asked.id);
    await assert.rejects(e.community.report(customer, 'POST', asked.id, { reason: 'SPAM' }), {
      code: 'FORBIDDEN',
    });
    assert.equal(
      (await e.community.report(others[0], 'POST', asked.id, { reason: 'SPAM' })).hidden,
      false,
    );
    // Repeating a report does not count twice.
    await e.community.report(others[0], 'POST', asked.id, { reason: 'SPAM' });
    await e.community.report(shop, 'POST', asked.id, { reason: 'CONTACT' });
    assert.equal(
      (await e.community.report(others[1], 'POST', asked.id, { reason: 'SPAM' })).hidden,
      true,
    );
    assert(!(await e.discovery.feed({ tab: 'questions' })).items.some((p) => p.id === asked.id));

    const item: CommunityQueueItem = await queued(e, asked.id);
    assert.equal(item.status, 'HIDDEN');
    assert.deepEqual(
      item.reports.sort((a, b) => a.reason.localeCompare(b.reason)),
      [
        { reason: 'CONTACT', count: 1 },
        { reason: 'SPAM', count: 2 },
      ],
    );
    assert.equal(await e.repo.read((tx) => e.community.pendingCount(tx)), 1);
    await e.community.review(admin, 'POST', asked.id, {
      version: item.version,
      decision: 'RESTORE',
      note: 'Ordinary question.',
    });
    assert((await e.discovery.feed({ tab: 'questions' })).items.some((p) => p.id === asked.id));
    assert.equal(await e.repo.read((tx) => e.community.pendingCount(tx)), 0);
  }));

test('reviewers return content with a reason, mute authors and see version conflicts', () =>
  fixture(async (e) => {
    const asked = await e.community.ask(customer, question);
    const item = await queued(e, asked.id);
    await assert.rejects(
      e.community.review(admin, 'POST', asked.id, { version: item.version, decision: 'REJECT' }),
    );
    await e.community.review(admin, 'POST', asked.id, {
      version: item.version,
      decision: 'REJECT',
      reason: 'Please remove the hotel room number.',
    });
    await assert.rejects(
      e.community.review(admin, 'POST', asked.id, { version: item.version, decision: 'APPROVE' }),
      { code: 'VERSION_CONFLICT' },
    );
    const mine = await e.community.mine(customer);
    assert.equal(mine[0].status, 'REJECTED');
    assert.equal(mine[0].reason, 'Please remove the hotel room number.');

    await assert.rejects(e.community.queue(customer));
    await e.community.mute(admin, {
      ownerId: customer.id,
      days: 7,
      reason: 'Repeated contact details.',
    });
    await assert.rejects(e.community.ask(customer, question), { code: 'COMMUNITY_MUTED' });
    await e.community.mute(admin, { ownerId: customer.id, days: 0, reason: 'Mute ended early.' });
    assert.equal((await e.community.ask(customer, question)).status, 'PENDING');
  }));

test('authors withdraw their own posts and shops can take down their therapists’ notes', () =>
  fixture(async (e) => {
    const asked = await e.community.ask(customer, question);
    await assert.rejects(e.community.withdraw(others[0], 'POST', asked.id), { code: 'FORBIDDEN' });
    await e.community.withdraw(customer, 'POST', asked.id);
    await assert.rejects(e.community.withdraw(customer, 'POST', asked.id), {
      code: 'COMMUNITY_STATE',
    });
    await staffPosting(e);
    const note = await e.community.note(staff, {
      title: 'A quiet evening routine',
      body: 'Warm water and a slow stretch before bed.',
      language: 'en',
    });
    await approve(e, note.id);
    await e.community.withdraw(shop, 'POST', note.id);
    assert(!(await e.discovery.feed({ tab: 'notes' })).items.some((p) => p.id === note.id));
    assert.equal((await e.community.shopWorkspace(shop)).staffPosts?.[0].status, 'WITHDRAWN');
  }));

test('a paused shop’s posts leave the public feed with it', () =>
  fixture(async (e, clock) => {
    const posted = await e.community.update(shop, {
      title: 'Holiday hours this week',
      body: 'We open one hour later on the national holiday.',
      language: 'en',
      template: 'NOTICE',
      expiresAt: clock.now + 3 * day,
    });
    await approve(e, posted.id);
    assert((await e.discovery.feed()).items.some((p) => p.id === posted.id));
    await e.repo.transaction(async (tx) => {
      const s = (await tx.get<Store>('stores', 'store-nagi'))!;
      await tx.put('stores', { ...s, active: false });
    });
    assert(!(await e.discovery.feed()).items.some((p) => p.id === posted.id));
    await assert.rejects(e.discovery.detail(posted.id), { code: 'NOT_FOUND' });
  }));

test('pinned editorials lead the feed in three languages; only the platform writes them', () =>
  fixture(async (e) => {
    const text = (ja: string, en: string, zh: string) => ({ ja, en, 'zh-cn': zh });
    const editorial = {
      title: text('はじめての予約ガイド', 'Your first booking guide', '第一次预约指南'),
      body: text(
        '予約前に合計金額と取消規定を確認してください。',
        'Check the total and the cancellation policy before booking.',
        '预约前请确认合计金额和取消规则。',
      ),
      topic: 'FIRST_TIME' as const,
      pinned: true,
    };
    await assert.rejects(e.community.editorial(shop, editorial));
    const { id } = await e.community.editorial(admin, editorial);
    const top = (await e.discovery.feed()).items[0];
    assert.equal(top.id, id);
    assert.equal(top.title['zh-cn'], '第一次预约指南');
    assert(
      (await e.discovery.feed({ tab: 'guides', language: 'zh' })).items.some((p) => p.id === id),
    );
    await e.community.pin(admin, id, { pinned: false });
    assert.equal((await e.community.editorials(admin))[0].pinned, false);
  }));

test('demo starting content is labelled, seeded once and opens with its answer', () =>
  fixture(async (e) => {
    await seedDemoCommunity(e);
    await seedDemoCommunity(e);
    const feed = await e.discovery.feed();
    const community = feed.items.filter((p) => p.community);
    assert.equal(community.length, 4);
    assert(community.every((p) => p.sample));
    assert.equal(community[0].kind, 'editorial');
    const detail = await e.discovery.detail('post-demo-question-hotel');
    assert.equal(detail.community?.replies[0].accepted, true);
  }));

test('older published posts and pins survive 500 newer posts in search, details and saves', () =>
  fixture(async (e, clock) => {
    const asked = await e.community.ask(customer, {
      ...question,
      title: 'Unique archival hotel question',
    });
    await approve(e, asked.id);
    await e.discovery.react(customer, asked.id, { version: 0, liked: false, saved: true });
    const text = { ja: '古い予約ガイドです', en: 'Older booking guide', 'zh-cn': '旧版预约指南' };
    const pin = await e.community.editorial(admin, {
      title: text,
      body: {
        ja: '予約前に料金をご確認ください。',
        en: 'Please check prices before you book.',
        'zh-cn': '请在预约之前核对项目与完整的价格。',
      },
      topic: 'FIRST_TIME',
      pinned: true,
    });
    await e.repo.transaction(async (tx) => {
      const original = (await tx.get<Record<string, unknown> & { id: string }>(
        'communityPosts',
        asked.id,
      ))!;
      await tx.put('communityPosts', {
        ...original,
        createdAt: clock.now - 1000,
        publishedAt: clock.now - 1000,
      });
      const editorial = (await tx.get<Record<string, unknown> & { id: string }>(
        'communityPosts',
        pin.id,
      ))!;
      await tx.put('communityPosts', {
        ...editorial,
        createdAt: clock.now - 1000,
        publishedAt: clock.now - 1000,
      });
      for (let i = 0; i < 505; i++)
        await tx.put('communityPosts', {
          ...original,
          id: `post-archive-newer-${i}`,
          title: { ja: '新しい質問です', en: 'Newer question', 'zh-cn': '新的预约问题' },
        });
    });
    const results = await e.discovery.feed({ tab: 'questions', search: 'Unique archival' });
    assert.equal(results.total, 1);
    assert.equal(results.items[0].id, asked.id);
    const all = await e.discovery.feed({ tab: 'questions', limit: 20 });
    assert.equal(all.total, 506);
    assert.equal(
      (await e.discovery.feed({ tab: 'questions', limit: 20, cursor: all.nextCursor! })).total,
      506,
    );
    assert.equal((await e.discovery.detail(asked.id)).post.id, asked.id);
    assert.equal((await e.discovery.saved(customer))[0].post?.id, asked.id);
    assert.equal(
      (await e.discovery.feed({ language: 'zh', area: 'shinjuku' })).items[0].id,
      pin.id,
    );
    await e.community.withdraw(customer, 'POST', asked.id);
    await assert.rejects(e.discovery.detail(asked.id), { code: 'NOT_FOUND' });
    assert.equal((await e.discovery.saved(customer))[0].post, null);
  }));

test('reply counts, acceptance and interactions follow the same public author rules', () =>
  fixture(async (e) => {
    const asked = await e.community.ask(customer, question);
    await approve(e, asked.id);
    await staffPosting(e);
    const answer = await e.community.reply(
      staff,
      asked.id,
      reply('We bring clean towels for the visit.'),
    );
    await approve(e, answer.id);
    await e.community.accept(customer, asked.id, { replyId: answer.id });
    await e.community.helpful(others[0], answer.id, { helpful: true });
    async function check(visible: boolean) {
      const detail = await e.discovery.detail(asked.id);
      const card = (await e.discovery.feed({ tab: 'questions' })).items[0];
      assert.equal(detail.community?.replies.length, visible ? 1 : 0);
      assert.equal(detail.post.community?.answers, visible ? 1 : 0);
      assert.equal(card.community?.answers, visible ? 1 : 0);
      assert.equal(card.community?.accepted, visible);
      assert.deepEqual(
        (await e.community.viewer(others[0], asked.id)).helpful,
        visible ? [answer.id] : [],
      );
      const work = (await e.community.shopWorkspace(shop)).questions.find(
        (p) => p.id === asked.id,
      )!;
      assert.equal(work.answers, visible ? 1 : 0);
      assert.equal(work.answeredByBusiness, visible);
    }
    await check(true);
    await e.repo.transaction(async (tx) => {
      const store = (await tx.get<Store>('stores', 'store-nagi'))!;
      await tx.put('stores', { ...store, active: false });
    });
    await check(false);
    await assert.rejects(e.community.accept(customer, asked.id, { replyId: answer.id }), {
      code: 'NOT_FOUND',
    });
    await assert.rejects(e.community.helpful(others[1], answer.id, { helpful: true }), {
      code: 'NOT_FOUND',
    });
    await e.repo.transaction(async (tx) => {
      const store = (await tx.get<Store>('stores', 'store-nagi'))!;
      await tx.put('stores', { ...store, active: true });
    });
    await check(true);
    await e.repo.transaction(async (tx) => {
      const listing = (await tx.get<import('@hogulink/contracts').Listing>(
        'listings',
        'listing-aoi',
      ))!;
      await tx.put('listings', { ...listing, membershipActive: false });
    });
    await check(false);
  }));

test('mutes can be found and lifted after review; stale restrictions cannot be cleared', () =>
  fixture(async (e, clock) => {
    const asked = await e.community.ask(customer, question);
    await e.community.mute(admin, {
      ownerId: customer.id,
      days: 7,
      reason: 'Repeated contact details.',
    });
    const item = await queued(e, asked.id);
    await e.community.review(admin, 'POST', asked.id, {
      version: item.version,
      decision: 'REJECT',
      reason: 'Please remove contact details.',
    });
    assert.equal((await e.community.queue(admin)).length, 0);
    const [mute] = await e.community.listMutes(admin);
    assert.equal(mute.ownerId, customer.id);
    assert.deepEqual(mute.author.label, communityAlias(customer.id));
    for (const actor of [customer, shop, staff]) await assert.rejects(e.community.listMutes(actor));
    await assert.rejects(
      e.community.mute(shop, { ownerId: customer.id, days: 0, reason: 'Not permitted.' }),
    );
    await e.community.mute(admin, {
      ownerId: customer.id,
      days: 14,
      reason: 'Restriction extended.',
    });
    await assert.rejects(
      e.community.mute(admin, {
        ownerId: customer.id,
        days: 0,
        reason: 'Release from old list.',
        expectedUntil: mute.until,
      }),
      { code: 'VERSION_CONFLICT' },
    );
    await assert.rejects(e.community.ask(customer, question), { code: 'COMMUNITY_MUTED' });
    const [renewed] = await e.community.listMutes(admin);
    await e.community.mute(admin, {
      ownerId: customer.id,
      days: 0,
      reason: 'Reviewed and released.',
      expectedUntil: renewed.until,
    });
    assert.equal((await e.community.listMutes(admin)).length, 0);
    assert.equal((await e.community.ask(customer, question)).status, 'PENDING');
    await e.community.mute(admin, {
      ownerId: 'store:store-nagi',
      days: 1,
      reason: 'Shop restriction.',
    });
    await e.community.mute(admin, {
      ownerId: 'listing:listing-aoi',
      days: 1,
      reason: 'Therapist restriction.',
    });
    const businesses = await e.community.listMutes(admin);
    assert.deepEqual(businesses.map((x) => x.author.role).sort(), ['MERCHANT', 'STAFF']);
    assert(businesses.every((x) => x.author.label.en !== '—'));
    clock.now += day;
    assert.equal((await e.community.listMutes(admin)).length, 0);
  }));

test('same-day notices and offers are valid until their JST cutoff', () =>
  fixture(async (e, clock) => {
    clock.now = Date.parse('2026-11-02T12:00:00+09:00');
    const expiresAt = Date.parse('2026-11-02T23:59:00+09:00');
    for (const template of ['NOTICE', 'OFFER'] as const) {
      const post = await e.community.update(shop, {
        title: 'Available until tonight',
        body: 'Please check the available times for today.',
        language: 'en',
        template,
        expiresAt,
        ...(template === 'OFFER' ? { offeringId: 'store-nagi-60' } : {}),
      });
      await approve(e, post.id);
      assert.equal((await e.discovery.detail(post.id)).post.community?.expiresAt, expiresAt);
    }
    clock.now = expiresAt;
    assert.equal(
      (await e.discovery.feed({ tab: 'updates' })).items.filter((p) => p.community).length,
      0,
    );
    await assert.rejects(
      e.community.update(shop, {
        title: 'This offer already ended',
        body: 'The old cutoff must be refused by the server.',
        language: 'en',
        template: 'NOTICE',
        expiresAt,
      }),
      { code: 'INVALID_EXPIRY' },
    );
  }));
