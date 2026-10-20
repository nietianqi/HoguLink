import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  type Actor,
  type DiscoveryPost,
  type DiscoveryReaction,
  type DiscoveryFeed,
  type DiscoveryDetail,
  type DiscoverySaved,
  type Localized,
  type Listing,
  type Offering,
  type Store,
} from '@hogulink/contracts';
import { discoveryArticles } from '@hogulink/contracts/discovery-content';
import { discoveryTabs } from '@hogulink/contracts/discovery';
import type { Engine } from './engine.js';
import type { Records } from './repository.js';
import { ensure } from './errors.js';

const text = (zh: string, ja: string, en: string): Localized => ({ 'zh-cn': zh, ja, en });
const signature = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const filters = z
  .object({
    area: z.enum(['shinjuku', 'shibuya', 'minato', 'chuo', 'taito']).optional(),
    language: z.enum(['ja', 'en', 'zh']).optional(),
  })
  .strict();
const feedInput = filters
  .extend({
    tab: z.enum(discoveryTabs).default('recommended'),
    search: z.string().trim().max(80).default(''),
    limit: z.coerce.number().int().min(1).max(20).default(8),
    cursor: z.string().max(300).optional(),
  })
  .strict();
type ReactionRecord = DiscoveryReaction & {
  id: string;
  customerId: string;
  postId: string;
  updatedAt: number;
};
type ViewRecord = { id: string; customerId: string; postId: string };
const blank = () => ({ views: 0, likes: 0, saves: 0 });

