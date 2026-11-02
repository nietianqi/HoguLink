import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  canAdmin,
  listingMediaUrl,
  storefrontAssetUrl,
  type Actor,
  type Booking,
  type CommunityEditorial,
  type CommunityLanguage,
  type CommunityMute,
  type CommunityOwnItem,
  type CommunityPostType,
  type CommunityQueueItem,
  type CommunityQuestionSummary,
  type CommunityReply,
  type CommunityReplyBlock,
  type CommunityReplyPolicy,
  type CommunityReportReason,
  type CommunityStatus,
  type CommunityThread,
  type CommunityTopic,
  type CommunityViewer,
  type CommunityWorkspace,
  type DiscoveryPost,
  type Listing,
  type Localized,
  type Offering,
  type ShopUpdateTemplate,
  type Store,
} from '@hogulink/contracts';
import {
  communityContactRules,
  communityLimits as limits,
  communityReplyPolicies,
  communityReportReasons,
  communityTopics,
  shopUpdateTemplates,
} from '@hogulink/contracts/discovery';
import type { Engine } from './engine.js';
import type { Records } from './repository.js';
import { ensure } from './errors.js';
import { contentRuleIds } from './content-review.js';
import { currentAdmin, requireAdmin } from './admin-access.js';

const day = 86_400_000;
const areas = ['shinjuku', 'shibuya', 'minato', 'chuo', 'taito'] as const;
const same = (value: string): Localized => ({ ja: value, en: value, 'zh-cn': value });
const signature = (...parts: string[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const editor: Localized = {
  'zh-cn': 'HoguLink 编辑部',
  ja: 'HoguLink 編集部',
  en: 'HoguLink editors',
};
/** A stable pseudonym; the public never sees a customer's account, name or email. */
export function communityAlias(ownerId: string): Localized {
  const tag = createHash('sha256').update(`community:${ownerId}`).digest('hex').slice(0, 4);
  const code = tag.toUpperCase();
  return { 'zh-cn': `顾客 ${code}`, ja: `お客様 ${code}`, en: `Guest ${code}` };
}

const clean = (text: string) => text.normalize('NFKC').replace(/[​-‍﻿]/g, '');
/** Allowed into review, marked for the reviewer: a question about pain is not a claim. */
const flagRules = [
  {
    id: 'medical',
    pattern:
      /治疗|治療|治る|治った|治好|治愈|疗效|療効|効能|改善症状|症状改善|\bcure|\bheal(s|ed|ing)?\b|diagnos/i,
  },
  {
    id: 'appearance',
    pattern:
      /颜值|顔面|美女|美人|イケメン|可愛い|かわいい|可爱|身材|スタイル抜群|性感|セクシー|sexy|\bhot\b|\bcute\b|胸|おっぱい/i,
  },
  {
    id: 'whereabouts',
    pattern: /住在|自宅は|最寄り駅|今天在.{0,12}(酒店|车站|附近)|今日は.{0,12}(ホテル|駅)/,
  },
];
/** Contact details and sexual-service wording are refused before review. */
export function communityCheck(...texts: string[]) {
  const text = clean(texts.join('\n'));
  const blocked = [...contentRuleIds(text), ...communityContactRules(text)];
  return { blocked, flags: flagRules.filter((r) => r.pattern.test(text)).map((r) => r.id) };
}

type Role = Actor['role'];
type PostRecord = {
  id: string;
  type: CommunityPostType;
  status: CommunityStatus;
  role: Role;
  /** `store:` / `listing:` keys for business authors, the account id for customers. */
  ownerId: string;
  storeId?: string;
  listingId?: string;
  title: Localized;
  body: Localized;
  language: CommunityLanguage;
  topic: CommunityTopic;
  area?: string;
  template?: ShopUpdateTemplate;
  offeringId?: string;
  /** Approved listing photos for notes, published storefront photos for updates. */
  images: string[];
  expiresAt?: number;
  pinned?: boolean;
  flags: string[];
  version: number;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
  acceptedReplyId?: string;
  reason?: string;
  note?: string;
  reviewedBy?: string;
  reviewedAt?: number;
  sample?: boolean;
};
type ReplyRecord = {
  id: string;
  postId: string;
  status: CommunityStatus;
  role: Role;
  ownerId: string;
  storeId?: string;
  listingId?: string;
  body: string;
  language: CommunityLanguage;
  flags: string[];
  version: number;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
  reason?: string;
  note?: string;
  reviewedBy?: string;
  reviewedAt?: number;
  sample?: boolean;
};
/** `postId` holds the voted reply so the shared index serves both lookups. */
type VoteRecord = { id: string; customerId: string; postId: string; createdAt: number };
type ReportRecord = {
  id: string;
  reporterId: string;
  postId: string;
  kind: 'POST' | 'REPLY';
  reason: CommunityReportReason;
  detail?: string;
  status: 'OPEN' | 'ACTIONED' | 'DISMISSED';
  createdAt: number;
  closedAt?: number;
};
type SettingsRecord = {
  id: string;
  staffPosting?: boolean;
  replyPolicy?: CommunityReplyPolicy;
  updatedAt: number;
};
type MuteRecord = { id: string; until: number; reason: string; by: string; at: number };

const language = z.enum(['ja', 'en', 'zh']);
const title = z.string().trim().min(limits.titleMin).max(limits.titleMax);
const body = z.string().trim().min(limits.bodyMin).max(limits.bodyMax);
const questionInput = z
  .object({ title, body, language, topic: z.enum(communityTopics), area: z.enum(areas).optional() })
  .strict();
const noteInput = z
  .object({
    title,
    body,
    language,
    topic: z.enum(communityTopics).default('OTHER'),
    mediaIds: z.array(z.string().max(80)).max(limits.images).default([]),
  })
  .strict();
const updateInput = z
  .object({
    title,
    body,
    language,
    template: z.enum(shopUpdateTemplates),
    offeringId: z.string().max(120).optional(),
    expiresAt: z.number().int().positive().optional(),
    imageIds: z.array(z.string().max(80)).max(limits.images).default([]),
  })
  .strict();
const replyInput = z
  .object({ body: z.string().trim().min(limits.replyMin).max(limits.replyMax), language })
  .strict();
const localizedText = (min: number, max: number) =>
  z
    .object({
      ja: z.string().trim().min(min).max(max),
      en: z.string().trim().min(min).max(max),
      'zh-cn': z.string().trim().min(min).max(max),
    })
    .strict();
const editorialInput = z
  .object({
    title: localizedText(limits.titleMin, limits.titleMax),
    body: localizedText(limits.bodyMin, 3000),
    topic: z.enum(communityTopics),
    pinned: z.boolean().default(false),
  })
  .strict();
const reviewInput = z
  .object({
    version: z.number().int().positive(),
    decision: z.enum(['APPROVE', 'REJECT', 'HIDE', 'RESTORE']),
    reason: z.string().trim().min(4).max(200).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((d) => !['REJECT', 'HIDE'].includes(d.decision) || !!d.reason, {
    path: ['reason'],
    message: 'Tell the author why.',
  });
const reportInput = z
  .object({
    reason: z.enum(communityReportReasons),
    detail: z.string().trim().max(500).optional(),
  })
  .strict();
const kindOf: Record<CommunityPostType, DiscoveryPost['kind']> = {
  QUESTION: 'question',
  NOTE: 'note',
  UPDATE: 'update',
  EDITORIAL: 'editorial',
};
const updateTopic: Record<ShopUpdateTemplate, CommunityTopic> = {
  NEW_MENU: 'SERVICES',
  NEW_STAFF: 'OTHER',
  OFFER: 'SERVICES',
  NOTICE: 'OTHER',
  VENUE: 'IN_STORE',
};
const excerpt = (text: Localized): Localized =>
  Object.fromEntries(
    Object.entries(text).map(([k, v]) => [k, v.length > 90 ? `${v.slice(0, 90)}…` : v]),
  ) as Localized;
const listingPublic = (l: Listing | undefined) =>
  !!l &&
  l.membershipActive &&
  l.identityVerified &&
  l.portraitConsent &&
  l.publicationStatus === 'PUBLISHED_INDEXABLE';
const storePublic = (s: Store | undefined) => !!s?.active && s.approved && !s.billingBlocked;

export class CommunityService {
  constructor(private engine: Engine) {}
  private now() {
    return this.engine.now();
  }
  private async audit(tx: Records, actor: Actor, action: string, detail: string) {
    await tx.put('audit', {
      id: `audit_${randomUUID()}`,
      actorId: actor.id,
      action,
      detail,
      at: this.now(),
    });
  }
  private async member(tx: Records, actor: Actor) {
    ensure(
      actor.role === 'STAFF' && actor.staffId && actor.storeId,
      'FORBIDDEN',
      'Staff account required.',
      403,
    );
    const listing = (await tx.find<Listing>('listings', { storeId: actor.storeId })).find(
      (x) => x.staffId === actor.staffId,
    );
    const store = await tx.get<Store>('stores', actor.storeId);
    ensure(listing && store, 'NOT_FOUND', 'Staff membership not found.', 404);
    return { listing, store };
  }
  private async shop(tx: Records, actor: Actor) {
    ensure(actor.role === 'MERCHANT' && actor.storeId, 'FORBIDDEN', 'Shop account required.', 403);
    const store = await tx.get<Store>('stores', actor.storeId);
    ensure(store?.approved, 'NOT_FOUND', 'Shop not found.', 404);
    return store;
  }
  /** One identity per author: a shop's posts belong to the shop, not to one login. */
  private async owner(tx: Records, actor: Actor) {
    if (actor.role === 'STAFF') {
      const { listing } = await this.member(tx, actor);
      return { ownerId: `listing:${listing.id}`, storeId: listing.storeId, listingId: listing.id };
    }
    if (actor.role === 'MERCHANT') {
      const store = await this.shop(tx, actor);
      return { ownerId: `store:${store.id}`, storeId: store.id };
    }
    return { ownerId: actor.id };
  }
  private async settings(tx: Records, id: string) {
    return tx.get<SettingsRecord>('communitySettings', id);
  }
  private async muted(tx: Records, ownerId: string) {
    const mute = await tx.get<MuteRecord>('communityMutes', ownerId);
    return mute && mute.until > this.now() ? mute : undefined;
  }
  private async assertCanWrite(tx: Records, ownerId: string) {
    ensure(
      !(await this.muted(tx, ownerId)),
      'COMMUNITY_MUTED',
      'Posting is paused for this account.',
      403,
    );
  }
  private check(...texts: string[]) {
    const result = communityCheck(...texts);
    ensure(
      !result.blocked.some((id) => id.startsWith('contact-')),
      'COMMUNITY_CONTACT',
      'Remove phone numbers, links and messaging IDs; contact goes through bookings.',
      422,
    );
    ensure(
      !result.blocked.length,
      'COMMUNITY_PROHIBITED',
      'This wording is not allowed on HoguLink.',
      422,
    );
    return result.flags;
  }
  private async weekly(tx: Records, filter: Record<string, string>) {
    return (
      limits.weeklyBusinessPosts -
      (await tx.count('communityPosts', { ...filter, createdAt: { gte: this.now() - 7 * day } }))
    );
  }
  private closed(post: PostRecord, policy?: CommunityReplyPolicy) {
    return (
      (post.expiresAt !== undefined && post.expiresAt <= this.now()) ||
      (post.type === 'NOTE' && policy === 'NONE')
    );
  }
  /** Whether the post's author is still allowed to appear publicly. */
  private async authorView(
    tx: Records,
    row: { role: Role; ownerId: string; storeId?: string; listingId?: string },
  ): Promise<DiscoveryPost['author'] | null> {
    if (row.role === 'ADMIN') return { id: 'editor', name: editor, kind: 'editor' };
    if (row.role === 'CUSTOMER') {
      const name = communityAlias(row.ownerId);
      return { id: `customer-${name.en.slice(-4)}`, name, kind: 'customer' };
    }
    const store = row.storeId ? await tx.get<Store>('stores', row.storeId) : undefined;
    if (!storePublic(store)) return null;
    if (row.role === 'MERCHANT')
      return { id: store!.id, name: store!.name, kind: 'shop', slug: store!.slug };
    const listing = row.listingId ? await tx.get<Listing>('listings', row.listingId) : undefined;
    if (!listingPublic(listing) || listing!.storeId !== store!.id) return null;
    return {
      id: listing!.id,
      name: listing!.name,
      kind: 'therapist',
      slug: listing!.slug,
      photo: listing!.photo,
    };
  }
  private async images(tx: Records, post: PostRecord) {
    if (post.type === 'NOTE')
      return (
        await Promise.all(
          post.images.map(async (id) => {
            const m = await tx.get<{ id: string; listingId: string; status: string; kind: string }>(
              'listingMedia',
              id,
            );
            return m?.status === 'APPROVED' && m.kind === 'PHOTO' && m.listingId === post.listingId
              ? listingMediaUrl(m.id)
              : null;
          }),
        )
      ).filter((x): x is string => !!x);
    if (post.type === 'UPDATE' && post.storeId) {
      const live = (await tx.get<Store>('stores', post.storeId))?.storefront?.photos ?? [];
      return post.images
        .filter((id) => live.some((p) => p.id === id))
        .map((id) => storefrontAssetUrl(id));
    }
    return [];
  }
  private async offering(tx: Records, post: PostRecord) {
    if (!post.offeringId || !post.storeId) return undefined;
    const o = await tx.get<Offering>('offerings', post.offeringId);
    const store = await tx.get<Store>('stores', post.storeId);
    return o?.storeId === post.storeId &&
      o.approved &&
      o.active !== false &&
      o.regulatoryCategory === 'RELAXATION' &&
      store
      ? { id: o.id, name: o.name, durationMinutes: o.durationMinutes, storeSlug: store.slug }
      : undefined;
  }
  private async live(tx: Records, post: PostRecord | undefined) {
    if (!post || post.status !== 'PUBLISHED') return null;
    if (post.expiresAt !== undefined && post.expiresAt <= this.now()) return null;
    return this.authorView(tx, post);
  }
  private async visibleReplies(tx: Records, postId: string) {
    const replies = [];
    for (const row of await tx.find<ReplyRecord>('communityReplies', {
      postId,
      status: 'PUBLISHED',
    })) {
      const author = await this.authorView(tx, row);
      if (author) replies.push({ row, author });
    }
    return replies;
  }
  private async card(
    tx: Records,
    post: PostRecord,
    summaryOnly = false,
  ): Promise<DiscoveryPost | null> {
    const author = await this.live(tx, post);
    if (!author) return null;
    // Search and pagination use metadata; only hydrate the selected cards.
    const replies = summaryOnly ? [] : await this.visibleReplies(tx, post.id);
    const accepted = replies.some(({ row }) => row.id === post.acceptedReplyId);
    const images = summaryOnly ? [] : await this.images(tx, post);
    const offering = summaryOnly ? undefined : await this.offering(tx, post);
    return {
      id: post.id,
      kind: kindOf[post.type],
      title: post.title,
      summary: excerpt(post.body),
      images,
      portrait: post.type === 'NOTE' && images.length > 0,
      sample: !!post.sample,
      illustration: false,
      author,
      ...(post.storeId ? { storeId: post.storeId } : {}),
      stats: { views: 0, likes: 0, saves: 0 },
      community: {
        type: post.type,
        language: post.language,
        topic: post.topic,
        ...(post.area ? { area: post.area } : {}),
        answers: replies.length,
        accepted,
        publishedAt: post.publishedAt ?? post.createdAt,
        ...(post.template ? { template: post.template } : {}),
        ...(post.expiresAt ? { expiresAt: post.expiresAt } : {}),
        ...(post.pinned ? { pinned: true } : {}),
        ...(offering ? { offering } : {}),
      },
    };
  }
  /** Published, unexpired posts whose authors are still public, newest first, pins on top. */
  async published(filters: { area?: string; language?: string } = {}, summaryOnly = false) {
    return this.engine.repo.read(async (tx) => {
      const rows = await tx.find<PostRecord>(
        'communityPosts',
        { status: 'PUBLISHED' },
        { orderBy: 'createdAt', descending: true },
      );
      const result: DiscoveryPost[] = [];
      for (const row of rows) {
        if (filters.language && row.type !== 'EDITORIAL' && row.language !== filters.language)
          continue;
        if (filters.area) {
          if (row.area && row.area !== filters.area) continue;
          if (row.storeId && ['STAFF', 'MERCHANT'].includes(row.role)) {
            const store = await tx.get<Store>('stores', row.storeId);
            if (store?.areas.length && !store.areas.includes(filters.area)) continue;
          }
        }
        const card = await this.card(tx, row, summaryOnly);
        if (card) result.push(card);
      }
      return result.sort(
        (a, b) =>
          Number(!!b.community?.pinned) - Number(!!a.community?.pinned) ||
          b.community!.publishedAt - a.community!.publishedAt,
      );
    });
  }
  async isPublic(tx: Records, id: string) {
    return !!(await this.live(tx, await tx.get<PostRecord>('communityPosts', id)));
  }
  async publicPost(tx: Records, id: string) {
    const post = await tx.get<PostRecord>('communityPosts', id);
    return post ? this.card(tx, post) : null;
  }
  private async replyView(
    tx: Records,
    post: PostRecord,
    r: ReplyRecord,
    author: DiscoveryPost['author'],
  ): Promise<CommunityReply> {
    return {
      id: r.id,
      body: r.body,
      language: r.language,
      author: {
        kind: author.kind,
        name: author.name,
        ...(author.slug ? { slug: author.slug } : {}),
        ...(r.ownerId === post.ownerId ? { asker: true } : {}),
      },
      publishedAt: r.publishedAt ?? r.createdAt,
      helpful: await tx.count('communityVotes', { postId: r.id }),
      accepted: post.acceptedReplyId === r.id,
    };
  }
  async thread(id: string): Promise<CommunityThread | null> {
    return this.engine.repo.read((tx) => this.publicThread(tx, id));
  }
  async publicThread(tx: Records, id: string): Promise<CommunityThread | null> {
    const post = await tx.get<PostRecord>('communityPosts', id);
    if (!(await this.live(tx, post))) return null;
    const replies: CommunityReply[] = [];
    for (const { row, author } of await this.visibleReplies(tx, id)) {
      replies.push(await this.replyView(tx, post!, row, author));
    }
    replies.sort(
      (a, b) =>
        Number(b.accepted) - Number(a.accepted) ||
        b.helpful - a.helpful ||
        a.publishedAt - b.publishedAt,
    );
    const policy = post!.listingId
      ? (await this.settings(tx, `listing:${post!.listingId}`))?.replyPolicy
      : undefined;
    return { body: post!.body, replies, closed: this.closed(post!, policy) };
  }
  private async served(tx: Records, customerId: string, listingId: string) {
    return (
      (
        await tx.find<Booking>(
          'bookings',
          { customerId, assignedListingId: listingId, status: 'COMPLETED' },
          { limit: 1 },
        )
      ).length > 0
    );
  }
  private async block(
    tx: Records,
    actor: Actor,
    post: PostRecord,
  ): Promise<CommunityReplyBlock | undefined> {
    const policy = post.listingId
      ? ((await this.settings(tx, `listing:${post.listingId}`))?.replyPolicy ?? 'CUSTOMERS')
      : undefined;
    if (this.closed(post, policy)) return 'CLOSED';
    if (actor.role === 'CUSTOMER') {
      if (actor.verificationLevel < 1) return 'VERIFY';
      if (await this.muted(tx, actor.id)) return 'MUTED';
      if (post.type === 'NOTE' && policy === 'SERVED')
        return (await this.served(tx, actor.id, post.listingId!)) ? undefined : 'NOT_SERVED';
      return undefined;
    }
    if (actor.role === 'STAFF') {
      const { listing, store } = await this.member(tx, actor);
      if (await this.muted(tx, `listing:${listing.id}`)) return 'MUTED';
      if (post.type === 'NOTE') return post.listingId === listing.id ? undefined : 'ROLE';
      if (post.type !== 'QUESTION') return 'ROLE';
      const allowed =
        (await this.settings(tx, `store:${store.id}`))?.staffPosting &&
        listingPublic(listing) &&
        storePublic(store);
      return allowed ? undefined : 'POSTING_OFF';
    }
    if (actor.role === 'MERCHANT') {
      const store = await this.shop(tx, actor);
      if (await this.muted(tx, `store:${store.id}`)) return 'MUTED';
      if (!storePublic(store)) return 'POSTING_OFF';
      if (post.type === 'QUESTION') return undefined;
      return ['NOTE', 'UPDATE'].includes(post.type) && post.storeId === store.id
        ? undefined
        : 'ROLE';
    }
    return canAdmin(await currentAdmin(tx, actor), 'supply.write') ? undefined : 'ROLE';
  }
  private own(
    row: PostRecord | ReplyRecord,
    post?: PostRecord,
    replies?: number,
  ): CommunityOwnItem {
    const isPost = !('postId' in row);
    const p = (isPost ? row : post) as PostRecord | undefined;
    return {
      id: row.id,
      kind: isPost ? 'POST' : 'REPLY',
      type: p?.type ?? 'QUESTION',
      postId: isPost ? row.id : (row as ReplyRecord).postId,
      title: p ? p.title[p.language === 'zh' ? 'zh-cn' : p.language] : '',
      body: isPost ? (row as PostRecord).body.ja : (row as ReplyRecord).body,
      status: row.status,
      ...(row.reason && ['REJECTED', 'HIDDEN'].includes(row.status) ? { reason: row.reason } : {}),
      createdAt: row.createdAt,
      ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}),
      ...(isPost && (row as PostRecord).expiresAt
        ? { expiresAt: (row as PostRecord).expiresAt }
        : {}),
      ...(replies !== undefined ? { replies } : {}),
    };
  }
  async viewer(actor: Actor, id: string): Promise<CommunityViewer> {
    return this.engine.repo.read(async (tx) => {
      const post = await tx.get<PostRecord>('communityPosts', id);
      ensure(await this.live(tx, post), 'NOT_FOUND', 'This post is not available.', 404);
      const { ownerId } = await this.owner(tx, actor);
      const block = await this.block(tx, actor, post!);
      const mine = (await tx.find<ReplyRecord>('communityReplies', { postId: id, ownerId })).filter(
        (r) => ['PENDING', 'REJECTED', 'HIDDEN'].includes(r.status),
      );
      const replyIds = new Set((await this.visibleReplies(tx, id)).map(({ row }) => row.id));
      const helpful =
        actor.role === 'CUSTOMER'
          ? (await tx.find<VoteRecord>('communityVotes', { customerId: actor.id }))
              .map((v) => v.postId)
              .filter((replyId) => replyIds.has(replyId))
          : [];
      return {
        canReply: !block,
        ...(block ? { block } : {}),
        author: post!.ownerId === ownerId,
        helpful,
        pending: mine.map((r) => this.own(r, post!)),
      };
    });
  }
  async ask(actor: Actor, input: unknown) {
    const d = questionInput.parse(input);
    ensure(
      actor.role === 'CUSTOMER' && actor.verificationLevel >= 1,
      'FORBIDDEN',
      'Sign in with a verified customer account to ask.',
      403,
    );
    const flags = this.check(d.title, d.body);
    return this.engine.run(async (tx) => {
      await this.assertCanWrite(tx, actor.id);
      const post = this.draft('QUESTION', actor.role, actor.id, d, flags, {
        topic: d.topic,
        ...(d.area ? { area: d.area } : {}),
      });
      await tx.put('communityPosts', post);
      return this.own(post);
    });
  }
  private draft(
    type: CommunityPostType,
    role: Role,
    ownerId: string,
    d: { title: string; body: string; language: CommunityLanguage },
    flags: string[],
    extra: Partial<PostRecord>,
  ): PostRecord {
    return {
      id: `post-${randomUUID()}`,
      type,
      status: 'PENDING',
      role,
      ownerId,
      title: same(d.title),
      body: same(d.body),
      language: d.language,
      topic: 'OTHER',
      images: [],
      flags,
      version: 1,
      createdAt: this.now(),
      updatedAt: this.now(),
      ...extra,
    };
  }
  async note(actor: Actor, input: unknown) {
    const d = noteInput.parse(input);
    const flags = this.check(d.title, d.body);
    return this.engine.run(async (tx) => {
      const { listing, store } = await this.member(tx, actor);
      const ownerId = `listing:${listing.id}`;
      await this.assertCanWrite(tx, ownerId);
      ensure(
        (await this.settings(tx, `store:${store.id}`))?.staffPosting &&
          listingPublic(listing) &&
          storePublic(store),
        'COMMUNITY_POSTING_OFF',
        'Your shop has not turned on community posting for therapists.',
        409,
      );
      ensure(
        (await this.weekly(tx, { type: 'NOTE', listingId: listing.id })) > 0,
        'COMMUNITY_WEEKLY_LIMIT',
        `Up to ${limits.weeklyBusinessPosts} notes in 7 days.`,
        409,
      );
      for (const id of new Set(d.mediaIds)) {
        const m = await tx.get<{ listingId: string; status: string; kind: string }>(
          'listingMedia',
          id,
        );
        ensure(
          m?.listingId === listing.id && m.status === 'APPROVED' && m.kind === 'PHOTO',
          'INVALID_MEDIA',
          'Choose from your approved photos.',
          422,
        );
      }
      const post = this.draft('NOTE', 'STAFF', ownerId, d, flags, {
        topic: d.topic,
        storeId: store.id,
        listingId: listing.id,
        images: [...new Set(d.mediaIds)],
      });
      await tx.put('communityPosts', post);
      return this.own(post);
    });
  }
  async update(actor: Actor, input: unknown) {
    const d = updateInput.parse(input);
    const flags = this.check(d.title, d.body);
    return this.engine.run(async (tx) => {
      const store = await this.shop(tx, actor);
      const ownerId = `store:${store.id}`;
      await this.assertCanWrite(tx, ownerId);
      ensure(storePublic(store), 'COMMUNITY_POSTING_OFF', 'Your shop is not public.', 409);
      ensure(
        (await this.weekly(tx, { type: 'UPDATE', storeId: store.id })) > 0,
        'COMMUNITY_WEEKLY_LIMIT',
        `Up to ${limits.weeklyBusinessPosts} updates in 7 days.`,
        409,
      );
      if (['NEW_MENU', 'OFFER'].includes(d.template) || d.offeringId) {
        const o = d.offeringId ? await tx.get<Offering>('offerings', d.offeringId) : undefined;
        ensure(
          o?.storeId === store.id &&
            o.approved &&
            o.active !== false &&
            o.regulatoryCategory === 'RELAXATION',
          'INVALID_OFFERING',
          'Link one of your current relaxation menus.',
          422,
        );
      }
      ensure(
        !['OFFER', 'NOTICE'].includes(d.template) || d.expiresAt !== undefined,
        'EXPIRY_REQUIRED',
        'Offers and notices need an end date.',
        422,
      );
      ensure(
        d.expiresAt === undefined ||
          (d.expiresAt > this.now() && d.expiresAt <= this.now() + limits.offerDays * day),
        'INVALID_EXPIRY',
        `End within ${limits.offerDays} days.`,
        422,
      );
      const live = store.storefront?.photos ?? [];
      ensure(
        d.imageIds.every((id) => live.some((p) => p.id === id)),
        'INVALID_MEDIA',
        'Choose photos already published on your shop page.',
        422,
      );
      const post = this.draft('UPDATE', 'MERCHANT', ownerId, d, flags, {
        topic: updateTopic[d.template],
        storeId: store.id,
        template: d.template,
        ...(d.offeringId ? { offeringId: d.offeringId } : {}),
        ...(d.expiresAt ? { expiresAt: d.expiresAt } : {}),
        images: [...new Set(d.imageIds)],
      });
      await tx.put('communityPosts', post);
      return this.own(post);
    });
  }
  async reply(actor: Actor, postId: string, input: unknown) {
    const d = replyInput.parse(input);
    const flags = this.check(d.body);
    return this.engine.run(async (tx) => {
      const post = await tx.get<PostRecord>('communityPosts', postId);
      ensure(await this.live(tx, post), 'NOT_FOUND', 'This post is not available.', 404);
      const block = await this.block(tx, actor, post!);
      ensure(!block, `COMMUNITY_${block}`, 'You cannot reply to this post.', 403);
      const owner = await this.owner(tx, actor);
      const editorReply = actor.role === 'ADMIN';
      const reply: ReplyRecord = {
        id: `reply-${randomUUID()}`,
        postId,
        // The platform's own replies are its editorial voice; everyone else is reviewed first.
        status: editorReply ? 'PUBLISHED' : 'PENDING',
        role: actor.role,
        ...owner,
        body: d.body,
        language: d.language,
        flags,
        version: 1,
        createdAt: this.now(),
        updatedAt: this.now(),
        ...(editorReply ? { publishedAt: this.now() } : {}),
      };
      await tx.put('communityReplies', reply);
      return this.own(reply, post!);
    });
  }
  async accept(actor: Actor, postId: string, input: unknown) {
    const d = z
      .object({ replyId: z.string().max(80).nullable() })
      .strict()
      .parse(input);
    return this.engine.run(async (tx) => {
      const post = await tx.get<PostRecord>('communityPosts', postId);
      ensure(await this.live(tx, post), 'NOT_FOUND', 'This post is not available.', 404);
      ensure(
        post!.type === 'QUESTION' && post!.ownerId === actor.id,
        'FORBIDDEN',
        'Only the person who asked can choose an answer.',
        403,
      );
      if (d.replyId) {
        const r = await tx.get<ReplyRecord>('communityReplies', d.replyId);
        ensure(
          r?.postId === postId &&
            r.status === 'PUBLISHED' &&
            r.ownerId !== actor.id &&
            !!(await this.authorView(tx, r)),
          'NOT_FOUND',
          'Answer not found.',
          404,
        );
      }
      const next = { ...post!, updatedAt: this.now() };
      if (d.replyId) next.acceptedReplyId = d.replyId;
      else delete next.acceptedReplyId;
      await tx.put('communityPosts', next);
      return { acceptedReplyId: next.acceptedReplyId ?? null };
    });
  }
  async helpful(actor: Actor, replyId: string, input: unknown) {
    const d = z.object({ helpful: z.boolean() }).strict().parse(input);
    ensure(
      actor.role === 'CUSTOMER' && actor.verificationLevel >= 1,
      'FORBIDDEN',
      'Sign in with a verified customer account.',
      403,
    );
    return this.engine.run(async (tx) => {
      const r = await tx.get<ReplyRecord>('communityReplies', replyId);
      const post = r && (await tx.get<PostRecord>('communityPosts', r.postId));
      ensure(
        r?.status === 'PUBLISHED' && (await this.live(tx, post)) && (await this.authorView(tx, r)),
        'NOT_FOUND',
        'Answer not found.',
        404,
      );
      ensure(r!.ownerId !== actor.id, 'FORBIDDEN', 'You cannot vote for your own answer.', 403);
      const id = signature(actor.id, replyId);
      if (d.helpful)
        await tx.put<VoteRecord>('communityVotes', {
          id,
          customerId: actor.id,
          postId: replyId,
          createdAt: this.now(),
        });
      else await tx.remove('communityVotes', id);
      return { helpful: d.helpful, count: await tx.count('communityVotes', { postId: replyId }) };
    });
  }
  async report(actor: Actor, kind: 'POST' | 'REPLY', id: string, input: unknown) {
    const d = reportInput.parse(input);
    return this.engine.run(async (tx) => {
      const target =
        kind === 'POST'
          ? await tx.get<PostRecord>('communityPosts', id)
          : await tx.get<ReplyRecord>('communityReplies', id);
      ensure(target?.status === 'PUBLISHED', 'NOT_FOUND', 'Content not found.', 404);
      const { ownerId } = await this.owner(tx, actor);
      ensure(target.ownerId !== ownerId, 'FORBIDDEN', 'You cannot report your own content.', 403);
      const reportId = signature(ownerId, id);
      if ((await tx.get<ReportRecord>('communityReports', reportId))?.status === 'OPEN')
        return { reported: true, hidden: false };
      await tx.put<ReportRecord>('communityReports', {
        id: reportId,
        reporterId: ownerId,
        postId: id,
        kind,
        reason: d.reason,
        ...(d.detail ? { detail: d.detail } : {}),
        status: 'OPEN',
        createdAt: this.now(),
      });
      const open = await tx.count('communityReports', { postId: id, status: 'OPEN' });
      const hidden = open >= limits.autoHideReports;
      if (hidden) {
        await tx.put(kind === 'POST' ? 'communityPosts' : 'communityReplies', {
          ...target,
          status: 'HIDDEN',
          reason: 'REPORTED',
          version: target.version + 1,
          updatedAt: this.now(),
        });
        await this.audit(tx, actor, 'COMMUNITY_AUTO_HIDDEN', id);
      }
      return { reported: true, hidden };
    });
  }
  async withdraw(actor: Actor, kind: 'POST' | 'REPLY', id: string) {
    return this.engine.run(async (tx) => {
      const table = kind === 'POST' ? 'communityPosts' : 'communityReplies';
      const row = await tx.get<PostRecord | ReplyRecord>(table, id);
      ensure(row, 'NOT_FOUND', 'Content not found.', 404);
      const { ownerId, storeId } = await this.owner(tx, actor);
      // A shop answers for its therapists' notes and can take one down.
      const shopTakedown =
        actor.role === 'MERCHANT' && row.role === 'STAFF' && row.storeId === storeId;
      ensure(row.ownerId === ownerId || shopTakedown, 'FORBIDDEN', 'Not your content.', 403);
      ensure(
        ['PENDING', 'PUBLISHED'].includes(row.status),
        'COMMUNITY_STATE',
        'This content can no longer be withdrawn.',
        409,
      );
      await tx.put(table, {
        ...row,
        status: 'WITHDRAWN',
        version: row.version + 1,
        updatedAt: this.now(),
      });
      if (shopTakedown) await this.audit(tx, actor, 'COMMUNITY_SHOP_WITHDREW', id);
      return { withdrawn: true };
    });
  }
  async mine(actor: Actor): Promise<CommunityOwnItem[]> {
    return this.engine.repo.read(async (tx) => {
      const { ownerId } = await this.owner(tx, actor);
      const posts = await tx.find<PostRecord>(
        'communityPosts',
        { ownerId },
        { orderBy: 'createdAt', descending: true, limit: 100 },
      );
      const replies = await tx.find<ReplyRecord>(
        'communityReplies',
        { ownerId },
        { orderBy: 'createdAt', descending: true, limit: 100 },
      );
      const items = [
        ...(await Promise.all(
          posts.map(async (p) =>
            this.own(
              p,
              undefined,
              await tx.count('communityReplies', { postId: p.id, status: 'PUBLISHED' }),
            ),
          ),
        )),
        ...(await Promise.all(
          replies.map(async (r) =>
            this.own(r, await tx.get<PostRecord>('communityPosts', r.postId)),
          ),
        )),
      ];
      return items.sort((a, b) => b.createdAt - a.createdAt);
    });
  }
  /** Recent published questions a shop in these areas can help with, unanswered first. */
  private async questions(tx: Records, storeAreas: string[]): Promise<CommunityQuestionSummary[]> {
    const rows = (
      await tx.find<PostRecord>(
        'communityPosts',
        { type: 'QUESTION', status: 'PUBLISHED', createdAt: { gte: this.now() - 30 * day } },
        { orderBy: 'createdAt', descending: true, limit: 200 },
      )
    ).filter((p) => !p.area || !storeAreas.length || storeAreas.includes(p.area));
    const result: CommunityQuestionSummary[] = [];
    for (const p of rows) {
      const replies = await this.visibleReplies(tx, p.id);
      result.push({
        id: p.id,
        title: p.title.ja,
        topic: p.topic,
        ...(p.area ? { area: p.area } : {}),
        language: p.language,
        publishedAt: p.publishedAt ?? p.createdAt,
        answers: replies.length,
        answeredByBusiness: replies.some(({ row }) => row.role !== 'CUSTOMER'),
      });
    }
    return result
      .sort(
        (a, b) =>
          Number(a.answeredByBusiness) - Number(b.answeredByBusiness) ||
          b.publishedAt - a.publishedAt,
      )
      .slice(0, 20);
  }
  private async listed(tx: Records, rows: PostRecord[], withAuthor = false) {
    return Promise.all(
      rows.map(async (p) => ({
        ...this.own(p, undefined, (await this.visibleReplies(tx, p.id)).length),
        ...(withAuthor && p.listingId
          ? { author: (await tx.get<Listing>('listings', p.listingId))?.name }
          : {}),
      })),
    );
  }
  async staffWorkspace(actor: Actor): Promise<CommunityWorkspace> {
    return this.engine.repo.read(async (tx) => {
      const { listing, store } = await this.member(tx, actor);
      const staffPosting = !!(await this.settings(tx, `store:${store.id}`))?.staffPosting;
      const notes = await tx.find<PostRecord>(
        'communityPosts',
        { type: 'NOTE', listingId: listing.id },
        { orderBy: 'createdAt', descending: true, limit: 50 },
      );
      const photos = (
        await tx.find<{ id: string; kind: string; status: string }>('listingMedia', {
          listingId: listing.id,
          status: 'APPROVED',
        })
      )
        .filter((m) => m.kind === 'PHOTO')
        .map((m) => ({ id: m.id, url: listingMediaUrl(m.id) }));
      return {
        canPost: staffPosting && listingPublic(listing) && storePublic(store),
        staffPosting,
        replyPolicy: (await this.settings(tx, `listing:${listing.id}`))?.replyPolicy ?? 'CUSTOMERS',
        weeklyRemaining: Math.max(
          0,
          await this.weekly(tx, { type: 'NOTE', listingId: listing.id }),
        ),
        photos,
        posts: await this.listed(tx, notes),
        questions: staffPosting ? await this.questions(tx, store.areas) : [],
      };
    });
  }
  async shopWorkspace(actor: Actor): Promise<CommunityWorkspace> {
    return this.engine.repo.read(async (tx) => {
      const store = await this.shop(tx, actor);
      const updates = await tx.find<PostRecord>(
        'communityPosts',
        { type: 'UPDATE', storeId: store.id },
        { orderBy: 'createdAt', descending: true, limit: 50 },
      );
      const notes = await tx.find<PostRecord>(
        'communityPosts',
        { type: 'NOTE', storeId: store.id },
        { orderBy: 'createdAt', descending: true, limit: 50 },
      );
      return {
        canPost: storePublic(store),
        staffPosting: !!(await this.settings(tx, `store:${store.id}`))?.staffPosting,
        weeklyRemaining: Math.max(0, await this.weekly(tx, { type: 'UPDATE', storeId: store.id })),
        photos: (store.storefront?.photos ?? []).map((p) => ({ id: p.id, url: p.url })),
        offerings: (await tx.find<Offering>('offerings', { storeId: store.id }))
          .filter((o) => o.approved && o.active !== false && o.regulatoryCategory === 'RELAXATION')
          .map((o) => ({ id: o.id, name: o.name, durationMinutes: o.durationMinutes })),
        posts: await this.listed(tx, updates),
        staffPosts: await this.listed(tx, notes, true),
        questions: await this.questions(tx, store.areas),
      };
    });
  }
  async setReplyPolicy(actor: Actor, input: unknown) {
    const d = z
      .object({ replyPolicy: z.enum(communityReplyPolicies) })
      .strict()
      .parse(input);
    return this.engine.run(async (tx) => {
      const { listing } = await this.member(tx, actor);
      const id = `listing:${listing.id}`;
      await tx.put<SettingsRecord>('communitySettings', {
        ...(await this.settings(tx, id)),
        id,
        replyPolicy: d.replyPolicy,
        updatedAt: this.now(),
      });
      return { replyPolicy: d.replyPolicy };
    });
  }
  async setStaffPosting(actor: Actor, input: unknown) {
    const d = z.object({ staffPosting: z.boolean() }).strict().parse(input);
    return this.engine.run(async (tx) => {
      const store = await this.shop(tx, actor);
      const id = `store:${store.id}`;
      await tx.put<SettingsRecord>('communitySettings', {
        ...(await this.settings(tx, id)),
        id,
        staffPosting: d.staffPosting,
        updatedAt: this.now(),
      });
      await this.audit(
        tx,
        actor,
        d.staffPosting ? 'COMMUNITY_STAFF_ON' : 'COMMUNITY_STAFF_OFF',
        store.id,
      );
      return { staffPosting: d.staffPosting };
    });
  }
  private async authorLabel(
    tx: Records,
    row: Pick<PostRecord, 'role' | 'ownerId' | 'storeId' | 'listingId'>,
  ) {
    if (row.role === 'CUSTOMER') return { label: communityAlias(row.ownerId) };
    if (row.role === 'ADMIN') return { label: editor };
    const store = row.storeId ? await tx.get<Store>('stores', row.storeId) : undefined;
    const listing = row.listingId ? await tx.get<Listing>('listings', row.listingId) : undefined;
    return {
      label: listing?.name ?? store?.name ?? same('—'),
      ...(store ? { storeName: store.name } : {}),
    };
  }
  private async queueItem(
    tx: Records,
    row: PostRecord | ReplyRecord,
    reports: ReportRecord[],
  ): Promise<CommunityQueueItem> {
    const isPost = !('postId' in row);
    const post = isPost
      ? (row as PostRecord)
      : await tx.get<PostRecord>('communityPosts', (row as ReplyRecord).postId);
    const offering =
      isPost && post?.offeringId
        ? (await tx.get<Offering>('offerings', post.offeringId))?.name
        : undefined;
    const counts = new Map<CommunityReportReason, number>();
    for (const r of reports) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
    const mute = await this.muted(tx, row.ownerId);
    return {
      id: row.id,
      kind: isPost ? 'POST' : 'REPLY',
      type: post?.type ?? 'QUESTION',
      postId: post?.id ?? '',
      postTitle: post ? post.title.ja : '',
      ...(isPost ? { title: (row as PostRecord).title.ja } : {}),
      body: isPost ? (row as PostRecord).body.ja : (row as ReplyRecord).body,
      language: row.language,
      status: row.status,
      version: row.version,
      flags: row.flags,
      reports: [...counts].map(([reason, count]) => ({ reason, count })),
      author: {
        role: row.role as CommunityQueueItem['author']['role'],
        ownerId: row.ownerId,
        ...(await this.authorLabel(tx, row)),
        ...(mute ? { mutedUntil: mute.until } : {}),
      },
      ...(isPost && post?.template ? { template: post.template } : {}),
      ...(offering ? { offering } : {}),
      ...(isPost && post?.expiresAt ? { expiresAt: post.expiresAt } : {}),
      images: isPost && post ? await this.images(tx, post) : [],
      createdAt: row.createdAt,
    };
  }
  /** Waiting submissions plus visible or auto-hidden content that still has open reports. */
  private async waiting(tx: Records) {
    const reports = await tx.find<ReportRecord>('communityReports', { status: 'OPEN' });
    const rows: (PostRecord | ReplyRecord)[] = [
      ...(await tx.find<PostRecord>('communityPosts', { status: 'PENDING' })),
      ...(await tx.find<ReplyRecord>('communityReplies', { status: 'PENDING' })),
    ];
    const reported = new Set<string>();
    for (const id of new Set(reports.map((r) => r.postId))) {
      const row =
        (await tx.get<PostRecord>('communityPosts', id)) ??
        (await tx.get<ReplyRecord>('communityReplies', id));
      if (row && ['PUBLISHED', 'HIDDEN'].includes(row.status)) {
        rows.push(row);
        reported.add(id);
      }
    }
    return { rows, reports, reported };
  }
  async queue(actor: Actor): Promise<CommunityQueueItem[]> {
    return this.engine.repo.read(async (tx) => {
      requireAdmin(await currentAdmin(tx, actor), 'supply.read');
      const { rows, reports, reported } = await this.waiting(tx);
      // Reported content first, then the oldest waiting submissions.
      rows.sort(
        (a, b) =>
          Number(reported.has(b.id)) - Number(reported.has(a.id)) || a.createdAt - b.createdAt,
      );
      return Promise.all(
        rows.map((row) =>
          this.queueItem(
            tx,
            row,
            reports.filter((r) => r.postId === row.id),
          ),
        ),
      );
    });
  }
  async pendingCount(tx: Records) {
    return (await this.waiting(tx)).rows.length;
  }
  async review(actor: Actor, kind: 'POST' | 'REPLY', id: string, input: unknown) {
    const d = reviewInput.parse(input);
    return this.engine.run(async (tx) => {
      requireAdmin(await currentAdmin(tx, actor), 'supply.write');
      const table = kind === 'POST' ? 'communityPosts' : 'communityReplies';
      const row = await tx.get<PostRecord | ReplyRecord>(table, id);
      ensure(row, 'NOT_FOUND', 'Content not found.', 404);
      ensure(row.version === d.version, 'VERSION_CONFLICT', 'Refresh the queue.', 409);
      const from: Record<typeof d.decision, CommunityStatus[]> = {
        APPROVE: ['PENDING'],
        REJECT: ['PENDING'],
        // Confirming an automatic hide closes its reports with the reviewer's reason.
        HIDE: ['PUBLISHED', 'HIDDEN'],
        RESTORE: ['HIDDEN'],
      };
      ensure(
        from[d.decision].includes(row.status),
        'COMMUNITY_STATE',
        'This content has already been handled.',
        409,
      );
      if (d.decision === 'APPROVE' && kind === 'POST') {
        const post = row as PostRecord;
        ensure(
          post.expiresAt === undefined || post.expiresAt > this.now(),
          'COMMUNITY_EXPIRED',
          'This update has already ended.',
          409,
        );
      }
      const status: CommunityStatus =
        d.decision === 'APPROVE' || d.decision === 'RESTORE'
          ? 'PUBLISHED'
          : d.decision === 'REJECT'
            ? 'REJECTED'
            : 'HIDDEN';
      const next = {
        ...row,
        status,
        version: row.version + 1,
        updatedAt: this.now(),
        reviewedBy: actor.id,
        reviewedAt: this.now(),
        ...(status === 'PUBLISHED' && !row.publishedAt ? { publishedAt: this.now() } : {}),
        ...(d.note ? { note: d.note } : {}),
      };
      if (d.reason) next.reason = d.reason;
      else if (status === 'PUBLISHED') delete next.reason;
      await tx.put(table, next);
      if (d.decision === 'HIDE' || d.decision === 'RESTORE')
        for (const r of await tx.find<ReportRecord>('communityReports', {
          postId: id,
          status: 'OPEN',
        }))
          await tx.put('communityReports', {
            ...r,
            status: d.decision === 'HIDE' ? 'ACTIONED' : 'DISMISSED',
            closedAt: this.now(),
          });
      await this.audit(tx, actor, `COMMUNITY_${d.decision}`, id);
      return { status, version: next.version };
    });
  }
  async dismissReports(actor: Actor, id: string) {
    return this.engine.run(async (tx) => {
      requireAdmin(await currentAdmin(tx, actor), 'supply.write');
      const open = await tx.find<ReportRecord>('communityReports', { postId: id, status: 'OPEN' });
      for (const r of open)
        await tx.put('communityReports', { ...r, status: 'DISMISSED', closedAt: this.now() });
      await this.audit(tx, actor, 'COMMUNITY_REPORTS_DISMISSED', id);
      return { dismissed: open.length };
    });
  }
  async listMutes(actor: Actor): Promise<CommunityMute[]> {
    return this.engine.repo.read(async (tx) => {
      requireAdmin(await currentAdmin(tx, actor), 'supply.read');
      const rows = (await tx.list<MuteRecord>('communityMutes'))
        .filter((row) => row.until > this.now())
        .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
      return Promise.all(
        rows.map(async (row) => {
          const listing = row.id.startsWith('listing:')
            ? await tx.get<Listing>('listings', row.id.slice(8))
            : undefined;
          const role = row.id.startsWith('store:')
            ? 'MERCHANT'
            : row.id.startsWith('listing:')
              ? 'STAFF'
              : 'CUSTOMER';
          return {
            ownerId: row.id,
            until: row.until,
            reason: row.reason,
            createdAt: row.at,
            author: {
              role,
              ...(await this.authorLabel(tx, {
                role,
                ownerId: row.id,
                ...(role === 'MERCHANT' ? { storeId: row.id.slice(6) } : {}),
                ...(role === 'STAFF'
                  ? { listingId: row.id.slice(8), storeId: listing?.storeId }
                  : {}),
              })),
            },
          } satisfies CommunityMute;
        }),
      );
    });
  }
  async mute(actor: Actor, input: unknown) {
    const d = z
      .object({
        ownerId: z.string().min(1).max(160),
        days: z.number().int().min(0).max(90),
        reason: z.string().trim().min(4).max(200),
        expectedUntil: z.number().int().positive().optional(),
      })
      .strict()
      .parse(input);
    return this.engine.run(async (tx) => {
      requireAdmin(await currentAdmin(tx, actor), 'supply.write');
      if (d.expectedUntil !== undefined) {
        const current = await tx.get<MuteRecord>('communityMutes', d.ownerId);
        ensure(
          current?.until === d.expectedUntil,
          'VERSION_CONFLICT',
          'Refresh the mute list.',
          409,
        );
      }
      if (d.days === 0) await tx.remove('communityMutes', d.ownerId);
      else
        await tx.put<MuteRecord>('communityMutes', {
          id: d.ownerId,
          until: this.now() + d.days * day,
          reason: d.reason,
          by: actor.id,
          at: this.now(),
        });
      await this.audit(tx, actor, d.days ? 'COMMUNITY_MUTED' : 'COMMUNITY_UNMUTED', d.ownerId);
      return { mutedUntil: d.days ? this.now() + d.days * day : null };
    });
  }
  async editorial(actor: Actor, input: unknown) {
    const d = editorialInput.parse(input);
    return this.engine.run(async (tx) => {
      requireAdmin(await currentAdmin(tx, actor), 'supply.write');
      const post: PostRecord = {
        id: `post-${randomUUID()}`,
        type: 'EDITORIAL',
        status: 'PUBLISHED',
        role: 'ADMIN',
        ownerId: actor.id,
        title: d.title,
        body: d.body,
        language: 'ja',
        topic: d.topic,
        images: [],
        ...(d.pinned ? { pinned: true } : {}),
        flags: [],
        version: 1,
        createdAt: this.now(),
        updatedAt: this.now(),
        publishedAt: this.now(),
        reviewedBy: actor.id,
        reviewedAt: this.now(),
      };
      await tx.put('communityPosts', post);
      await this.audit(tx, actor, 'COMMUNITY_EDITORIAL', post.id);
      return { id: post.id };
    });
  }
  async editorials(actor: Actor): Promise<CommunityEditorial[]> {
    return this.engine.repo.read(async (tx) => {
      requireAdmin(await currentAdmin(tx, actor), 'supply.read');
      return (
        await tx.find<PostRecord>(
          'communityPosts',
          { type: 'EDITORIAL' },
          { orderBy: 'createdAt', descending: true, limit: 100 },
        )
      ).map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        pinned: !!p.pinned,
        topic: p.topic,
        version: p.version,
        ...(p.publishedAt ? { publishedAt: p.publishedAt } : {}),
      }));
    });
  }
  async pin(actor: Actor, id: string, input: unknown) {
    const d = z.object({ pinned: z.boolean() }).strict().parse(input);
    return this.engine.run(async (tx) => {
      requireAdmin(await currentAdmin(tx, actor), 'supply.write');
      const post = await tx.get<PostRecord>('communityPosts', id);
      ensure(post?.type === 'EDITORIAL', 'NOT_FOUND', 'Editorial not found.', 404);
      const next = { ...post, version: post.version + 1, updatedAt: this.now() };
      if (d.pinned) next.pinned = true;
      else delete next.pinned;
      await tx.put('communityPosts', next);
      return { pinned: d.pinned };
    });
  }
}