export class DiscoveryService {
  constructor(private engine: Engine) {}
  private customer(actor: Actor) {
    ensure(
      actor.role === 'CUSTOMER' && actor.verificationLevel >= 1,
      'FORBIDDEN',
      'Use a verified customer account.',
      403,
    );
  }
  private async posts(input: z.infer<typeof filters> = {}) {
    const c = await this.engine.publicCatalog(input);
    const listings = c.listings
      .filter((p) =>
        c.offerings.some(
          (o) =>
            o.storeId === p.storeId &&
            p.offeringIds.includes(o.id) &&
            o.regulatoryCategory === 'RELAXATION',
        ),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    const shops = c.stores
      .filter((s) => listings.some((p) => p.storeId === s.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    const shopPosts: DiscoveryPost[] = shops.map((s, i) => ({
      id: `shop-${s.slug}`,
      kind: 'shop',
      title: s.name,
      summary: text(
        '查看当前项目、团队与店铺规则。',
        '現在のメニュー、スタッフ、店舗の条件を確認。',
        'Explore current services, team and shop policies.',
      ),
      images:
        i % 2
          ? ['/images/quiet-interior-v1.png', '/images/h5-relaxation.png']
          : ['/images/h5-relaxation.png', '/images/quiet-interior-v1.png'],
      portrait: false,
      sample: c.demo,
      illustration: true,
      storeId: s.id,
      author: { id: s.id, name: s.name, kind: 'shop', slug: s.slug },
      stats: blank(),
    }));
    const people: DiscoveryPost[] = listings.map((p) => ({
      id: `therapist-${p.slug}`,
      kind: 'therapist',
      title: text(
        `${p.name['zh-cn']} · 技师档案`,
        `${p.name.ja}のプロフィール`,
        `Meet ${p.name.en}`,
      ),
      summary: p.description,
      images: [p.photo],
      portrait: true,
      sample: c.demo,
      illustration: false,
      storeId: p.storeId,
      onDuty: p.onDuty,
      author: { id: p.id, name: p.name, kind: 'therapist', slug: p.slug, photo: p.photo },
      stats: blank(),
    }));
    const guides: DiscoveryPost[] = discoveryArticles.map((a, i) => ({
      id: `guide-${a.slug}`,
      kind: a.category === 'safety' ? 'safety' : 'guide',
      title: a.title,
      summary: a.summary,
      images:
        i === 0
          ? ['/images/quiet-interior-v1.png', '/images/h5-relaxation.png']
          : i === 1
            ? ['/images/h5-service-90.png', '/images/h5-treatment.png']
            : ['/images/h5-booking-care.png', '/images/h5-relaxation.png'],
      portrait: false,
      sample: false,
      illustration: true,
      author: {
        id: 'editor',
        name: text('HoguLink 预约编辑室', 'HoguLink 予約ガイド', 'HoguLink booking desk'),
        kind: 'editor',
      },
      stats: blank(),
    }));
    // Stable round-robin includes every eligible post, including the final shop.
    const items: DiscoveryPost[] = [];
    for (let i = 0; i < Math.max(people.length, guides.length, shopPosts.length); i++)
      for (const item of [people[i], guides[i], shopPosts[i]]) if (item) items.push(item);
    return items;
  }
  private async stats(tx: Records, post: DiscoveryPost): Promise<DiscoveryPost> {
    return { ...post, stats: await this.counts(tx, post.id) };
  }
  private async counts(tx: Records, id: string) {
    return {
      views: await tx.count('discoveryViews', { postId: id }),
      likes: await tx.count('discoveryReactions', { postId: id, liked: true }),
      saves: await tx.count('discoveryReactions', { postId: id, saved: true }),
    };
  }
  private async available(tx: Records, id: string) {
    if (discoveryArticles.some((a) => `guide-${a.slug}` === id)) return true;
    const person = id.startsWith('therapist-')
      ? (await tx.find<Listing>('listings', { slug: id.slice(10) }, { limit: 1 }))[0]
      : undefined;
    const store = person
      ? await tx.get<Store>('stores', person.storeId)
      : id.startsWith('shop-')
        ? (await tx.find<Store>('stores', { slug: id.slice(5) }, { limit: 1 }))[0]
        : undefined;
    if (!store?.active || !store.approved || store.billingBlocked) return false;
    const offerings = (await tx.find<Offering>('offerings', { storeId: store.id })).filter(
      (o) => o.approved && o.active !== false && o.regulatoryCategory === 'RELAXATION',
    );
    return (person ? [person] : await tx.find<Listing>('listings', { storeId: store.id })).some(
      (p) =>
        p.membershipActive &&
        p.identityVerified &&
        p.portraitConsent &&
        p.publicationStatus === 'PUBLISHED_INDEXABLE' &&
        offerings.some((o) => p.offeringIds.includes(o.id)),
    );
  }
  async feed(input: unknown = {}): Promise<DiscoveryFeed> {
    const d = feedInput.parse(input);
    const term = d.search.normalize('NFKC').toLocaleLowerCase();
    const all = (await this.posts({ area: d.area, language: d.language })).filter(
      (p) =>
        (d.tab === 'recommended' ||
          (d.tab === 'shops'
            ? p.kind === 'shop'
            : d.tab === 'therapists'
              ? p.kind === 'therapist'
              : d.tab === 'safety'
                ? p.kind === 'safety'
                : ['guide', 'safety'].includes(p.kind))) &&
        (!term ||
          [...Object.values(p.title), ...Object.values(p.summary), ...Object.values(p.author.name)]
            .join(' ')
            .normalize('NFKC')
            .toLocaleLowerCase()
            .includes(term)),
    );
    const key = signature([d.tab, d.area, d.language, term, all.map((p) => p.id)]);
    let offset = 0;
    if (d.cursor) {
      try {
        const cur = z
          .object({ key: z.string(), offset: z.number().int().nonnegative().max(100000) })
          .strict()
          .parse(JSON.parse(Buffer.from(d.cursor, 'base64url').toString('utf8')));
        ensure(cur.key === key, 'INVALID_CURSOR', 'Refresh discovery.', 400);
        offset = cur.offset;
      } catch {
        ensure(false, 'INVALID_CURSOR', 'Refresh discovery.', 400);
      }
    }
    return this.engine.repo.read(async (tx) => ({
      items: await Promise.all(all.slice(offset, offset + d.limit).map((p) => this.stats(tx, p))),
      total: all.length,
      nextCursor:
        offset + d.limit < all.length
          ? Buffer.from(JSON.stringify({ key, offset: offset + d.limit })).toString('base64url')
          : null,
    }));
  }
  async detail(id: string, input: unknown = {}): Promise<DiscoveryDetail> {
    const q = filters.parse(input),
      posts = await this.posts(q),
      post = posts.find((p) => p.id === id);
    ensure(post, 'NOT_FOUND', 'This content is no longer available for these preferences.', 404);
    const article = discoveryArticles.find((a) => `guide-${a.slug}` === id);
    const sections = article?.sections ?? [
      { heading: text('公开资料', '公開プロフィール', 'Public profile'), text: post.summary },
      {
        heading: text('预约前确认', 'ご予約の前に', 'Before you book'),
        text: text(
          '查看当前项目、服务语言、完整费用和可约时段。资料展示或待机状态不代表时段已保留；以预约页实时核对为准。',
          'メニュー、対応言語、合計料金、空き時間をご確認ください。プロフィールや待機表示だけでは日時は確保されません。',
          'Review current services, language, full prices and available times. A profile or on-duty status does not reserve a time; booking checks availability again.',
        ),
      },
    ];
    const related = posts
      .filter(
        (p) =>
          p.id !== id &&
          (p.author.id === post.author.id ||
            (post.storeId && p.storeId === post.storeId) ||
            p.kind === 'guide' ||
            p.kind === 'safety'),
      )
      .slice(0, 4);
    return this.engine.repo.read(async (tx) => ({
      post: await this.stats(tx, post),
      sections,
      related: await Promise.all(related.map((p) => this.stats(tx, p))),
    }));
  }
  async state(actor: Actor, id: string): Promise<DiscoveryReaction> {
    this.customer(actor);
    return this.engine.repo.read(async (tx) => {
      const r = await tx.get<ReactionRecord>('discoveryReactions', signature([actor.id, id]));
      return { liked: r?.liked ?? false, saved: r?.saved ?? false, version: r?.version ?? 0 };
    });
  }
  async react(actor: Actor, id: string, input: unknown) {
    this.customer(actor);
    const d = z
      .object({ version: z.number().int().nonnegative(), liked: z.boolean(), saved: z.boolean() })
      .strict()
      .parse(input);
    return this.engine.repo.transaction(async (tx) => {
      const key = signature([actor.id, id]),
        old = await tx.get<ReactionRecord>('discoveryReactions', key);
      ensure((old?.version ?? 0) === d.version, 'VERSION_CONFLICT', 'Refresh this content.', 409);
      ensure(
        (await this.available(tx, id)) || (!d.liked && !d.saved && !!old),
        'CONTENT_UNAVAILABLE',
        'This content is no longer available.',
        409,
      );
      ensure(
        !d.saved ||
          old?.saved ||
          (await tx.count('discoveryReactions', { customerId: actor.id, saved: true })) < 100,
        'FAVORITE_LIMIT',
        'You can save up to 100 posts.',
        409,
      );
      const row = {
        ...d,
        id: key,
        customerId: actor.id,
        postId: id,
        version: (old?.version ?? 0) + 1,
        updatedAt: this.engine.now(),
      };
      await tx.put('discoveryReactions', row);
      return {
        liked: row.liked,
        saved: row.saved,
        version: row.version,
        stats: await this.counts(tx, id),
      };
    });
  }
  async view(actor: Actor, id: string) {
    this.customer(actor);
    return this.engine.repo.transaction(async (tx) => {
      ensure(await this.available(tx, id), 'NOT_FOUND', 'Content not found.', 404);
      const key = signature([actor.id, id]);
      await tx.put<ViewRecord>('discoveryViews', { id: key, customerId: actor.id, postId: id });
      return { views: await tx.count('discoveryViews', { postId: id }) };
    });
  }
  async saved(actor: Actor): Promise<DiscoverySaved[]> {
    this.customer(actor);
    const posts = await this.posts();
    return this.engine.repo.read(async (tx) => {
      const rows = await tx.find<ReactionRecord>(
        'discoveryReactions',
        { customerId: actor.id, saved: true },
        { orderBy: 'updatedAt', descending: true, limit: 100 },
      );
      return Promise.all(
        rows.map(async (r) => ({
          id: r.postId,
          post: posts.find((p) => p.id === r.postId)
            ? await this.stats(
                tx,
                posts.find((p) => p.id === r.postId)!,
              )
            : null,
          state: { liked: r.liked, saved: r.saved, version: r.version },
        })),
      );
    });
  }
}