/**
 * Demo-only starting content so the community is not empty on first open. Every item is a
 * labelled sample from the demo shops; nothing here is presented as a real customer's words.
 */
export async function seedDemoCommunity(engine: Engine) {
  const done = await engine.repo.transaction((tx) => tx.get('meta', 'demo-community-v1'));
  if (done) return;
  const now = engine.now();
  const base = {
    status: 'PUBLISHED' as const,
    flags: [],
    images: [],
    version: 1,
    sample: true,
  };
  const at = (hoursAgo: number) => now - hoursAgo * 3_600_000;
  const posts: PostRecord[] = [
    {
      ...base,
      id: 'post-demo-editorial-first-visit',
      type: 'EDITORIAL',
      role: 'ADMIN',
      ownerId: 'demo-editor',
      title: {
        'zh-cn': '第一次叫上门放松，先看这 4 件事',
        ja: '初めての出張リラクゼーション、まず確認したい4つのこと',
        en: 'Your first home visit: four things to check first',
      },
      body: {
        'zh-cn':
          '1. 选择上门或到店，并确认地区。2. 看清合计金额里包含的指名费和交通费。3. 酒店需提前确认访客规定。4. 服务足时结束、你确认后才扣款。有疑问可以在社区提问，店铺和技师会回答。',
        ja: '1. 出張か来店かを選び、エリアを確認。2. 合計に含まれる指名料・交通費を確認。3. ホテルは来訪ルールを事前に確認。4. 施術時間の終了後、あなたの確認で決済されます。わからないことはコミュニティで質問できます。',
        en: '1. Choose a home visit or a shop visit and check the area. 2. See which nomination and travel fees the total includes. 3. Check the hotel’s visitor rules. 4. Payment is taken only after the full session and your confirmation. Ask the community if anything is unclear.',
      },
      language: 'ja',
      topic: 'FIRST_TIME',
      pinned: true,
      createdAt: at(72),
      updatedAt: at(72),
      publishedAt: at(72),
    },
    {
      ...base,
      id: 'post-demo-question-hotel',
      type: 'QUESTION',
      role: 'CUSTOMER',
      ownerId: 'demo-customer',
      title: same('出差住在酒店，可以叫上门吗？'),
      body: same('下周在新宿出差，住商务酒店。需要提前跟酒店说吗？房间里要准备什么？'),
      language: 'zh',
      topic: 'HOTEL',
      area: 'shinjuku',
      createdAt: at(30),
      updatedAt: at(20),
      publishedAt: at(29),
      acceptedReplyId: 'reply-demo-hotel-shop',
    },
    {
      ...base,
      id: 'post-demo-note-aoi',
      type: 'NOTE',
      role: 'STAFF',
      ownerId: 'listing:listing-aoi',
      storeId: 'store-nagi',
      listingId: 'listing-aoi',
      title: same('長時間のデスクワークのあとに'),
      body: same(
        '施術の前に、首や肩のどこが重いか教えてください。力加減はいつでも変えられます。終わったあとはお水を一杯どうぞ。',
      ),
      language: 'ja',
      topic: 'SERVICES',
      createdAt: at(12),
      updatedAt: at(12),
      publishedAt: at(11),
    },
    {
      ...base,
      id: 'post-demo-update-sora',
      type: 'UPDATE',
      role: 'MERCHANT',
      ownerId: 'store:store-sora',
      storeId: 'store-sora',
      title: same('90-minute session now available on weekday evenings'),
      body: same(
        'We have added more weekday evening times for the 90-minute session. Check the shop page for the current price and open times.',
      ),
      language: 'en',
      topic: 'SERVICES',
      template: 'NEW_MENU',
      offeringId: 'store-sora-90',
      createdAt: at(6),
      updatedAt: at(6),
      publishedAt: at(5),
    },
  ];
  const replies: ReplyRecord[] = [
    {
      id: 'reply-demo-hotel-shop',
      postId: 'post-demo-question-hotel',
      status: 'PUBLISHED',
      role: 'MERCHANT',
      ownerId: 'store:store-nagi',
      storeId: 'store-nagi',
      body: '可以的。预约时请选择“酒店”，填写酒店名和房号，并确认酒店允许访客。房间里不需要特别准备，我们会带好毛巾。',
      language: 'zh',
      flags: [],
      version: 1,
      createdAt: at(22),
      updatedAt: at(21),
      publishedAt: at(21),
      sample: true,
    },
  ];
  await engine.repo.transaction(async (tx) => {
    for (const p of posts) {
      if (p.offeringId && !(await tx.get('offerings', p.offeringId))) delete p.offeringId;
      await tx.put('communityPosts', p);
    }
    for (const r of replies) await tx.put('communityReplies', r);
    await tx.put<SettingsRecord>('communitySettings', {
      id: 'store:store-nagi',
      staffPosting: true,
      updatedAt: now,
    });
    await tx.put('meta', { id: 'demo-community-v1', createdAt: now });
  });
}
